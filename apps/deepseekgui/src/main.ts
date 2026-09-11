/**
 * DeepSeekGUI 主进程：由 HarnessController 协调 launcher state 与本机 DSH
 * 服务（读取 active selection → spawn → HTTP 就绪 → 页面加载；切换失败
 * 单次回退 lastKnownGood）。窗口由一体化 Desktop Chrome（置顶
 * WebContentsView：顶栏 + 汉堡菜单 + Harness 控制面 + 状态胶囊）与
 * Compatibility View（独立 WebContentsView 承载未经篡改的官方 Web UI）
 * 组成；titleBarOverlay 保留 Windows 原生窗口按钮。控制数据流唯一：
 * launcher-state + controller + discovery → main 构建 ControlModel →
 * 窄 preload → Chrome renderer → 封闭命令联合 → main → controller。
 * 关闭最后一个窗口时停止服务并退出。
 * @module @see-sol-lab/deepseekgui/main
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, type FSWatcher, unlinkSync, watch, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { once } from 'node:events'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, hostname, release, version as osVersion } from 'node:os'
import https from 'node:https'
import { app, BrowserWindow, clipboard, crashReporter, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray, WebContentsView } from 'electron'
import { HarnessController, type HarnessRuntimeAdapter } from './harness-controller.ts'
import {
  buildControlModel,
  MEMORY_GLOBAL_CONTENT_MAX,
  parseControlCommand,
  type DesktopControlCommand,
  type DesktopControlModel,
  type DiagnosticsView,
  type PluginOperationView,
} from './control-model.ts'
import { createControlDispatcher, type ControlDispatchDeps, type ControlStateHolder } from './control-dispatch.ts'
import {
  createLauncherStateStore,
  resolveHarnessHome,
  restoreDefaultLauncher,
  type LauncherStateStore,
  type LauncherStateV1,
} from './launcher-state.ts'
import { discoverProfiles, type DiscoveredProfile, type ProfileDiscoveryV1 } from './profile-discovery.ts'
import { atomicWriteFile } from './atomic-write.ts'
import { seedManagedHome, seedProjectAgents } from './memory-seed.ts'
import { appendDesktopEvent } from './desktop-events.ts'
import { sameHarnessSelection } from './launcher-state.ts'
import { describeLegacyCredentialsLayout, describeRuntimeVersionSkew, detectRuntimeVersionSkew, hasLegacyCredentialsLayout } from './runtime-skew.ts'
import { exportHeadlessDiagnostics } from './diagnostics-export.ts'
import { createMigrationControl } from './migration-control.ts'
import { createUpdateControl } from './update-control.ts'
import { startControlBridge } from './control-bridge.ts'
import { configureBrowserPaneProxy, releaseCrashedPane } from './browser-pane-runtime.ts'
import { readSessionPressure } from './session-pressure.ts'
import { startDirectoryPickerBridge } from './picker-bridge.ts'
import { revealTargetOf } from './reveal-target.ts'
import {
  isFirstRunPending,
  markFirstRunCompleted,
  resolveFirstRunState,
  type FirstRunState,
} from './first-run.ts'
import { offerSessionImport as offerImport } from './session-import-offer.ts'
import { sessionDirsResult } from './session-import.ts'
import { maskWindowsLiterals, redactSecrets } from './redact.ts'
import { aboutDetailText, pnpmVersionFromExecpath } from './about.ts'
import { computeRecoveryNotice, type RecoveryNotice } from './recovery-notice.ts'
import { runDesktopCommand, type DesktopOperation } from './desktop-command.ts'
import {
  BUILTIN_PLUGIN_NAMES,
  buildPluginInventory,
  buildPluginOperationArgs,
  appendPluginOutput as appendOutput,
  isRelativeSpec,
  parseManifestDependencies,
  pluginConfirmText,
  shouldShowHandoff,
  validateLocalSpecTarget,
  validatePluginRequest,
  validatePluginTarget,
  verifyPluginPostCheck,
  type ManifestDependenciesResult,
  type PluginAction,
  type PluginOperationRequest,
  type PluginSnapshot,
} from './plugin-service.ts'
import {
  assembleDiagnosticsBundle,
  buildInfoLines,
  buildInfoText,
  collectLogFamily,
  formatStampLocal,
  writeDiagnosticsBundle,
} from './diagnostics-service.ts'
import {
  parseHarnessLocalePreference,
  parseHarnessThemePreference,
  readHarnessSettingsText,
} from './harness-settings.ts'
import {
  readInstallStampText,
  readUpdateFeed,
} from './update-view.ts'
import {
  readVerifiedRecord,
  updateCacheDir,
} from './update-cache.ts'
import {
  createUpdateRunnerDeps,
  runUpdateHandoff,
  type UpdateRunnerDeps,
} from './update-runner.ts'
import {
  buildTerminalWelcome,
  hasPowerShell7,
  resolveSessionCwdById,
  resolvePosixTerminalShell,
  resolveTerminalCwd,
  resolveTerminalShell,
  withPath,
  writeTerminalShims,
} from './terminal-service.ts'
import { createHarnessApi, type HarnessApi } from './harness-api.ts'
import { homePointerPath, reclaimableHome, syncHomePointer, writeHomePointer } from './home-pointer.ts'
import { exchangeSessionCookie, readHarnessOutput } from './harness-auth.ts'
import { installConfirmDetail, queryRunningSessionCount, quitConfirmDetail } from './quit-confirm.ts'
import { stringsFor, type ChromeStrings } from './chrome/view-model.ts'
import { buildFeedbackDiagnostics, FEEDBACK_LOG_TAIL_LINES } from './feedback-diagnostics.ts'
import { MAIN_LOG_FILENAME } from './diagnostics-service.ts'
import { buildIssueBody, feedbackTriagePrompt, githubNewIssueUrl, issueTitle } from './feedback-issue.ts'
import { feedbackExportFileName, feedbackGatewayConfigWarning, resolveFeedbackGatewayUrl, submitFeedbackToGateway } from './feedback-gateway.ts'
import type { FeedbackView } from './control-model.ts'
import { createPermissionControl } from './permission-control.ts'
import {
  ACTIVE_RUN_FILENAME,
  collectCrashDumpEvidence,
  parseActiveRunMarker,
  serializeActiveRunMarker,
} from './crash-evidence.ts'
import {
  applyRestore,
  bootHealthySettleAction,
  describePluginFailure,
  describeWriteFailure,
  detectDrift,
  detectRecoveryDrift,
  hashesOfFacts,
  isJournalPending,
  parseRecoveryJournal,
  planRestore,
  readWhitelistFacts,
  RECOVERY_DIRNAME,
  RECOVERY_JOURNAL_FILENAME,
  RECOVERY_SNAPSHOTS_DIRNAME,
  recoveryPlan,
  serializeRecoveryJournal,
  writeWhitelistSnapshot,
  type PluginFailureCause,
  type RecoveryFacts,
  type PluginRecoveryJournal,
} from './plugin-recovery.ts'
import { trayMenuTemplate, type TrayAction } from './tray.ts'
import {
  createUiStateStore,
  effectiveTheme,
  type DesktopUiStateV1,
  type ThemePreference,
  type UiStateStore,
} from './ui-state.ts'
import { clampBoundsToWorkArea, nextWindowState } from './window-state.ts'
import { readVersionInfoOrDegraded, type DeepSeekGUIVersionInfo } from './version-info.ts'
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  READY_TIMEOUT_MS,
  classifyLinkOpen,
  createServiceLogWriter,
  portInUse,
  repoRoot,
  resolveDshCommand,
  resolveDshLaunch,
  stopProcess,
  waitForServer,
  type ServiceLogWriter,
} from './dsh-service.ts'

/** 窗口与产品名称；窗口标题固定为该名称。 */
const APP_NAME = 'DeepSeekGUI'

/** Desktop Chrome 顶栏高度（px）；Compatibility View 从其下方开始。 */
const CHROME_HEIGHT = 47

/** 窗口最小尺寸（px）；低于该尺寸会破坏 Chrome 与内容布局。 */
const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 520

// ---- 内置浏览器 pane（B3-11，住户 2026-08-23 定；体验对标 Codex）----
// browser-plugin 的执行面经 CDP 接管这块 WebContentsView：Electron 在启动
// 早期打开 loopback 远程调试端口（Chromium 只绑 127.0.0.1），插件用
// playwright-core connectOverCDP 连入并只操作带标记 URL 的这一个 target。
// 端口随机、无路径可枚举；本机进程边界之内（同用户权限下本就无隔离），
// 与 3080/控制桥/SSRF 代理同一信任面。必须在 app ready 之前设置。
//
// 为什么不预先占坑：这一行必须跑在 app ready 之前，而那个时点没有同步
// 的端口探测手段（listen 是异步的，等不到）。所以碰撞无法根除，只能让
// 它可诊断——插件连不上时给的是"端口可能被占用，重启会换一个"，而不是
// 一句 ECONNREFUSED（见 browser.ts 的 cdpConnectFailure）。
const BROWSER_PANE_CDP_PORT = 20000 + Math.floor(Math.random() * 20000)
// headless 诊断导出（--export-diagnostics）不建窗口、更不会有浏览器 pane，却照样 开了这个端口，还往终端吐一行 `DevTools listening on ws://…`——用户跑取证命令时看到 它只会困惑（2026-08-26 人工验收发现）。这里直接读 argv：EXPORT_DIAGNOSTICS 常量 声明在几百行之后，而这一句必须跑在 app ready 之前。
if (!process.argv.includes('--export-diagnostics')) {
  app.commandLine.appendSwitch('remote-debugging-port', String(BROWSER_PANE_CDP_PORT))
}

/** pane 宽度占内容区比例（Codex 同款右侧分栏）。 */
const BROWSER_PANE_RATIO = 0.45

/**
 * pane 初始页：双语空状态引导（Codex 同款「开始浏览」形态），同时充当插件在
 * CDP targets 里识别这块 view 的 marker——插件按 ensure 返回的当前 URL 认领，
 * 绝不碰其他 target。data URL 无网络请求，不经 SSRF 代理，天然安全。
 */
const BROWSER_PANE_MARKER_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>deepseekgui-browser-pane</title><style>
  body { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 100vh;
         background: #f9f8f8; color: #1e232c; font-family: system-ui, "Segoe UI", sans-serif; }
  html[data-theme='dark'] body { background: #0a0a0a; color: #e8e8ea; }
  .box { text-align: center; opacity: 0.75; }
  .globe { font-size: 40px; margin-bottom: 14px; }
  .title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
  .hint { font-size: 12.5px; color: #6b7280; line-height: 1.7; }
  html[data-theme='dark'] .hint { color: #9aa1ac; }
  .vision { font-size: 12px; color: #9aa1ac; line-height: 1.7; margin-top: 10px; }
  html[data-theme='dark'] .vision { color: #7c828d; }
</style></head><body><div class="box">
  <div class="globe">🌐</div>
  <div class="title">浏览器面板 · Browser Panel</div>
  <div class="hint">让智能体打开网页，内容会显示在这里。<br>Ask the agent to open a page — it renders here.</div>
  <div class="vision">查看网页截图需要支持图片输入的模型。<br>Reading page screenshots requires a model that supports image input.</div>
</div></body></html>`)}`

/** pane 开合动画时长（ms）；逐帧 setBounds，Codex 式丝滑而非硬切。 */
const BROWSER_PANE_ANIMATION_MS = 150

/** 窗口默认尺寸（无保存几何时）。 */
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800

/** 窗口几何保存的 debounce（ms）：事件边界保存，绝不轮询。 */
const WINDOW_SAVE_DEBOUNCE_MS = 500

/** 两个生效主题下的窗口背景色（唯一普通背景路径）。 */
/**
 * 窗口保底色：同时喂给窗口底色与 titleBarOverlay（右上角原生按钮那一块）。
 * 内容没铺满、启动未加载完、边缘露底时露出的就是它，所以必须与官方
 * 深/浅色页面的底色一致——差一点就会在原生按钮周围看到一圈异色。
 */
const THEME_BACKGROUND = { dark: '#0a0a0a', light: '#f9f8f8' } as const

/**
 * Windows 原生窗口按钮那一块（titleBarOverlay）的底色。
 *
 * 不能用页面保底色：顶栏铺着底图，而这块是原生实色——一块纯色贴在一张图
 * 旁边，接缝会像打了个补丁（实机抓获，浅色下尤其明显：底图那处是天蓝
 * #cee1fd，我们却贴了近白 #f9f8f8）。这两个值取自 bar-*.jpg 右侧区域的
 * 实际平均色，让它融进顶栏而不是压在上面。
 * 底图换了就要重新采样，别凭印象改。
 */
const TITLE_BAR_OVERLAY = {
  dark: { color: '#000619', symbol: '#e8e8ea' },
  light: { color: '#cee1fd', symbol: '#3c3c40' },
} as const

/** 无 smoke 标志时是否显示 GUI 错误框；smoke 模式只向 stdout 报告。 */
const SMOKE = process.env.DSH_DESKTOP_SMOKE === '1'

/**
 * 应用监听端口（P9-4）：生产恒为 DEFAULT_PORT (3080)。e2e/打包验收经
 * DEEPSEEKGUI_TEST_PORT 显式指定测试实例的端口——测试拥有自己的端口
 * 事实，绝不与住户正在运行的 3080 实例争用、更不许「清场 3080」。
 * 非法值忽略（回到 DEFAULT_PORT）；APP URL、readiness、占用检测、
 * Compatibility View 与控制桥的 baseUrl 全部消费同一事实。
 */
const APP_PORT = (() => {
  const raw = process.env.DEEPSEEKGUI_TEST_PORT
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_PORT
  const value = Number(raw)
  return value >= 1024 && value <= 65535 ? value : DEFAULT_PORT
})()

/** 当前 locale 的文案字典（模块级；与 whenReady 内 localeOf() 同一判据）。 */
function moduleDict(): ChromeStrings {
  return stringsFor(desktopLocaleZh() ? 'zh' : 'en')
}

/**
 * 字典取值 + 占位符替换（{key} → 参数值）。缺键回显键名便于发现。
 * @param dict - 文案字典。
 * @param key - 键名。
 * @param params - 占位符替换（可选）。
 * @returns 文案文本。
 */
function dictText(dict: ChromeStrings, key: string, params?: Record<string, string>): string {
  const text = dict[key] ?? key
  if (params === undefined) return text
  return Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, value), text)
}

/** 报告一个让用户能理解的错误，然后退出（D29：title/message 按 locale 取词）。 */
function failLocalized(dict: ChromeStrings, titleKey: string, messageKey: string, params: Record<string, string>, code: number): void {
  const title = dictText(dict, titleKey)
  const message = dictText(dict, messageKey, params)
  if (SMOKE) {
    console.error(`[deepseekgui] ${title}: ${message}`)
  } else {
    dialog.showErrorBox(title, message)
  }
  app.exit(code)
}

/**
 * launcher state 损坏时的救援对话框：恢复默认（先原样备份坏文件为
 * .invalid-<timestamp>，再原子写默认状态）/ 打开配置所在文件夹 / 退出。
 * 备份失败必须明确报错并保持原文件不动；绝不删除或改写任何 DSH_HOME、
 * Existing Home、session、credential、Profile 或 plugin。
 * @param store - launcher 状态存取器。
 * @param userDataDir - userData 目录（"打开文件夹"的目标）。
 * @param reason - 读取失败的脱敏原因。
 * @returns true = 已恢复默认状态可继续启动；false = 用户退出。
 */
async function rescueLauncherState(store: LauncherStateStore, userDataDir: string, reason: string): Promise<boolean> {
  if (SMOKE) {
    console.error(`[deepseekgui] launcher state 损坏（${reason}）；smoke 模式不弹救援对话框，退出`)
    return false
  }
  for (;;) {
    const dict = moduleDict()
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [dictText(dict, 'dialog.rescue.restore'), dictText(dict, 'dialog.rescue.open-config'), dictText(dict, 'dialog.quit-short')],
      defaultId: 0,
      cancelId: 2,
      message: dictText(dict, 'dialog.rescue.title'),
      detail: dictText(dict, 'dialog.rescue.detail', { file: store.filePath, reason: redactSecrets(reason) }),
    })
    if (choice.response === 2) return false
    if (choice.response === 1) {
      await shell.openPath(userDataDir)
      continue
    }
    try {
      // 先原样备份坏文件，备份成功后才原子写默认；备份失败会在这里
      // 抛出且原文件保持原样（绝不带着未备份的坏文件继续覆盖）。
      restoreDefaultLauncher(store.filePath, store, Date.now, desktopLocaleZh())
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        noLink: true,
        buttons: [dictText(dict, 'dialog.ok')],
        message: dictText(dict, 'dialog.rescue-restore-failed.title'),
        detail: String(error instanceof Error ? error.message : error),
      })
      continue
    }
    return true
  }
}

/**
 * 首启接回（人工测试 #25，莉莉丝 2026-09-11 定）：上次卸载选了"保留数据"，
 * 而数据目录早已搬到 AppData 之外——launcher state 随 userData 被清，程序
 * 不知道那份数据在哪。指针（home-pointer.ts）活在 %LOCALAPPDATA%，这里读它
 * 问一句。两个按钮都不删任何东西：接着用 = 把 launcher 指回去；从新目录
 * 开始 = 只清指针，免得每次启动都问。SMOKE 模式不弹窗、不接回。
 * @param store - launcher state 存取器（已确认可读）。
 * @param pointerPath - 指针文件路径。
 */
async function offerReclaimedHome(store: LauncherStateStore, pointerPath: string): Promise<void> {
  if (SMOKE) return
  const state = store.read()
  const root = reclaimableHome(state, pointerPath)
  if (root === null) return
  const dict = moduleDict()
  const choice = await dialog.showMessageBox({
    type: 'question',
    noLink: true,
    buttons: [dictText(dict, 'dialog.reclaim.use'), dictText(dict, 'dialog.reclaim.fresh')],
    defaultId: 0,
    cancelId: 1,
    message: dictText(dict, 'dialog.reclaim.title'),
    detail: dictText(dict, 'dialog.reclaim.detail', { path: root }),
  })
  if (choice.response === 0) {
    const selection = { ...state.active, home: { kind: 'managed' as const, root } }
    store.write({ ...state, active: selection, lastKnownGood: selection })
    return
  }
  writeHomePointer(pointerPath, null)
}

/** 官方语言偏好的本地缓存；null = 用户从未在设置里选过语言，跟随系统。
 * theme 的教训原样适用（D29 收口）：壳不持有第二份语言偏好，只读官方的
 * `locale.preference` 并跟着它变。官方 web 侧未存偏好时按 navigator 语言
 * 探测（≈系统语言），所以 null 兜底到 app.getLocale() 时两边天然一致；
 * 一旦用户在设置里切了语言，settings.yaml 落盘、watcher 刷进来，壳的
 * 菜单/托盘/对话框全部跟切。
 */
let harnessLocalePreference: 'zh' | 'en' | null = null

/** 壳 UI 是否使用中文：官方语言偏好优先，未存时跟随系统语言。 */
function desktopLocaleZh(): boolean {
  if (harnessLocalePreference !== null) return harnessLocalePreference === 'zh'
  return app.getLocale().toLowerCase().startsWith('zh')
}

/** settings 文档监听器（切换 Home 时换目标；退出时释放）。 */
let harnessThemeWatcher: FSWatcher | undefined
let harnessThemeGeneration = 0
/** 文档写入的落定窗口：一次保存常触发多次事件，合并后再读。 */
const HARNESS_THEME_SETTLE_MS = 120

/**
 * 监听官方 settings 文档，偏好变了就刷新外观。
 * 用户在 Harness 的「外观」里切换主题、或任何进程改了那份文档，都会走到
 * 这里——我们不持有偏好，只对它的变化做出反应。读失败不抛：外观降级成
 * system，功能不受影响。
 *
 * 首个事件立刻响应，之后的才合并。官方那半边是本地 React 状态、点下去就
 * 变；我们要多走一趟文件事件，任何等待都会被看成"卡了一下"（实机肉眼
 * 可辨：官方面板先变、我们后变）。后沿合并仍然保留，一次保存触发多个
 * 事件时不会重复刷新。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 */
function watchHarnessTheme(dshHome: string): void {
  const generation = ++harnessThemeGeneration
  harnessThemeWatcher?.close()
  harnessThemeWatcher = undefined
  let coolDown: NodeJS.Timeout | undefined
  const refresh = (): void => {
    if (generation !== harnessThemeGeneration) return
    // 同一份文档同一个 watcher 管两个偏好：主题与语言（D29 收口）。
    // 正文只读一次再解析两次：两次独立 readFileSync 除了多一倍 IO，还开了
    // 一个窗口——两个偏好可能来自文件的两个版本（buildModel 早就为同一个
    // 理由避开这种写法）。任一变化都 broadcast——model 带 locale，
    // chrome 菜单/托盘/胶囊随之重渲染。
    const text = readHarnessSettingsText(dshHome)
    const nextLocale = parseHarnessLocalePreference(text)
    const localeChanged = nextLocale !== harnessLocalePreference
    if (localeChanged) harnessLocalePreference = nextLocale
    const next = parseHarnessThemePreference(text)
    if (next !== themePreference) {
      applyTheme(next)
      broadcastModel()
      return
    }
    if (localeChanged) broadcastModel()
  }
  try {
    // 必须 watch **目录**再按文件名过滤，不能直接 watch 那个文件（P8-D16）。
    //
    // 官方 settings provider 落盘走的是 writeFileAtomic——写临时文件再 rename
    // 顶替。而 fs.watch 盯住一个文件时，句柄跟着的是被顶替掉的那一个：第一次
    // 原子写之后 watcher 就永远聋了。表现出来正好是住户报的那条：走我们菜单
    // 切主题一切正常（setTheme 成功后本地显式调了 applyTheme），走官方「外观」
    // 切换则只有官方面板变色，底图、顶栏、右上角原生按钮全留在旧主题。
    //
    // 目录事件不受 rename 影响——顶替动作本身就发生在这个目录里。
    harnessThemeWatcher = watch(dshHome, (_event, filename) => {
      // filename 在个别平台可能为 null；那种情况宁可多刷一次，也不漏掉。
      if (filename !== null && basename(filename) !== 'settings.yaml') return
      if (coolDown !== undefined) return
      refresh()
      // 冷却窗口内的后续事件丢弃，窗口结束再补一次：既不重复刷新，
      // 也不会漏掉"写入分两批落地"的情况。
      coolDown = setTimeout(() => {
        coolDown = undefined
        refresh()
      }, HARNESS_THEME_SETTLE_MS)
    })
    harnessThemeWatcher.on('error', (error) => { console.error('[deepseekgui] settings watcher:', error) })
  } catch {
    // 连 DSH_HOME 目录本身都还不存在：保持默认，等下一次启动接上。
    // 与「监听文件」时代的差别值得记一笔：那时 settings.yaml 尚未创建就会落到
    // 这里，全新 Home 的首次写入要等下次启动才接得上；改成监听目录之后，文件
    // 被创建的那一刻本身就是一个目录事件，这条降级只剩「目录不存在」一种情形。
  }
}

/**
 * Read both shell preferences from one active Home and follow its settings file.
 * The second call after first boot is required for a fresh Managed Home: its
 * directory does not exist when the pre-boot call first tries to watch it.
 * @param dshHome - Active DSH_HOME absolute path.
 */
function followHarnessPreferences(dshHome: string): void {
  const text = readHarnessSettingsText(dshHome)
  applyTheme(parseHarnessThemePreference(text))
  harnessLocalePreference = parseHarnessLocalePreference(text)
  watchHarnessTheme(dshHome)
}

/** 生效主题下的窗口背景页（最底层的海；compat view 透明后由它透上来）。 */
function loadWindowBackdrop(win: BrowserWindow, theme: 'dark' | 'light'): void {
  void win.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
  ).catch(() => undefined)
}

/**
 * 背景页上的启动态（P8-D5）。
 *
 * 官方内容区还空着的那几十秒里，这一层是唯一能跟用户说话的地方：chrome view
 * 平时只有顶栏那点高度，compat view 正是还没有内容的那一个。
 *
 * 这里只推相位与语言两个属性，不推文案——三种相位、两种语言的句子静态写在
 * backdrop.html 里，由 CSS 选出该显示的那一句，背景页因此仍然不跑任何脚本。
 * starting/switching/recovering 之外的相位一律传空串：backdrop 的属性选择器
 * 匹配不到，那块就自己消失，不需要第二条隐藏指令。
 * @param win - 主窗口（背景页跑在它自己的 webContents 上）。
 * @param model - 本次广播的控制模型，相位与 locale 都取自它。
 */
function loadWindowBootNotice(win: BrowserWindow, model: DesktopControlModel): void {
  const phase = model.status.phase
  const boot = phase === 'starting' || phase === 'switching' || phase === 'recovering' ? phase : ''
  void win.webContents.executeJavaScript(
    `document.documentElement.dataset.boot = ${JSON.stringify(boot)};`
    + `document.documentElement.dataset.locale = ${JSON.stringify(model.locale)}`,
  ).catch(() => undefined)
}

/**
 * 依据官方主题偏好刷新整扇窗的外观。
 * 偏好本身不由我们持有——读 Harness 的 ui-theme.preference（`system` 交给
 * nativeTheme 解算），我们只把它映射成顶栏、背景图与 Compatibility View
 * 的视觉。参数保留是为了让调用方能显式传入刚读到的值，避免重复读盘。
 * @param preference - 官方主题偏好。
 */
function applyTheme(preference: ThemePreference): void {
  themePreference = preference
  effectiveThemeNow = effectiveTheme(preference, nativeTheme.shouldUseDarkColors)
  mainWindow?.setBackgroundColor(THEME_BACKGROUND[effectiveThemeNow])
  // titleBarOverlay 的颜色只在建窗时给过一次：不在这里跟着改，切主题后
  // 右上角那三个原生按钮会留在旧配色里，跟顶栏对不上（实机抓获）。
  applyTitleBarOverlay()
  if (mainWindow !== undefined) loadWindowBackdrop(mainWindow, effectiveThemeNow)
  applyBrowserPaneTheme()
  // 终端侧窗刻意不在这里出现：它永远深色（P8-D28，住户定），不跟主题。
}

/**
 * 把当前主题同步到内置浏览器 pane。
 *
 * 两件事：pane 的底色（导航空窗期露出的那一层），以及**我们自己的**空状态
 * 引导页。用户打开的外部网页一律不碰——往别人的页面里注入 data-theme 既没有
 * 意义，也越过了这块 view 的边界。判据是当前 URL 就是我们那张 marker 页。
 *
 * 2026-08-27 发布前排查补上：此前底色写死 #ffffff、空状态页写死浅色配色，
 * 于是深色主题下打开浏览器面板会露出一整块白，属于住户点名要根除的
 * 「只换一部分」。
 */
function applyBrowserPaneTheme(): void {
  const view = browserPaneView
  if (view === undefined || view.webContents.isDestroyed()) return
  view.setBackgroundColor(THEME_BACKGROUND[effectiveThemeNow])
  if (view.webContents.getURL() !== BROWSER_PANE_MARKER_URL) return
  void view.webContents.executeJavaScript(
    `document.documentElement.dataset.theme = ${JSON.stringify(effectiveThemeNow)}`,
  ).catch(() => undefined)
}

/** 把当前主题同步到 Windows 原生窗口按钮那一块（titleBarOverlay）。 */
function applyTitleBarOverlay(): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  try {
    mainWindow.setTitleBarOverlay({
      color: TITLE_BAR_OVERLAY[effectiveThemeNow].color,
      symbolColor: TITLE_BAR_OVERLAY[effectiveThemeNow].symbol,
      height: CHROME_HEIGHT - 1,
    })
  } catch {
    // 非 Windows 或未启用 overlay 时该 API 不可用：外观降级，不影响功能。
  }
}

/** 首次 close-to-tray 的一次性非阻断说明（tray 气泡）；确认位写进 ui-state。 */
function showCloseToTrayNoticeOnce(): void {
  const store = uiStore
  if (store === undefined || tray === undefined) return
  const { state } = store.read()
  if (state.closeToTrayNoticeAcknowledged) return
  try {
    store.write({ ...state, closeToTrayNoticeAcknowledged: true })
  } catch (error) {
    console.error(`[deepseekgui] UI 状态写入失败: ${String(error instanceof Error ? error.message : error)}`)
  }
  // 气泡是非阻断说明；即便显示失败，确认位已写，绝不反复骚扰。
  const dict = moduleDict()
  tray.displayBalloon({
    iconType: 'info',
    title: dictText(dict, 'dialog.tray-balloon.title'),
    content: dictText(dict, 'dialog.tray-balloon.content'),
  })
}

/** 显式 Quit 的唯一入口（Chrome 菜单与 Tray 共用）：确认后走 orderly cleanup。 */
async function requestQuit(): Promise<void> {
  if (quitting) return
  if (!SMOKE) {
    // P7-F：detail 从免责声明升级为真实信息——官方 session.list 的
    // running 位数出在跑会话数（1500ms 硬超时，查不到/失败退回旧文案，
    // 查询绝不阻塞退出）；确认框本身保持既有正确设计（defaultId/cancelId
    // = 1 默认焦点在「取消」、noLink）。
    const dict = stringsFor(desktopLocaleZh() ? 'zh' : 'en')
    const detail = harnessApi === undefined
      ? quitConfirmDetail(null, dict)
      : quitConfirmDetail(await queryRunningSessionCount(harnessApi), dict)
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [dictText(dict, 'dialog.quit-short'), dictText(dict, 'dialog.cancel')],
      defaultId: 1,
      cancelId: 1,
      message: dictText(dict, 'dialog.quit.title'),
      detail,
    })
    if (choice.response !== 0) return
  }
  await proceedQuit()
}

/**
 * 真正的退出流程：controller.stop（kill 完整 DSH process tree + await
 * cleanup）→ destroy tray/views → 结束进程。OS shutdown 与 installer
 * handoff 都走这一条，绝不各自复制一份清理。调用一次后 quitting 置位：
 * 窗口 close 不再隐藏。
 * @param finish - 清理完成后如何结束进程。默认 `app.quit()`；installer
 * handoff 传 `app.exit(0)`（安装程序已启动，不再走 quit 事件链）。
 */
async function proceedQuit(finish: () => void = () => { app.quit() }): Promise<void> {
  if (quitting) return
  quitting = true
  try {
    await controller?.stop()
    // 终端清理必须被等待：cancel 的 taskkill 整树完成之后才 app.quit，
    // "Quit 后无子进程"是等待过的事实，不是赶时间窗的巧合。
    if (terminalOperation !== undefined) {
      await terminalOperation.cancel()
      terminalOperation = undefined
    }
    // 插件操作同样必须被等待（maintenance 槽的 child tree）。
    if (pluginOperationHandle !== undefined) {
      await pluginOperationHandle.cancel()
      pluginOperationHandle = undefined
    }
    terminalWindow?.destroy()
    terminalWindow = undefined
    tray?.destroy()
    tray = undefined
  } catch (error) {
    quitting = false
    if (!SMOKE) dialog.showErrorBox(desktopLocaleZh() ? '退出尚未完成' : 'Shutdown did not finish', redactSecrets(String(error)))
    throw error
  }
  // orderly quit 的最后一步：删除 active-run marker。下一次启动看到它还
  // 在，才会把上一次标记为"未正常退出"（证据，不是断言）。
  try {
    unlinkSync(join(app.getPath('userData'), ACTIVE_RUN_FILENAME))
  } catch {
    // 清理失败只意味着下一次启动会多记一条"未正常退出"证据，无害。
  }
  finish()
}

// OS shutdown / logoff（Electron 43 起是窗口级事件，在 createWindow 里
// 注册）：绝不被确认框无限阻塞，走无交互的 orderly cleanup。

// 任何来源的 app.quit()——playwright 驱动（CDP Browser.close → quit
// 流程）、Electron 内部、将来的更新器——都路由进唯一的 orderly
// cleanup。没有这一层，close-to-tray 的窗口 close 拦截会把整个
// app.quit() API 拦废：quit 流程走到窗口 close 被 preventDefault，
// 应用永不退出（e2e teardown 挂死、实例泄漏占住端口正是这么来的）。
// 程序化 quit 不弹确认框——确认框只属于 Tray/菜单的用户显式入口
// （requestQuit）；proceedQuit 置位 quitting 后二次 quit 直接放行。
app.on('before-quit', (event) => {
  if (!quitting) {
    event.preventDefault()
    void proceedQuit()
  }
})

app.setName(APP_NAME)

// headless 诊断导出：`DeepSeekGUI.exe --export-diagnostics`。该模式绝不启动
// Harness/Profile/第三方插件/主窗口/tray、绝不监听 3080、绝不执行
// plugin recovery 或 update——只把本地诊断证据组装成一个 bundle 并输出
// 路径。单实例锁对它不适用：正在运行的实例与其并行导出只读证据无害。
const EXPORT_DIAGNOSTICS = process.argv.includes('--export-diagnostics')

// 便携/隔离重定位：Chromium 标准开关 --user-data-dir。Windows 上
// app.getPath('userData') 走 Known Folder API，不跟随 APPDATA 环境变量；
// launcher state、单实例锁、Managed Home、诊断日志全部随 userData 走，
// 所以必须在 requestSingleInstanceLock() 之前生效。相对路径按进程当前
// 目录解析为绝对路径。
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride !== '') {
  app.setPath('userData', resolve(userDataOverride))
}

// 单实例：第二个实例立即退出，并把已有窗口带到前台。headless 导出模式
// 不参与单实例语义（只读证据，不启动任何服务）——它连锁都不请求：请求
// 本身就会在没有 GUI 在跑时**拿到**锁，导出的那几十秒内用户双击启动
// DeepSeekGUI 会被判成第二实例而静默退出。而"GUI 起不来所以来导诊断"正是
// 用户最可能同时再试一次启动的场景。
const isPrimaryInstance = EXPORT_DIAGNOSTICS || app.requestSingleInstanceLock()
if (!isPrimaryInstance) {
  app.exit(0)
}
/**
 * 主进程日志：把 console.error / console.warn 镜像到 userData 下的
 * deepseekgui-main.log（见 MAIN_LOG_FILENAME 的注释）。只在真正要跑的主实例
 * 上装：headless 导出与第二实例什么都不启动，也不该去轮转别人的日志。
 * 未处理的 Promise 拒绝也记一笔——那是打包态最常见的"静悄悄失败"。
 * uncaughtException 刻意不接：接了就会吞掉 Electron 的崩溃对话框。
 */
function installMainLog(): ServiceLogWriter | undefined {
  if (EXPORT_DIAGNOSTICS || !isPrimaryInstance) return undefined
  const writer = createServiceLogWriter(join(app.getPath('userData'), MAIN_LOG_FILENAME))
  const render = (value: unknown): string => {
    if (value instanceof Error) return value.stack ?? value.message
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      original(...args)
      writer.write(`${new Date().toISOString()} [${level}] ${args.map(render).join(' ')}\n`)
    }
  }
  process.on('unhandledRejection', (reason) => {
    console.error('[deepseekgui] unhandled promise rejection:', reason)
  })
  app.on('will-quit', () => { writer.close() })
  return writer
}
installMainLog()

app.on('second-instance', () => {
  // 常驻模式：窗口可能被 X 隐藏（tray 常驻）——第二个实例必须
  // show + focus 已有窗口，绝不 spawn 第二个 Harness。
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

/** 主窗口（second-instance 聚焦目标）。 */
let mainWindow: BrowserWindow | undefined

// ---- B5-P6 通知点击的一次性会话导航（Web 侧官方事件消费端推 notify 命令）----
// pendingNavigate 由 notify 点击写入、随下一次 buildModel 进入控制模型；
// nonce 每次点击递增，Web 的 DesktopActions 按 nonce 恰好消费一次。
let pendingNavigate: { sessionId: string; nonce: number } | null = null
let navigateNonce = 0

/** Desktop Chrome view（顶层）与 Compatibility View（官方 Web UI）。 */
let chromeView: WebContentsView | undefined
let compatView: WebContentsView | undefined

/** 系统托盘（常驻入口；菜单全部从唯一模型重建）。 */
let tray: Tray | undefined

/** 正在走真正的退出流程（X 不再隐藏窗口、跳过确认框）。 */
let quitting = false

/** 跨 await 之后再查 `quitting` 用它——TS 会沿用 await 之前的收窄结果。 */
function quittingNow(): boolean {
  return quitting
}

/** DSH Terminal 窗口与 pty host 操作（broker 单例操作）。 */
let terminalWindow: BrowserWindow | undefined
let terminalOperation: DesktopOperation | undefined
let terminalSize: { cols: number; rows: number } | undefined

/** 菜单是否展开（决定 Chrome view 占顶栏还是全窗；由 main 统一管理 bounds）。 */
let chromeExpanded = false

/** DSH 子进程句柄与诊断日志状态（controller 协调，adapter 拥有句柄）。 */
const service: {
  child: ChildProcess | undefined
  stopped: boolean
  /** boot 三步是否已全部完成：完成前退出由 recovery 路径处理，不弹错。 */
  bootSettled: boolean
  log: ServiceLogWriter | undefined
  logPath: string | undefined
  /** dsh 0.1.2 launch token（从服务 stdout 解析；每次 spawn 重置）。 */
  launchToken: string | null
} = {
  child: undefined,
  stopped: false,
  bootSettled: false,
  log: undefined,
  logPath: undefined,
  launchToken: null,
}

/**
 * 官方 browser-auth 会话 cookie（`name=value`；由 launch token 交换而来）。
 * 模块级单份：token 只活在本进程，绝不落日志、诊断或持久配置。服务每次
 * 重启（新 token）都会重新交换。
 */
let harnessSessionCookie: string | null = null

/**
 * 句末补一个句号——但只在它自己没有终止标点时（P8-D14）。
 *
 * 上游的 failure.message 有的自带句号、有的不带，而拼接处无条件补一个「。」，
 * 于是用户看到「…再重新启动 DeepSeekGUI。。请查看启动它的终端输出。」。
 * @param text - 待拼接的句子。
 * @returns 恰好一个终止标点的句子。
 */
function sentence(text: string): string {
  if (/[。！？.!?]$/.test(text.trimEnd())) return text.trimEnd()
  return desktopLocaleZh() ? `${text.trimEnd()}。` : `${text.trimEnd()}.`
}

/** 面向当前形态用户的诊断出处：打包 GUI 指向本地日志，开发/smoke 指向终端。 */
function diagnosticsHint(): string {
  const zh = desktopLocaleZh()
  return service.logPath !== undefined
    ? (zh ? `诊断日志：${service.logPath}` : `Diagnostics log: ${service.logPath}`)
    : (zh ? '请查看启动它的终端输出。' : 'See the terminal output where it was started.')
}

/** 停止 DSH 子进程（幂等，一次 stop 之后可以安全 restart）。 */
async function stopService(): Promise<void> {
  const child = service.child
  if (child === undefined) return
  service.stopped = true
  try {
    await stopProcess(child, undefined, undefined, undefined, desktopLocaleZh())
  } catch (error) {
    // 没能停下来就不能假装停了：保留 child 引用，让后续状态如实反映进程
    // 还活着，并把失败抛给调用方决定怎么办（提示用户，还是强制退出）。
    service.stopped = false
    throw error
  }
  service.child = undefined
  service.stopped = false
}

/** Client Loader settle 的超时（毫秒）：超时 = boot 失败（page-load）。 */
const CLIENT_SETTLE_TIMEOUT_MS = 30_000

/** settle 轮询的间隔（毫秒）。 */
const CLIENT_SETTLE_POLL_MS = 250

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 等官方 UI 挂载 + DeepSeekGUI client 插件 settle（theme plugin 的 apply
 * 成功标记）。marker === false（插件激活失败）立即失败；超时失败。
 * 这是 boot 健康的一部分：HTTP 已回但 loader 拒绝 composition / 页面
 * 卡在 boot 时同样判失败，绝不让"坏插件"悄无声息地通过。
 *
 * Compatibility View 只等官方 UI 挂载：那个 settle 标记是**皮肤插件**打的，
 * 而 0.1.5 起 compat 模式一条产品 overlay 都不带、皮肤也不带——标记永远不会
 * 出现。此前照等，结果每次切官方界面都在这里超时、判 page-load 失败、回退
 * Workbench，用户看到的是官方页面配着"启动失败"和"自动重连中"（2026-09-11
 * 第一轮人工测试 #1）。逃生通道要救的正是"我们的东西坏了"，它不能反过来
 * 依赖我们的东西。
 * @param view - Compatibility View。
 * @param requireProductMarker - 是否要求产品插件的 settle 标记（Workbench 模式）。
 */
async function waitForClientSettle(view: WebContentsView, requireProductMarker: boolean): Promise<void> {
  const deadline = Date.now() + CLIENT_SETTLE_TIMEOUT_MS
  for (;;) {
    let state: { mounted: boolean; settled: boolean; failed: boolean; reason: string | null } | null = null
    try {
      state = await view.webContents.executeJavaScript(
        `(() => {
          const root = document.getElementById('root')
          const mounted = root !== null && root.childElementCount > 0
          const marker = window.__deepseekguiClientSettled
          return {
            mounted,
            settled: marker === true,
            failed: marker === false,
            reason: marker === false ? (window.__deepseekguiClientSettleReason ?? null) : null,
          }
        })()`,
      ) as { mounted: boolean; settled: boolean; failed: boolean; reason: string | null }
    } catch {
      // 导航中/页面未就绪：当作未 settle，继续轮询。
    }
    if (state !== null) {
      if (state.mounted && (state.settled || !requireProductMarker)) return
      if (state.failed) {
        throw new Error(`DeepSeekGUI client 插件激活失败：${state.reason ?? '未知原因'}`)
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Client Loader 在 ${CLIENT_SETTLE_TIMEOUT_MS}ms 内未 settle（官方 UI 挂载或 DeepSeekGUI client 插件未就绪）`)
    }
    await delay(CLIENT_SETTLE_POLL_MS)
  }
}

/** controller 的运行时适配器：进程、就绪、页面、停止（main 拥有全部句柄）。 */
const sessionDeletionKeys = generateKeyPairSync('ed25519')

function createRuntimeAdapter(packaged: boolean, root: string): HarnessRuntimeAdapter {
  return {
    async spawnProcess(selection) {
      if (await portInUse(DEFAULT_HOST, APP_PORT)) {
        throw new Error(
          `本机端口 ${APP_PORT} 已被其他程序占用（例如已运行的 pnpm dsh web）。请先关闭占用该端口的程序，再重新启动 DeepSeekGUI。`,
        )
      }
      const launch = resolveDshLaunch({
        packaged,
        root,
        profile: selection.profile,
        dshHome: selection.dshHome,
        // Managed Home 下不把宿主的 DEEPSEEK_API_KEY 透传下去，官方设置里的
        // 密钥输入框才不会被锁成只读（P8-D23）。
        managedHome: selection.managedHome === true,
        // Compatibility View（B3-P2）：不带 Workbench 产品插件的官方界面。
        compatibility: workbenchViewMode === 'compatibility',
        // P9-4：测试实例的显式端口（生产 = DEFAULT_PORT，不传也一样）。
        port: APP_PORT,
        ...packaged ? {
          resourcesPath: process.resourcesPath,
          packagedCwd: app.getPath('home'),
        } : {},
      })
      // B5-P2：服务输出一律 pipe——dsh 0.1.2 的 launch token 只出现在服务
      // stdout 的 launch URL 行，主进程必须读到才能拼窗口 URL 与交换 API
      // cookie；开发态由 data 处理器把输出转发回宿主控制台（等价旧继承），
      // 打包态写本地诊断日志。windowsHide：打包 GUI（无控制台）下若 Windows
      // 为该子进程分配新控制台，必须隐藏——DSH 进程树里随后 spawn 的
      // sandbox runner/pwsh 会共享这个隐藏控制台，整条链都不闪黑框（P6-J）。
      // 每个新 spawn 都换新的一次性 token：旧 token/cookie 立即失效。
      service.launchToken = null
      harnessSessionCookie = null
      const spawned = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: { ...launch.env, DEEPSEEKGUI_SESSION_DELETE_PUBLIC_KEY: sessionDeletionKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        stdio: 'pipe',
        windowsHide: true,
      })
      // spawn 失败（如 PATH 无 node）只走 error 事件；once() 在目标发出
      // 'error' 时自动拒绝，两个监听器的互相解绑也由它负责。
      await once(spawned, 'spawn')
      service.child = spawned
      service.bootSettled = false
      service.logPath = join(app.getPath('userData'), 'dsh-service.log')
      const log = createServiceLogWriter(service.logPath)
      service.log = log
      // Credentials are extracted from complete lines before logs or console output.
      readHarnessOutput(spawned.stdout, (token) => {
        if (service.child === spawned && service.launchToken === null) {
          service.launchToken = token
        }
      }, (line) => {
        log.write(line)
        if (!packaged) process.stdout.write(line)
      })
      spawned.stderr.on('data', (chunk: Buffer) => { log.write(chunk) })
      // 'close' 在子进程退出且 stdio 流全部结束后触发，此时可以安全收尾。
      spawned.once('close', () => { log.close() })
      // 每个新 child spawn 后都挂一次监视：boot 三步未完成前退出由
      // recovery 路径处理（waitReady 的 race / loadURL 失败），完成后
      // 退出才是运行中的意外崩溃；主动停止（stopped）不误报。
      // P2 常驻语义：意外退出不再杀死整个应用——Chrome 与 Tray 保持
      // 存活，controller 经 notifyUnexpectedExit 成为唯一 failed 来源
      // （main 不维护第二份 failed 状态），用户可 Restart Harness。
      spawned.once('exit', (code, signal) => {
        if (service.child !== spawned || service.stopped || !service.bootSettled) return
        const zh = desktopLocaleZh()
        const message = redactSecrets(
          zh
            ? `本地 DSH 服务已退出（code=${String(code)} signal=${String(signal)}）。${diagnosticsHint()}`
            : `Local DSH service exited (code=${String(code)} signal=${String(signal)}). ${diagnosticsHint()}`,
        )
        void controller?.notifyUnexpectedExit(message)
      })
    },
    async waitReady() {
      const child = service.child
      if (child === undefined) throw new Error(desktopLocaleZh() ? 'DSH 子进程不存在，无法等待就绪' : 'The DSH child process does not exist, so readiness cannot be checked')
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('The DSH process exited before readiness')
      // 就绪前子进程退出：立即以明确的 readiness 失败进入 recovery，
      // 而不是等满 60 秒超时。
      await new Promise<void>((resolvePromise, reject) => {
        let settled = false
        const settle = (outcome: () => void): void => {
          if (settled) return
          settled = true
          child.off('exit', onExit)
          outcome()
        }
        const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
          settle(() => {
            reject(new Error(desktopLocaleZh()
              ? `DSH 服务在就绪前退出（code=${String(code)} signal=${String(signal)}）`
              : `The DSH service exited before it became ready (code=${String(code)} signal=${String(signal)})`))
          })
        }
        child.once('exit', onExit)
        void waitForServer(DEFAULT_HOST, APP_PORT, READY_TIMEOUT_MS, desktopLocaleZh()).then(
          () =>{  settle(resolvePromise) },
          (error: unknown) =>{  settle(() => { reject(error instanceof Error ? error : new Error(String(error))) }) },
        )
      })
    },
    async loadPage() {
      const view = compatView
      if (view === undefined) throw new Error(desktopLocaleZh() ? 'Compatibility View 不存在，无法加载页面' : 'The Compatibility View does not exist, so the page cannot be loaded')
      // Install the official cookie before navigation; the launch redirect
      // removes query parameters, including the desktop control bridge.
      const tokenDeadline = Date.now() + 10_000
      while (service.launchToken === null && Date.now() < tokenDeadline) await delay(100)
      if (service.launchToken === null) throw new Error('Harness launch credential was not received')
      const baseUrl = `http://${DEFAULT_HOST}:${APP_PORT}`
      const cookie = await exchangeSessionCookie(baseUrl, service.launchToken, (url, init) => fetch(url, init))
      if (cookie === null) throw new Error('Harness authentication failed')
      const separator = cookie.indexOf('=')
      await view.webContents.session.cookies.set({
        url: baseUrl,
        name: cookie.slice(0, separator),
        value: cookie.slice(separator + 1),
        httpOnly: true,
        sameSite: 'strict',
      })
      harnessSessionCookie = cookie
      const params = new URLSearchParams()
      // D39：控制桥参数只随 DeepSeekGUI 自己加载的页面下发（见 controlBridgeParam）。
      if (controlBridgeParam !== undefined) params.set('deepseekgui-control', controlBridgeParam)
      const query = params.size === 0 ? '' : `?${params.toString()}`
      await view.webContents.loadURL(`${baseUrl}/${query}`)
      // 下一代健康不能只看 HTTP：官方 UI 挂载 + DeepSeekGUI client 插件
      // settle（theme plugin 的 apply 成功标记）都必须成立。第三方坏插件
      // 会让 loader 拒绝整轮 composition 或卡在 boot——这条失败链正是
      // Plugin Mutation Recovery 要兜住的（P6 6.8）。
      await waitForClientSettle(view, workbenchViewMode === 'workbench')
      // boot 全部完成：此后的子进程退出才是运行中的意外崩溃。
      service.bootSettled = true
    },
    async stopProcess() {
      await stopService()
    },
  }
}

/** controller（app ready 之后创建；单实例主进程持有）。 */
let controller: HarnessController | undefined

/** UI state 存取器（app ready 之后创建；窗口保存与主题出口共用）。 */
let uiStore: UiStateStore | undefined

/** 官方 RPC 客户端（app ready 之后创建；退出确认的会话数查询也用它）。 */
let harnessApi: HarnessApi | undefined

/** 当前主题偏好（UI state 的内存镜像；system 跟随 nativeTheme）。 */
let themePreference: ThemePreference = 'system'

/** 当前实际生效主题。 */
let effectiveThemeNow: 'light' | 'dark' = 'dark'

/** 上次退出是否未正常走到清理（active-run marker 证据；null=无历史）。 */
let uncleanExit: boolean | null = null

/** 待显示的一次性恢复提示（用户确认或新失败后更新；null = 无提示）。 */
let recoveryNotice: RecoveryNotice | null = null

// ---- Plugin Manager 状态（main 单处持有；renderer 只读快照） ----

/** Plugin Manager 的运行中操作视图；null = 空闲。 */
let pluginOperationView: PluginOperationView | null = null

/** 运行中插件操作的 broker 句柄（Cancel 与结算共用）。 */
let pluginOperationHandle: DesktopOperation | undefined

/** restart handoff 待确认（Restart Now / Later；绝不自动重启）。 */
let pluginHandoffPending = false

/** 插件写请求在确认/执行途中（同一目标一次只允许一个写操作）。 */
let pluginRequestInFlight = false

/** 是否有在途插件操作（broker 未结算，或 post-check 进行中）。 */
const pluginOperationInFlight = (): boolean =>
  pluginRequestInFlight || pluginOperationHandle !== undefined
  || (pluginOperationView !== null && (pluginOperationView.step === 'running' || pluginOperationView.step === 'post-check'))

// ---- Plugin Mutation Recovery 状态（journal 只存在 DeepSeekGUI userData） ----

/** 当前 recovery journal 的内存镜像；null = 无未决事务。 */
let recoveryJournal: PluginRecoveryJournal | null = null

/** journal 读取失败时的一次性诊断（绝不因此挡任何功能）。 */
let recoveryJournalError: string | null = null

// ---- Update service 状态（main 单处持有；比较对象只能是 DeepSeekGUI app version） ----

/**
 * home 的 8.3 短名（P9-5）：经 cmd 的 %~s 展开从系统**真实解析**一次，
 * 解析失败或与长名相同即为空——绝不硬编码 ~1 形态猜测。
 */
const homeShortAliases = ((): string[] => {
  try {
    const home = app.getPath('home')
    const probe = spawnSync('cmd.exe', ['/d', '/c', `for %I in ("${home}") do @echo %~sI`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true })
    const short = probe.stdout.trim()
    return short !== '' && short.toLowerCase() !== home.toLowerCase() ? [short] : []
  } catch {
    return []
  }
})()

/**
 * 界面显示用的路径打码：把用户主目录换成占位符。
 *
 * 导出文本另有 {@link normalizeUserPaths}，但那救不了**截图**——而截图
 * 正是用户报 bug 最常用的方式（住户 2026-08-24 审诊断面板时提出）。
 * 真路径不丢：面板的"复制完整路径"按钮复制的仍是原值。
 * @param path - 原始绝对路径。
 * @returns 打码后的显示值。
 */
function maskUserHome(path: string): string {
  return maskWindowsLiterals(path, [app.getPath('home'), ...homeShortAliases], desktopLocaleZh() ? '<用户目录>' : '<USER_HOME>')
}

/** 最近一次 diagnostics bundle 导出目录。 */
let lastDiagnosticsExport: string | null = null

/** 向运行中操作视图追加一段已脱敏输出（限长在 plugin-service，这里只搬状态）。 */
function appendPluginOutput(text: string): void {
  if (pluginOperationView === null || text === '') return
  pluginOperationView = { ...pluginOperationView, output: appendOutput(pluginOperationView.output, text) }
}

/** 从磁盘事实现场组装一个 profile 的 inventory（绝不缓存、绝不漂移）。 */
function readManifestDependencies(profileDir: string): ManifestDependenciesResult {
  try {
    return parseManifestDependencies(
      readFileSync(join(profileDir, 'package.json'), 'utf8'),
      profileDir,
    )
  } catch (error) {
    return { ok: false, error: redactSecrets(String(error instanceof Error ? error.message : error)) }
  }
}

/** 组装 Plugin Manager 面板视图：inventory 全量现场组装 + 操作 + handoff + recovery。 */
function buildPluginManagerView(): DesktopControlModel['pluginManager'] {
  const discovery = controlState.discovery
  return {
    profiles: discovery === null
      ? []
      : discovery.profiles.map(profile => ({
        name: profile.name,
        inventory: buildPluginInventory(profile, readManifestDependencies(profile.dir)),
      })),
    error: controlState.discoveryError,
    operation: pluginOperationView,
    handoffPending: pluginHandoffPending,
    recovery: recoveryJournal === null
      ? null
      : {
        state: recoveryJournal.state,
        profile: recoveryJournal.profile,
        failure: recoveryJournal.failure,
        autoRecoveredOnce: recoveryJournal.autoRecoveredOnce,
      },
    // B3-13：随包内置插件的真实来源（launcher overlay 层），只读投影。
    builtin: BUILTIN_PLUGIN_NAMES,
  }
}

/**
 * 内置浏览器 pane（B3-11）：view 与滑出进度。
 * slide ∈ [0,1]：1 = 完全展开，0 = 完全滑出（隐藏）。
 * 关键不变式（住户 2026-08-23 深夜实测钉死）：**pane 的宽度永远是全尺寸**，
 * 开合动画只平移 x、从不改 width——view 的渲染视口就是它的 bounds，一旦
 * 在收起路径上压过宽度，renderer 的 viewport 会冻结在隐藏前最后一帧
 * （实测 9px 面条），插件那头的截图/快照全部失明。平移 + 末帧隐身让
 * AI 的视野与人类的面板开合完全解耦。
 */
let browserPaneView: WebContentsView | undefined
let browserPaneSlide = 0
let browserPaneAnimation: NodeJS.Timeout | undefined

/**
 * pane 的目标显示态（意图）。slide 只是它的动画呈现：模型读这个、不读
 * slide——否则 toggle 后紧接着的 broadcast 会在动画第一帧之前读到旧值，
 * 菜单/按钮文案在整个动画期间是反的（点「显示」后仍写着「显示」）。
 */
let browserPaneOpen = false

// 曾经有一个「人类收起过就不再自动弹出」的开关（住户 2026-08-23 深夜定）。
// 2026-09-11 人工测试 #22 她自己把它撤了：合上之后 AI 照样能逛网页，却截
// 不了图、还以为工具坏了。现在的规则见 pane 桥的 `reveal`：每次打开新网址
// 都弹出；用户随时可以再合上；✕ 仍是真关闭。

/**
 * pane 右上角的半透明关闭钮（住户 2026-08-23 深夜定）。外部网页占着 pane
 * 的 view，没法往页面里注入按钮——叉是一块独立小 view 浮在 pane 上层，
 * 点击经 will-navigate 哨兵 URL 拦回 main 执行**真关闭**。纯符号无文案。
 */
let browserPaneCloseView: WebContentsView | undefined

/** pane 首个导航（marker 页）的完成信号；桥的 ensure 在回复前 await 它。 */
let browserPaneReady: Promise<void> | undefined

/** 关闭钮点击的哨兵 URL：永不真实导航，will-navigate 拦截即收起。 */
const BROWSER_PANE_CLOSE_SENTINEL = 'https://deepseekgui-browser-pane-close.invalid/'

/** 关闭钮页面：透明底 + 半透明圆钮 ✕，hover 加深。 */
const BROWSER_PANE_CLOSE_URL = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; overflow: hidden; }
  a { display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; margin: 4px; border-radius: 50%;
      background: rgba(20, 24, 34, 0.35); color: #ffffff;
      font: 600 13px/1 system-ui, sans-serif; text-decoration: none; }
  a:hover { background: rgba(20, 24, 34, 0.6); }
</style></head><body><a href="${BROWSER_PANE_CLOSE_SENTINEL}" title="Close">✕</a></body></html>`)}`

/** 关闭钮的可点区域（含 4px 内边距的正方形）。 */
const BROWSER_PANE_CLOSE_SIZE = 36

/** 依据窗口内容尺寸与菜单开合布局各 view（事件驱动，无轮询）。 */
function layoutViews(win: BrowserWindow): void {
  const [width, height] = win.getContentSize()
  const w = width ?? 0
  const contentH = Math.max((height ?? 0) - CHROME_HEIGHT, 0)
  const fullPaneW = Math.round(w * BROWSER_PANE_RATIO)
  // 官方页面让出的宽度随滑出进度走；pane 自身宽度恒为 fullPaneW（见上）。
  const yielded = Math.round(fullPaneW * browserPaneSlide)
  compatView?.setBounds({ x: 0, y: CHROME_HEIGHT, width: Math.max(w - yielded, 0), height: contentH })
  if (browserPaneView !== undefined) {
    browserPaneView.setVisible(browserPaneSlide > 0)
    browserPaneView.setBounds({ x: w - yielded, y: CHROME_HEIGHT, width: fullPaneW, height: contentH })
  }
  if (browserPaneCloseView !== undefined) {
    // 叉贴着 pane 的右上角随动；隐藏与 pane 同步。
    browserPaneCloseView.setVisible(browserPaneSlide > 0)
    browserPaneCloseView.setBounds({
      x: w - yielded + fullPaneW - BROWSER_PANE_CLOSE_SIZE - 6,
      y: CHROME_HEIGHT + 6,
      width: BROWSER_PANE_CLOSE_SIZE,
      height: BROWSER_PANE_CLOSE_SIZE,
    })
  }
  chromeView?.setBounds(chromeExpanded
    ? { x: 0, y: 0, width: w, height: height ?? 0 }
    : { x: 0, y: 0, width: w, height: CHROME_HEIGHT })
}

/**
 * 创建（或返回既有的）内置浏览器 pane。独立内存 partition：cookie 不落盘
 * （B2 决策原样保留），代理设置不污染官方 Compatibility View 的 session。
 * @param win - 主窗口。
 * @returns pane 的 WebContentsView。
 */
function ensureBrowserPane(win: BrowserWindow): WebContentsView {
  if (browserPaneView !== undefined && !browserPaneView.webContents.isDestroyed()) return browserPaneView
  // 重建路径（上一块 pane 的 webContents 已死但对象还挂着）：先把旧的两块
  // 一起摘干净再造新的，否则旧关闭钮会永远浮在窗口上并泄漏 webContents。
  if (browserPaneView !== undefined || browserPaneCloseView !== undefined) destroyBrowserPane(win)
  const view = new WebContentsView({
    webPreferences: {
      // 无 preload、无 node：这块 view 只渲染外部网页，与官方 view 同一
      // 安全姿势;操作全部经 CDP 从插件侧注入。
      partition: 'deepseekgui-browser-pane',
      sandbox: true,
    },
  })
  // 底色跟主题：写死白色会让深色主题下每次导航都闪一下白（2026-08-27 发布前排查）。
  view.setBackgroundColor(THEME_BACKGROUND[effectiveThemeNow])
  // 外部页面的 target=_blank / window.open 一律不许开原生窗口：默认行为会
  // 弹出一扇 DeepSeekGUI 管不着的 BrowserWindow——用户拿到一扇没有关闭语义的
  // 孤窗，而 agent 的 CDP 认领只盯这一块 view，等于当场失明（单标签不变式
  // 也随之失真）。改为在本 pane 内原地导航：仍走 pane session 的 SSRF 代理，
  // 与普通导航同一把关。
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !view.webContents.isDestroyed()) {
      void view.webContents.loadURL(url).catch(() => undefined)
    }
    return { action: 'deny' }
  })
  win.contentView.addChildView(view)
  // 首帧竞态：loadURL 是异步的，桥的 ensure 若在提交前读 getURL() 会拿到空串，
  // 插件那头按 URL 认领 CDP target 就会扑空。把导航 promise 留给桥去 await。
  browserPaneReady = view.webContents.loadURL(BROWSER_PANE_MARKER_URL).then(() => undefined, () => undefined)
  browserPaneView = view
  // A crashed renderer can retain a live WebContents. Release its target after
  // event dispatch; the next browser operation creates a fresh pane.
  releaseCrashedPane(view.webContents, () => {
    if (win.isDestroyed() || browserPaneView !== view) return
    destroyBrowserPane(win)
    broadcastModel()
  })
  // 关闭钮：独立透明小 view 浮在 pane 上层（addChildView 顺序即 z 序）。
  // 点击经哨兵 URL 的 will-navigate 拦回执行真关闭——小 view 无 preload 无
  // node，与 pane 同一安全姿势，通信面只有这一个被拦截的假导航。
  const closeView = new WebContentsView({
    webPreferences: { sandbox: true },
  })
  closeView.setBackgroundColor('#00000000')
  const closeRequested = (): void => {
    if (win.isDestroyed()) return
    // ✕ = 真关闭（住户 2026-08-23 深夜定稿的语义区分）：销毁浏览器实例、
    // 彻底释放——不是收起。收起（保活）只属于地球/菜单开关。
    //
    // 必须推到下一轮事件循环再拆：这个回调是关闭钮 view 自己的
    // will-navigate / window-open 处理器，而 destroyBrowserPane 关掉的正是
    // 那块 webContents——在事件派发途中销毁事件源，Electron 会拿到已释放的
    // 对象，整个进程当场崩掉（住户 2026-08-24 实测：点 ✕ 应用报错退出）。
    setImmediate(() => {
      if (win.isDestroyed()) return
      destroyBrowserPane(win)
      broadcastModel()
    })
  }
  closeView.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url.startsWith(BROWSER_PANE_CLOSE_SENTINEL)) closeRequested()
  })
  // 中键/Ctrl+点击走的是 window-open 而不是 will-navigate：没有这个 handler，
  // Electron 默认会为哨兵 URL 真开一扇窗（用户看到一扇报错窗，面板还关不掉）。
  closeView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BROWSER_PANE_CLOSE_SENTINEL)) closeRequested()
    return { action: 'deny' }
  })
  void closeView.webContents.loadURL(BROWSER_PANE_CLOSE_URL)
  win.contentView.addChildView(closeView)
  browserPaneCloseView = closeView
  layoutViews(win)
  return view
}

/**
 * ✕ 的语义：销毁 pane 的两块 view，网页进程随之终结。插件那头的 CDP 连接
 * 因 target 消失而断开，走既有的 resetAfterDisconnect 恢复路径——下一次
 * 浏览器工具调用会重新 ensure 一块全新的 pane，没有僵尸进程。
 * @param win - 主窗口。
 */
function destroyBrowserPane(win: BrowserWindow): void {
  if (browserPaneAnimation !== undefined) { clearInterval(browserPaneAnimation); browserPaneAnimation = undefined }
  browserPaneSlide = 0
  browserPaneOpen = false
  browserPaneReady = undefined
  if (browserPaneCloseView !== undefined) {
    win.contentView.removeChildView(browserPaneCloseView)
    if (!browserPaneCloseView.webContents.isDestroyed()) browserPaneCloseView.webContents.close()
    browserPaneCloseView = undefined
  }
  if (browserPaneView !== undefined) {
    win.contentView.removeChildView(browserPaneView)
    if (!browserPaneView.webContents.isDestroyed()) browserPaneView.webContents.close()
    browserPaneView = undefined
  }
  layoutViews(win)
}

/**
 * 动画开合 pane：逐帧插值滑出进度后重排（150ms ease-out）。只平移，
 * 永不改 pane 宽度（不变式见 browserPaneSlide 的注释）。
 * @param win - 主窗口。
 * @param open - true 滑入（slide→1），false 滑出（slide→0，末帧隐身）。
 */
function animateBrowserPane(win: BrowserWindow, open: boolean): void {
  browserPaneOpen = open
  if (browserPaneAnimation !== undefined) clearInterval(browserPaneAnimation)
  const target = open ? 1 : 0
  const from = browserPaneSlide
  if (from === target) return
  const frames = Math.max(Math.round(BROWSER_PANE_ANIMATION_MS / 15), 1)
  let frame = 0
  browserPaneAnimation = setInterval(() => {
    frame += 1
    const t = frame / frames
    // ease-out：前快后缓，视觉上「滑」而不是「弹」。
    const eased = 1 - (1 - t) * (1 - t)
    browserPaneSlide = from + (target - from) * eased
    if (frame >= frames) {
      browserPaneSlide = target
      if (browserPaneAnimation !== undefined) { clearInterval(browserPaneAnimation); browserPaneAnimation = undefined }
    }
    if (!win.isDestroyed()) layoutViews(win)
  }, 15)
}

/**
 * 创建主窗口：隐藏系统标题栏 + Windows titleBarOverlay 保留原生
 * 最小化/最大化/关闭按钮；下层 Compatibility View（官方 Web UI，导航
 * 守卫随迁），上层 Desktop Chrome view（顶栏；菜单展开时由 main 扩到
 * 全窗，背景透明）。窗口几何从 UI state 恢复并 clamp 到当前可见工作区
 * （显示器拔除/DPI/分辨率变化安全），几何在事件边界保存（无轮询），
 * minimized 不落盘。窗口只有唯一的普通主题背景路径：任何材质表面
 * （backgroundMaterial/透明）都会让 Chromium 放弃 ClearType 子像素
 * 抗锯齿，把 Compatibility View 的官方内容糊掉——实测后已移除，将来
 * 重新引入前必须先在高分屏实机对照官方页面字形取证。
 * @param ui - 启动时的 UI state 快照。
 */
function createWindow(ui: DesktopUiStateV1): BrowserWindow {
  const win = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    title: APP_NAME,
    // 显式窗口图标：打包态 exe 自带 ico，这里主要救开发态——裸 electron
    // 跑源码时任务栏是 Electron 默认原子图标（住户 2026-08-23 报「状态栏
    // 怎么长这样」），显式给上鲸鱼后 dev/打包一个样。
    icon: join(MODULE_DIR, '..', 'src', 'chrome', 'icon.png'),
    show: false,
    backgroundColor: THEME_BACKGROUND[effectiveThemeNow],
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: TITLE_BAR_OVERLAY[effectiveThemeNow].color,
      symbolColor: TITLE_BAR_OVERLAY[effectiveThemeNow].symbol,
      height: CHROME_HEIGHT - 1,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
  mainWindow = win
  // 恢复保存的几何：clamp 到当前可见工作区，显示器/分辨率变化后
  // 窗口仍完整可见；maximized 状态单独恢复。
  if (ui.windowBounds !== null) {
    const display = screen.getDisplayMatching(ui.windowBounds)
    const clamped = clampBoundsToWorkArea(ui.windowBounds, display.workArea, MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    // 与保存侧配对：内容区几何进、内容区几何出，往返幂等（见 saveWindowState）。
    win.setContentBounds(clamped)
  }
  if (ui.maximized) win.maximize()
  // 主窗自身的 webContents 不承载内容（两个 WebContentsView 覆盖其上），
  // 但必须显式加载一个空白文档：从未导航的 webContents 在 CDP 语义里是
  // 永不初始化的 page target，任何基于 CDP 的检查/驱动工具（playwright
  // 的 electron.launch 会等所有 page 初始化）都会无限等它。显式
  // about:blank 让基层成为定义良好的空白页，导航守卫不受影响。
  // 主窗口自己的 webContents 天生在所有 WebContentsView 之下：这里让它承载
  // 背景（深海/海雾底图），compat view 透明后海就从内容后面透上来。
  // 仍然是一个显式加载的真实文档，CDP 语义与 about:blank 时一致（未导航的
  // webContents 会让 playwright 之类的驱动无限等待，见下方说明）。
  void win.webContents.loadFile(join(MODULE_DIR, '..', 'src', 'chrome', 'backdrop.html'))
  // 背景页的明暗必须在它加载完成后再设：applyTheme 在 whenReady 早期就跑过
  // 一次，那时窗口还不存在，同步会被跳过——不补这一步，浅色主题下会显示
  // 深色的海。重新加载（含开发期热重载）后同样要重设。
  win.webContents.on('did-finish-load', () => {
    loadWindowBackdrop(win, effectiveThemeNow)
    // 背景页重新加载后，启动态也要回到真实相位（开发期热重载会走这条）。
    // 走完整广播而不是只推背景页：这条路径上 model 由 controller 现算，
    // 不必在这里再造一份可能过期的相位。controller 尚未建立时它是空函数，
    // 而那段时间正由 backdrop.html 上默认的 data-boot="starting" 兜着。
    broadcastModel()
  })


  // Compatibility View：未经篡改的官方 Web UI，绝不注入 DeepSeekGUI DOM。
  compatView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // 透明底：官方页面的底被主题桥改成 transparent 之后，窗口背景页的海才
  // 透得上来。webPreferences.transparent 本身默认已开，真正要设的是 view
  // 自己的背景色——不设的话它是不透明的，改多少 CSS 都白搭。
  compatView.setBackgroundColor('#00000000')
  win.contentView.addChildView(compatView)
  // 皮肤不再由这里注入：它是随包发行的 DSH client 插件，经启动时的
  // `--patch` overlay 进入 composition，用官方 ctx.theme.overrideTokens
  // 叠一层 token。官方 presenter 消费合成后的快照并完成 DOM 投影，
  // 所以导航、刷新、切主题都由官方自己保持，我们不重注、也不盯 DOM。
  // 不允许新窗口；官方 Markdown 的 http/https 外链交给系统默认浏览器，
  // 其余协议拒绝。远程页面绝不在 Electron 内加载。
  compatView.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyLinkOpen(url, DEFAULT_HOST, APP_PORT) === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 视图内导航只允许本机 DSH 页面；指向外部的普通链接同样交给系统浏览器。
  compatView.webContents.on('will-navigate', (event, url) => {
    const target = classifyLinkOpen(url, DEFAULT_HOST, APP_PORT)
    if (target === 'app') return
    event.preventDefault()
    if (target === 'external') void shell.openExternal(url)
  })
  // Desktop Chrome：本地受信任 renderer（顶栏 + 菜单 + Harness 面板）。
  chromeView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(MODULE_DIR, 'chrome', 'preload.cjs'),
    },
  })
  win.contentView.addChildView(chromeView)
  // 菜单展开时面板外区域透出 Compatibility View。
  chromeView.setBackgroundColor('#00000000')
  // Chrome renderer 是本地静态页面：不允许它导航到任何别处或开新窗口。
  chromeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  chromeView.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  void chromeView.webContents.loadFile(join(MODULE_DIR, '..', 'src', 'chrome', 'index.html'))

  // 左下角的浮动反馈按钮层已删（P8-D13 终章，住户 2026-08-23 验收确认反馈
  // 功能齐全后拍板）：反馈入口只剩菜单的「BUG诊断与反馈」，被浮钮压住的
  // 官方「设置」入口（D6/D7 卡点二）随之解放。它当年的存在理由——「agent
  // 起不来时也点得到」——由菜单继承：Chrome 层同样不依赖运行时状态。

  layoutViews(win)
  // 窗口状态保存：事件边界（resize/move debounce、maximize 即时、close
  // 最终）——绝不轮询。minimized 时不落盘：保存的始终是 normal bounds。
  const saveWindowState = (): void => {
    const store = uiStore
    if (store === undefined || win.isDestroyed()) return
    const current = store.read().state
    // 存**内容区**几何，不是窗口框架几何。实测（150% 缩放）：
    // setBounds → getNormalBounds 每往返一轮宽高各 +1、y 上移，把读回的
    // 值再存回去，窗口每启动一次就长大一圈并向上爬；
    // setContentBounds → getContentBounds 则逐字稳定。框架几何在
    // DIP↔物理像素换算里不是幂等的，内容几何才是。
    // maximized/minimized 时内容区是当前态而非"还原后"的几何，那两种
    // 情况仍取 normal bounds（写入侧本来就只在非最小化时落盘）。
    const normal = win.isMaximized() || win.isMinimized() ? win.getNormalBounds() : win.getContentBounds()
    try {
      store.write(nextWindowState(current, normal, win.isMinimized(), win.isMaximized()))
    } catch (error) {
      // UI 偏好写失败只记诊断，绝不挡退出或启动。
      console.error(`[deepseekgui] UI 状态写入失败: ${String(error instanceof Error ? error.message : error)}`)
    }
  }
  let saveTimer: NodeJS.Timeout | undefined
  const scheduleSave = (): void => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveWindowState, WINDOW_SAVE_DEBOUNCE_MS)
  }
  win.on('resize', () => {
    layoutViews(win)
    scheduleSave()
  })
  win.on('move', scheduleSave)
  win.on('maximize', saveWindowState)
  win.on('unmaximize', saveWindowState)
  win.on('close', (event) => {
    // 常驻语义：X = 隐藏窗口，Harness 继续运行（tray 常驻）；首次隐藏
    // 显示一次性非阻断说明（确认写进 ui-state，不再提示）。真正退出
    // 只走 requestQuit 的 quitting 流程。
    if (!quitting) {
      event.preventDefault()
      saveWindowState()
      win.hide()
      showCloseToTrayNoticeOnce()
      return
    }
    saveWindowState()
  })
  win.once('ready-to-show', () => {
    win.show()
  })
  // OS shutdown / logoff（窗口级事件，Electron 43）：不 preventDefault
  // 允许会话结束；session-end 时走无交互 orderly cleanup，绝不被确认框
  // 无限阻塞。
  win.on('query-session-end', () => {
    // 不 preventDefault：允许系统会话结束。
  })
  win.on('session-end', () => {
    // 不预设 quitting：proceedQuit 以 `if (quitting) return` 自守幂等，
    // 在这里先置位等于把它挡在门外——session-end 会变成什么都不做的
    // no-op（第五扇窗实测：窗口不藏、Harness 不停、端口不放）。
    void proceedQuit()
  })
  win.once('closed', () => {
    // 显式释放两个 view 的 webContents；Harness 进程树清理走 before-quit
    // 的 controller.stop()，只清理一次。
    compatView?.webContents.close()
    chromeView?.webContents.close()
    compatView = undefined
    chromeView = undefined
    mainWindow = undefined
  })
  return win
}

// ---- ControlModel 状态（main 单处持有；renderer 只消费快照） ----

/** discovery 缓存 + Existing Home 候选（调度器与模型共用的唯一持有者）。 */
const controlState: ControlStateHolder = {
  discovery: null,
  discoveryError: null,
  existingHomeCandidate: null,
}

/** headless 导出的整体超时（毫秒）：读盘/组装卡住时明确失败。 */
const HEADLESS_EXPORT_TIMEOUT_MS = 60_000

/** 版本事实：Electron 侧的两项在这里取，其余（含降级）在 version-info。 */
const readVersionInfo = (packaged: boolean, root: string): DeepSeekGUIVersionInfo =>
  readVersionInfoOrDegraded({ packaged, root, appVersion: app.getVersion(), zh: desktopLocaleZh() })

/**
 * headless 诊断导出（--export-diagnostics）：组装与落盘在 diagnostics-export，
 * 这里只做两件入口该做的事——把 Electron 侧的事实取齐，以及决定进程怎么退出。
 * 全程不启动 Harness / Profile / 第三方插件 / 主窗口 / tray，不监听 3080，
 * 不执行 plugin recovery 或 update，绝不上传任何内容。
 */
function runHeadlessDiagnosticsExport(): void {
  const userDataDir = app.getPath('userData')
  try {
    const version = readVersionInfo(app.isPackaged, repoRoot())
    // launcher state 只读；损坏时 headless 绝不弹救援对话框（无交互），
    // 降级为 unknown 事实——损坏的 state 本身就是诊断目标之一。
    let homeKind: 'managed' | 'existing' = 'managed'
    let profile = 'unknown'
    try {
      const state = createLauncherStateStore(userDataDir, desktopLocaleZh).read()
      homeKind = state.active.home.kind
      profile = state.active.profile
    } catch {
      // 如实标 unknown。
    }
    const dir = exportHeadlessDiagnostics({
      userDataDir,
      home: app.getPath('home'),
      homeAliases: homeShortAliases,
      version,
      homeKind,
      profile,
      at: new Date(),
      timeoutMs: HEADLESS_EXPORT_TIMEOUT_MS,
    })
    console.log(`[deepseekgui] diagnostics bundle exported to ${dir}`)
    app.exit(0)
  } catch (error) {
    console.error(`[deepseekgui] headless 诊断导出失败: ${String(error instanceof Error ? error.message : error)}`)
    app.exit(1)
  }
}

/**
 * D39 控制桥参数（`port.token`）：设置插件经 compat view 的页面 URL query
 * 拿到它。只有 DeepSeekGUI 自己加载的页面带这个参数——用户在外部浏览器打开
 * 3080 时没有它，桌面控制分区于是不出现（那里本来也没有桌面可控）。
 */
let controlBridgeParam: string | undefined

/**
 * 当前界面形态（B3-P2）：Workbench（带 DeepSeekGUI 产品插件）或
 * Compatibility View（不带 Workbench 插件的官方界面）。内存态，不
 * 持久化——应用重开默认 Workbench；切换经 controller.restart 唯一路径。
 */
let workbenchViewMode: 'workbench' | 'compatibility' = 'workbench'

/** 目录选择桥：宿主能力在这里凑齐，桥本身在 picker-bridge。 */
const startPickerBridge = async (): Promise<void> => {
  await startDirectoryPickerBridge({
    pickDirectory: title => dialog.showOpenDialog({ properties: ['openDirectory'], title }),
    zh: desktopLocaleZh,
    env: process.env,
  })
}

/** 首启导入询问：宿主能力在这里凑齐，问法与权责说明在 session-import-offer。 */
const offerSessionImport = (targetHome: string): Promise<void> => offerImport(targetHome, {
  showMessageBox: request => dialog.showMessageBox({ ...request, buttons: [...request.buttons] }),
  zh: desktopLocaleZh,
  homeDir: homedir(),
})

// Windows toasts need the AppUserModelID that the NSIS Start Menu shortcut
// carries (electron-builder's appId); without it `new Notification().show()`
// is silently dropped by the shell. P9 on-machine acceptance: the log said
// `notify show` while no toast ever appeared.
if (process.platform === 'win32') app.setAppUserModelId('io.github.see-sol-lab.deepseekgui')

void app.whenReady().then(async () => {
  // 配置自检要早：网关地址配错时用户仍能本地导出反馈，但得先知道为什么
  // 提交按钮不见了。
  const gatewayWarning = feedbackGatewayConfigWarning(process.env)
  if (gatewayWarning !== null) console.error(`[deepseekgui] ${gatewayWarning}`)
  // headless：--export-diagnostics 分支——绝不启动 Harness/Profile/plugin/
  // window/tray/3080/update，只导本地诊断包后退出。
  if (EXPORT_DIAGNOSTICS) {
    runHeadlessDiagnosticsExport()
    return
  }
  // 第二实例：app.exit 已在途，不再启动服务。
  if (!isPrimaryInstance) return
  // 旧的英文横铺 application menu 彻底移除；Desktop Chrome 是唯一控制面。
  Menu.setApplicationMenu(null)
  const packaged = app.isPackaged
  // 桥只在打包态起：picker overlay 也只在打包态挂载（理由见
  // resolvePickerPluginDir 的注释），开发态用官方 picker，没有桥要搭。
  // 必须早于 controller.start()——DSH 的环境从 process.env 取，端点写晚了
  // 子进程就拿不到。
  if (packaged) await startPickerBridge()
  const root = repoRoot()
  // 交付身份四元组：app version（打包态 exe 元数据 / 开发态 manifest）、
  // embedded DSH version（实际打包 Runtime / 源码 manifest）、source commit
  // 标识、Electron + platform/arch。About 是附属展示面：任何一项读不到就
  // 降级 'unknown'，绝不阻断启动；出厂一致性由构建门禁保证。About 文本
  // 由 about.ts 的纯函数组装，输入面不含任何凭据/环境变量。
  const versionInfo = readVersionInfo(packaged, root)
  if (!packaged) {
    const distIndex = join(root, 'apps', 'web', 'dist', 'index.html')
    if (!existsSync(distIndex)) {
      failLocalized(
        moduleDict(),
        'fail.missing-web.title',
        'fail.missing-web.message',
        { path: distIndex },
        1,
      )
      return
    }
  }
  const userDataDir = app.getPath('userData')
  // active-run / unclean-exit 证据：写新 marker 之前先读旧 marker——它还
  // 在 = 上次退出没有走到清理（非正常退出的最小证据；不自动断言 crash、
  // 不因此删除任何用户数据）。
  try {
    const previous = parseActiveRunMarker(readFileSync(join(userDataDir, ACTIVE_RUN_FILENAME), 'utf8'))
    uncleanExit = previous !== null
  } catch {
    uncleanExit = null
  }
  try {
    writeFileSync(join(userDataDir, ACTIVE_RUN_FILENAME), serializeActiveRunMarker({
      startedAt: new Date().toISOString(),
      appVersion: versionInfo.appVersion,
      pid: process.pid,
    }))
  } catch (error) {
    // marker 写失败只记诊断：这条证据缺失绝不影响启动。
    console.error(`[deepseekgui] active-run marker 写入失败: ${String(error instanceof Error ? error.message : error)}`)
  }
  // 本地 Crashpad：只收集本地 dump、绝不上传（submitURL 置空 + 关闭
  // 自动上传）。dump 证据只进本机 diagnostics bundle。
  try {
    crashReporter.start({ uploadToServer: false, submitURL: '' })
  } catch (error) {
    console.error(`[deepseekgui] crashReporter 启动失败（本地 dump 证据不可用）: ${String(error instanceof Error ? error.message : error)}`)
  }
  // PowerShell 7 只影响用户 Terminal 的推荐项（UX）：启动时探测一次，
  // 绝不参与 Agent sandbox 决策——Agent 的 PowerShell 始终走 Harness 的
  // tool/security 路径。
  const pwsh7Available = hasPowerShell7({ exists: existsSync }, process.env.LOCALAPPDATA)
  // 官方 settings service 的 RPC 客户端：主题切换与权限切换的唯一写路径
  // （绝不直接编辑 settings.yaml）。只在 Harness 运行时调用；创建时无需
  // 服务在线（lazy fetch）。
  harnessApi = createHarnessApi({
    baseUrl: `http://${DEFAULT_HOST}:${APP_PORT}`,
    // B5-P2：官方 /api 鉴权走 browser-auth 会话 cookie——cookie 由 launch
    // token 交换而来（见 harnessSessionCookie）；没有 cookie 时照发（服务
    // 会 401，调用方按既有 fail-closed 语义处理）。
    fetch: (url, init) => harnessSessionCookie === null
      ? fetch(url, init)
      : fetch(url, { ...init, headers: { ...init.headers, cookie: harnessSessionCookie } }),
    zh: desktopLocaleZh,
  })
  // 闭包内的调用点用 non-null 局部别名：模块级 let 的 undefined 形态只
  // 属于 app ready 之前（requestQuit 有对应的降级守卫），ready 之后恒有值。
  const rpc = harnessApi
  // UI state（窗口几何、主题、恢复提示确认、面板偏好）：损坏只回退
  // 安全默认值并记诊断，绝不挡住 launcher/Harness 启动。
  uiStore = createUiStateStore(userDataDir, desktopLocaleZh)
  const uiResult = uiStore.read()
  if (uiResult.error !== null) {
    console.error(`[deepseekgui] UI 状态损坏，已回退安全默认值: ${uiResult.error}`)
  }
  // 控制器还没建（它要等 runner）；把开关初值记下来，建的时候带进去。
  initialAutoDownload = uiResult.state.autoDownloadUpdate
  // 系统主题变化时跟随（仅当偏好为 system 时才改变生效主题；始终推送
  // high contrast 状态）。Compatibility View 不受任何影响。
  nativeTheme.on('updated', () => {
    effectiveThemeNow = effectiveTheme(themePreference, nativeTheme.shouldUseDarkColors)
    mainWindow?.setBackgroundColor(THEME_BACKGROUND[effectiveThemeNow])
    applyTitleBarOverlay()
    if (mainWindow !== undefined) loadWindowBackdrop(mainWindow, effectiveThemeNow)
    applyBrowserPaneTheme()
    broadcast()
  })

  // launcher state 是 profile 与 DSH_HOME 的唯一来源：文件缺失（新用户）
  // 回退默认 Managed/web；文件损坏不再只有退出——用户可选择备份后恢复
  // 默认、打开配置所在文件夹或退出，恢复默认绝不触碰任何用户数据。
  const launcher = createLauncherStateStore(userDataDir, desktopLocaleZh)
  try {
    launcher.read()
  } catch (error) {
    const recovered = await rescueLauncherState(
      launcher,
      userDataDir,
      String(error instanceof Error ? error.message : error),
    )
    if (!recovered) {
      app.exit(1)
      return
    }
    try {
      launcher.read()
    } catch (readError) {
      failLocalized(
        moduleDict(),
        'fail.launcher-invalid.title',
        'fail.launcher-invalid.message',
        { path: launcher.filePath, reason: String(readError instanceof Error ? readError.message : readError) },
        1,
      )
      return
    }
  }

  // #25：迁移过的数据目录指针住在 userData 之外（%LOCALAPPDATA%），随每次
  // launcher state 落盘同步——卸载器读它决定"删干净"，首启读它问"接着用吗"。
  // 没有 LOCALAPPDATA（非 Windows / 特殊环境）就没有指针，一切照旧。
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData !== '') {
    const pointerPath = homePointerPath(localAppData)
    // 指针写不进去不能拦住启动：它只影响卸载和下一次重装，记进主进程日志即可。
    const syncPointer = (state: LauncherStateV1): void => {
      try {
        syncHomePointer(pointerPath, state)
      } catch (error) {
        console.error(`[deepseekgui] home pointer sync failed: ${String(error instanceof Error ? error.message : error)}`)
      }
    }
    const rawWrite = launcher.write.bind(launcher)
    launcher.write = (state) => {
      rawWrite(state)
      syncPointer(state)
    }
    await offerReclaimedHome(launcher, pointerPath)
    // 老安装（指针出现之前就搬过家的）从这一启动起补上指针。
    syncPointer(launcher.read())
  }

  // 主题偏好的唯一事实源是 Harness 的 ui-theme.preference（官方 settings
  // provider 默认 watch 该文档、外部编辑会热发布，两边读的是同一份事实）。
  // 必须放在 launcher 可读之后：DSH_HOME 由 active home 决定。
  const themeHome = resolveHarnessHome(launcher.read().active.home, userDataDir)
  followHarnessPreferences(themeHome)

  const discover = (dshHome: string): Promise<ProfileDiscoveryV1> => discoverProfiles({
    packaged,
    root,
    dshHome,
    zh: desktopLocaleZh(),
    ...packaged ? {
      resourcesPath: process.resourcesPath,
      packagedCwd: app.getPath('home'),
    } : {},
  })

  // ---- Feedback（P7-A~E）：面板状态（main 单处持有；renderer 只读快照） ----

  /** Feedback 面板的当前事实。 */
  const feedbackView: FeedbackView = {
    open: false,
    diagnostics: '',
    phase: 'idle',
    reply: null,
    issueTitle: '',
    degradedReason: null,
    notice: null,
    // P8-D32：网关未配置时按钮直接呈现为「导出反馈文件」。
    gatewayConfigured: resolveFeedbackGatewayUrl(process.env) !== '',
  }

  /** 最近一次 feedback-send 的用户文本（copy-open 组装正文用）。 */
  let feedbackUserText = ''

  /**
   * 诊断包收集时的环境指纹；与当前不一致即说明它过期了。
   *
   * 原先这里是个一次性布尔（收集过就永远不再收集），于是诊断包被钉死在
   * 「本进程第一次打开反馈面板」那一刻。人工验收（2026-08-27）实测：先在
   * 托管 Home 打开过一次反馈，之后切到自己的目录、换了 profile、Harness 还
   * 崩过一轮，issue 正文里的诊断包仍写着最初那套 Managed/web——而 issue 抬头
   * 走的是当前值 Existing，同一份报告里两处自相矛盾，拿去排查会指向错误的目录。
   *
   * 改成指纹而不是每次都重收，是为了保住原来的意图：用户可以编辑诊断包，
   * 同一环境下反复开合面板不该把他的编辑冲掉。环境真变了才重来。
   */
  let feedbackDiagnosticsStamp: string | null = null

  /** 决定诊断包是否过期的三件事：家在哪、跑的哪套、它活着没有。 */
  const feedbackEnvironmentStamp = (): string => {
    const state = launcher.read()
    const home = state.active.home
    const path = home.kind === 'existing' ? home.path : 'managed'
    return `${home.kind}:${path}:${state.active.profile}:${harness.status().phase}`
  }

  /**
   * 模型内容版本号：内容指纹变化时递增（P7：控制桥条件拉取靠它判断
   * 「变了没有」，settings-plugin 不再无条件拉全量模型）。指纹对比用
   * JSON 序列化——模型是几十 KB 的普通对象，广播频率低，开销可忽略；
   * 换来的是 revision 只反映**真实内容变化**，无变化的广播不会虚增。
   */
  let modelRevision = 0
  let modelFingerprint: string | null = null

  /**
   * 全局记忆 memory.md 的当前内容（D5-c，设置页「记忆（全局）」分区的编辑
   * 起点）。不存在 = 空串；读不到或超过 MEMORY_GLOBAL_CONTENT_MAX = null，
   * 分区据此禁用保存，绝不用截断的内容覆盖原文件。
   * @param home - 解析后的 DSH home。
   * @returns 文件内容、空串或 null。
   */
  const readGlobalMemory = (home: string): string | null => {
    const path = join(home, 'memory.md')
    try {
      if (!existsSync(path)) return ''
      if (statSync(path).size > MEMORY_GLOBAL_CONTENT_MAX * 4) return null
      const content = readFileSync(path, 'utf8')
      return content.length > MEMORY_GLOBAL_CONTENT_MAX ? null : content
    } catch {
      return null
    }
  }

  /**
   * B6-P5：首启引导的持久事实。undefined = 尚未判定；判定一次后缓存，
   * 用户完成或跳过时更新。判定输入全部来自 main 已有来源（launcher
   * selection + Managed Home 的会话目录），进度本身不落盘。
   */
  let firstRunState: FirstRunState | null | undefined

  const migration = createMigrationControl({
    home: () => {
      const state = launcher.read()
      return {
        homeKind: state.active.home.kind === 'managed' ? 'managed' : 'existing',
        homePath: resolveHarnessHome(state.active.home, userDataDir),
        profile: state.active.profile,
      }
    },
    markLastKnownGood: () => {
      const state = launcher.read()
      launcher.write({ ...state, lastKnownGood: state.active })
    },
    switchHome: async (targetHome, profile) => {
      if (quitting) return false
      await harness.switchTo({ home: { kind: 'managed', root: targetHome }, profile })
      const active = launcher.read().active
      return harness.status().phase === 'running' && active.profile === profile
        && active.home.kind === 'managed' && resolveHarnessHome(active.home, userDataDir) === targetHome
    },
    stopHarness: () => harness.stop(),
    startHarness: async () => {
      if (!quitting && harness.status().phase !== 'running') await harness.start()
    },
    pickTargetParent: async () => {
      const dict = stringsFor(localeOf())
      const picked = await dialog.showOpenDialog({
        title: dictText(dict, 'dialog.migration.title'),
        buttonLabel: dictText(dict, 'dialog.migration.button'),
        properties: ['openDirectory', 'createDirectory'],
      })
      return picked.canceled ? undefined : picked.filePaths[0]
    },
    text: (key, vars) => dictText(stringsFor(localeOf()), key, vars),
    // broadcast 在下面才声明；包一层惰性调用，别在这里撞 TDZ。
    broadcast: () => { broadcast() },
    zh: () => localeOf() === 'zh',
  })

  const buildModel = (): DesktopControlModel => {
    // 派生事实在一次构建里只读一次盘：state 与 feedUrl 读到后向下传，
    // 绝不让 buildDiagnosticsView 再读一遍（同一次广播里两次读同一个
    // 文件既慢又可能读到两个不同版本）。
    const state = launcher.read()
    const feedUrl = readUpdateFeed(userDataDir)
    const activeHome = resolveHarnessHome(state.active.home, userDataDir)
    const model = buildControlModel({
      revision: modelRevision,
      locale: desktopLocaleZh() ? 'zh' : 'en',
      state,
      status: harness.status(),
      activeDshHome: activeHome,
      // 会话数只在越过警戒线时有值；内部按 Home 缓存，控制面的定时刷新
      // 不会变成一轮又一轮的扫盘。
      sessionPressure: readSessionPressure(activeHome),
      discovery: controlState.discovery,
      discoveryError: controlState.discoveryError,
      logPath: service.logPath,
      existingHomeCandidate: controlState.existingHomeCandidate,
      effectiveTheme: effectiveThemeNow,
      highContrast: nativeTheme.shouldUseHighContrastColors,
      recoveryNotice: recoveryNotice === null
        ? null
        : { profile: recoveryNotice.profile, kind: recoveryNotice.kind },
      pluginManager: buildPluginManagerView(),
      // M7：channel 在构建视图时现算——绝不把"未点过检查"显示成
      // "未配置"（Build Info 里已显示真实 feed URL，两处必须一致）。
      update: { ...updates.view(), channel: feedUrl },
      diagnostics: buildDiagnosticsView({ state, feedUrl }),
      // Feedback：模型里给的是快照（renderer 只读）。
      feedback: { ...feedbackView },
      // 权限视图现算：官方 describe 缓存 + 错误 → fail closed 展示形态。
      permissions: permissions.view(),
      // PowerShell 7 只影响用户 Terminal 的推荐项，绝不影响 Agent sandbox。
      powerShell7Available: pwsh7Available,
      // 内置浏览器 pane（B3-11）：菜单项只在插件创建过 pane 后出现。
      browserPane: {
        present: browserPaneView !== undefined && !browserPaneView.webContents.isDestroyed(),
        open: browserPaneOpen,
      },
      // B6-P5：首启引导只在"全新 Managed Home"判定一次；判定结果与完成
      // 事实都在 first-run.json 里（单一 owner）。当前步骤由客户端推导。
      firstRun: {
        pending: isFirstRunPending(firstRunState ??= ((): ReturnType<typeof resolveFirstRunState> => {
          const sweep = sessionDirsResult(activeHome)
          return resolveFirstRunState({
            userDataDir,
            homeKind: state.active.home.kind,
            sessionCount: sweep.dirs.length,
            sessionsReadable: sweep.readable,
          })
        })()),
      },
      dataHome: migration.view(),
      // 当前界面形态（B3-P2）：tray 据此显示对向切换入口。
      viewMode: workbenchViewMode,
      // B4-P8 通知点击的一次性会话导航请求（B5-P6 恢复）：由 notify 命令的
      // 点击写入，Web 的 DesktopActions 轮询读到后恰好打开一次该会话。
      navigateRequest: pendingNavigate,
      // D5-c：全局记忆内容给设置页分区做编辑起点（有界读一次盘）。
      globalMemory: readGlobalMemory(activeHome),
    })
    // 指纹必须剥掉 revision 自身：模型序列化里若含上一轮的 revision，
    // 每次构建指纹都因这个字段而不同，revision 恒自增、`?since=` 门控
    // 永远判「变了」——条件拉取整个失效（验收实推抓获）。
    const { revision: _stamped, ...content } = model
    const fingerprint = JSON.stringify(content)
    if (fingerprint !== modelFingerprint) {
      modelRevision += 1
      modelFingerprint = fingerprint
    }
    return modelRevision === model.revision ? model : { ...model, revision: modelRevision }
  }

  /**
   * 由唯一模型重建 Tray 菜单：Tray、Chrome 与 Terminal 共用同一
   * buildControlModel 事实，绝不建立第二份 selection 或 runtime status。
   */
  const rebuildTrayMenu = (model: DesktopControlModel): void => {
    if (tray === undefined) return
    const items = trayMenuTemplate({
      model,
      locale: model.locale,
    })
    const toElectron = (item: (typeof items)[number]): Electron.MenuItemConstructorOptions => ({
      label: item.label ?? '',
      enabled: item.enabled ?? true,
      type: item.type === 'radio' ? 'radio' : item.type === 'separator' ? 'separator' : 'normal',
      ...item.checked === undefined ? {} : { checked: item.checked },
      ...item.submenu === undefined ? {} : { submenu: item.submenu.map(toElectron) },
      ...item.action === undefined
        ? {}
        : {
          click: () => {
            void handleTrayAction(item.action as TrayAction).catch(reportFailure)
          },
        },
    })
    tray.setContextMenu(Menu.buildFromTemplate(items.map(toElectron)))
  }

  /** Tray 动作统一出口：全部复用既有控制路径，绝不开第二套执行面。 */
  const handleTrayAction = async (action: TrayAction): Promise<void> => {
    switch (action.kind) {
      case 'show-window':
        mainWindow?.show()
        mainWindow?.focus()
        return
      case 'switch-profile':
        await runCommand({ type: 'switch-profile', profile: action.profile })
        return
      case 'restart':
        await runCommand({ type: 'restart-harness' })
        return
      case 'open-terminal':
        await runCommand({ type: 'show-terminal' })
        return
      case 'open-compatibility-view':
        await runCommand({ type: 'open-compatibility-view' })
        return
      case 'open-workbench':
        await runCommand({ type: 'open-workbench' })
        return
      case 'check-updates':
        // 托盘入口 = Manual Check：打开更新面板展示结果。
        mainWindow?.show()
        mainWindow?.focus()
        chromeView?.webContents.send('deepseekgui:open-update-panel')
        await runCommand({ type: 'check-for-updates' })
        return
      case 'about':
        await runCommand({ type: 'show-about' })
        return
      case 'quit':
        await requestQuit()
        return
    }
  }

  /**
   * 推送控制模型并重建托盘菜单。
   * prebuilt 只服务于"同一时刻已经构建过一份"的调用方（启动尾部：先
   * 广播、再建托盘），省掉紧接着的第二次整读；不传则现场构建。
   * @param prebuilt - 调用方刚构建的模型。
   */
  const broadcast = (prebuilt?: DesktopControlModel): void => {
    const model = prebuilt ?? buildModel()
    const target = chromeView?.webContents
    if (target !== undefined && !target.isDestroyed()) {
      target.send('deepseekgui:control-model-changed', model)
    }
    // 背景页的启动态与胶囊同源（P8-D5）：同一个 model 推两处，不让它们各算各的。
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      loadWindowBootNotice(mainWindow, model)
    }
    // 重启/切换/恢复期间藏起 Compatibility View（住户 2026-08-23：boot 文案
    // 透过透明的官方旧页面叠着显示，难看）——藏掉后露出的正是首装那张
    // 全屏启动页（背景页 data-boot 文案），相位回来再显示。判定与
    // loadWindowBootNotice 同源：boot 三相位隐藏，其余（含 error/stopped）
    // 保持可见，错误状态下旧页面与对话框仍是用户的现场。
    if (compatView !== undefined) {
      const phase = model.status.phase
      compatView.setVisible(!(phase === 'starting' || phase === 'switching' || phase === 'recovering'))
    }
    rebuildTrayMenu(model)
  }
  broadcastModel = broadcast

  const harness = new HarnessController({
    store: launcher,
    resolveHome: selection => resolveHarnessHome(selection.home, userDataDir),
    runtime: createRuntimeAdapter(packaged, root),
    log: (line) =>{  console.error(line) },
    zh: desktopLocaleZh,
    // 七相状态每次变化都推送 ControlModel：切换/重启/恢复期间胶囊实时变化。
    onStatusChanged: () => {
      // B5-P6：通知事实由官方 Web 连接（官方 heartbeat/reconnect）在页面侧
      // 消费，经 notify 控制命令推给桌面；桌面不再自建事件流，没有可断开的
      // 连接，也没有要清的重连补偿。桌面只负责弹通知与点击导航。
      broadcast()
    },
  })
  controller = harness

  // ---- B5-P6 Desktop 通知展示（无状态）：只弹系统通知 + 点击写导航 ----
  // Web 侧消费端以「会话 + 官方事件 id」完成去重后才发 notify 命令；这里
  // 不缓存、不记账、不持久化，同一事件重复到达只是重复展示由发送端负责。
  // 是否正看着目标会话由 Web 消费者判断，桌面不再按整个窗口焦点过滤。
  const showNotify = (command: Extract<DesktopControlCommand, { type: 'notify' }>): void => {
    // The Session-aware Web consumer already suppresses the fact being viewed.
    const notification = new Notification({
      title: command.title,
      body: command.body,
      silent: false,
    })
    notification.on('click', () => {
      // 点击定位：聚焦主窗，并把一次性会话导航请求写进控制模型
      // （nonce 去重）；Workbench 的桌面动作轮询读到后打开该会话。
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
      navigateNonce += 1
      pendingNavigate = { sessionId: command.sessionId, nonce: navigateNonce }
      broadcast()
    })
    notification.show()
  }

  /**
   * 恢复通知的结算：纯计算（recovery-notice.ts）依据磁盘权威的 launcher
   * state 与 controller 内存状态判定，确认与否经 UI state 的 hash 去重。
   * 必须由 runCommand 与启动流程在 store 晋升之后调用。本函数绝不清理
   * lastBootFailure、绝不伪造 recovery。
   */
  const settleRecoveryNotice = (): void => {
    const notice = computeRecoveryNotice({
      status: harness.status(),
      state: launcher.read(),
      acknowledgedHash: uiStore?.read().state.acknowledgedRecoveryHash ?? null,
    })
    if (notice === null) return
    recoveryNotice = notice
  }

  /** 动作失败的统一出口：脱敏提示 + 推送最新模型，绝不让 reject 裸奔。 */
  const reportFailure = (error: unknown): void => {
    const title = dictText(stringsFor(localeOf()), 'dialog.harness-failed.title')
    dialog.showMessageBox({
      type: 'info',
      title,
      message: title,
      detail: redactSecrets(error instanceof Error ? error.message : String(error)),
    }).catch(() => undefined)
    broadcast()
  }

  /** shim 落盘的形态事实在这里凑齐；写盘本身在 terminal-service。 */
  const ensureTerminalShims = (activeProfile: string): string => writeTerminalShims({
    binDir: join(app.getPath('userData'), 'deepseekgui-bin'),
    packaged,
    root,
    resourcesPath: process.resourcesPath,
    moduleDir: MODULE_DIR,
    env: process.env,
    activeProfile,
    platform: process.platform,
  })

  /**
   * DSH Terminal（Tray 与 Chrome 的 Open DSH Terminal 共用此唯一服务）：
   * - 终端宿主按 Windows Terminal → PowerShell → cmd 探测顺序选择（exact
   *   executable + argv；一个候选不存在才进入下一候选；启动后的真实失败
   *   明确报告，绝不无限 fallback）。
   * - Windows Terminal 存在时直接 spawn 独立系统终端窗口（detached 语义，
   *   环境注入私有 shim PATH 与 DSH_HOME）；否则内嵌 ConPTY 窗口（pty
   *   host = ELECTRON_RUN_AS_NODE + runtime node-pty，xterm UI）。
   * - cwd 优先 active Profile 目录，不可用则 Harness Home（welcome 说明），
   *   绝不静默锚到 Electron install dir。
   * - welcome 显示 DeepSeekGUI/DSH 版本、Active Profile、DSH_HOME 与私有
   *   Runtime 来源。
   */
  const openDshTerminal = async (currentSessionId?: string): Promise<void> => {
    if (terminalWindow !== undefined && !terminalWindow.isDestroyed()) {
      terminalWindow.show()
      terminalWindow.focus()
      return
    }
    if (terminalOperation !== undefined && terminalOperation.running()) return
    const state = launcher.read()
    const dshHome = resolveHarnessHome(state.active.home, userDataDir)
    // 私有 shim PATH 只 **prepend**（绝不替换）：用户工具（git/python 等）
    // 原样保留；"无系统 Node/pnpm 仍可用"由测试环境的干净 PATH 构造
    // （verify-desktop-dist 门禁），不靠生产代码替换实现。
    const shimDir = ensureTerminalShims(state.active.profile)
    const shimPath = `${shimDir}${delimiter}${process.env.PATH ?? ''}`

    // pnpm 实际版本（打包态读私有 Runtime 包，dev 从 npm_execpath 解析）。
    let pnpmVersion: string | null = null
    if (packaged) {
      try {
        const manifest = JSON.parse(readFileSync(join(process.resourcesPath, 'dsh', 'node_modules', 'pnpm', 'package.json'), 'utf8')) as { version?: unknown }
        pnpmVersion = typeof manifest.version === 'string' ? manifest.version : null
      } catch {
        pnpmVersion = null
      }
    } else {
      pnpmVersion = pnpmVersionFromExecpath(process.env.npm_execpath)
    }

    // 终端宿主与 cwd：纯函数选择，绝不猜路径。POSIX 走 $SHELL → bash → sh
    // 的内嵌链（Linux 没有可探测的标准外置终端）。
    const shell = process.platform === 'win32'
      ? resolveTerminalShell(
        { exists: path => existsSync(path) },
        process.env.LOCALAPPDATA,
      )
      : resolvePosixTerminalShell({ exists: path => existsSync(path) }, process.env.SHELL)
    // P9-3：cwd 对齐 Workbench **当前打开的会话**。浏览器只送会话 id
    // （不可信输入），cwd 由 main 从权威 session.list 解析；id 不存在、
    // 会话无 cwd、Harness 不可达或未带 id（tray/chrome 菜单入口）都静默
    // 回退 Profile 目录 → Harness Home。B5-P1：task workdir 支路随
    // task.get 退役删除；任务 cwd 的终端入口等 P4 工具路径恢复。
    let sessionCwd: string | null = null
    if (currentSessionId !== undefined && harness.status().phase === 'running' && harnessApi !== undefined) {
      try {
        sessionCwd = resolveSessionCwdById((await harnessApi.sessionList()).items, currentSessionId)
      } catch {
        sessionCwd = null
      }
    }
    const cwdChoice = resolveTerminalCwd(
      controlState.discovery, state.active.profile, dshHome, path => existsSync(path), localeOf(), sessionCwd,
    )
    const welcomeLines = buildTerminalWelcome({
      appVersion: versionInfo.appVersion,
      dshVersion: versionInfo.embeddedDshVersion,
      nodeVersion: process.versions.node,
      pnpmVersion,
      activeProfile: state.active.profile,
      dshHome,
      shellLabel: shell.label,
      cwd: cwdChoice.cwd,
      cwdNote: cwdChoice.note,
    }, localeOf())
    if (quitting || (terminalWindow !== undefined && !terminalWindow.isDestroyed()) || terminalOperation?.running()) return

    // Windows Terminal：独立系统终端窗口（exact argv 直 spawn）。
    // welcome 经 deepseekgui-welcome.cmd（只含 echo 事实行）打印后交还交互；
    // 承载 shell 用 System32 cmd（/k 是 cmd 的 argv 语义，避免 PowerShell
    // -Command 的 shell-string 违规）。启动后的真实失败（非零退出）明确
    // 报告，绝不 fallback 到别的宿主。
    if (shell.kind === 'external') {
      const welcomeCmd = join(shimDir, 'deepseekgui-welcome.cmd')
      writeFileSync(
        welcomeCmd,
        welcomeLines.map(line => `echo ${line.replace(/[&|<>^%!]/g, '^$&')}`).join('\r\n') + '\r\n',
      )
      const cmdExe = 'C:\\Windows\\System32\\cmd.exe'
      const wtArgs = existsSync(cmdExe)
        ? [...shell.args, '-d', cwdChoice.cwd, cmdExe, '/k', welcomeCmd]
        : [...shell.args, '-d', cwdChoice.cwd]
      const operation = runDesktopCommand({
        slot: 'terminal',
        zh: desktopLocaleZh(),
        command: shell.executable,
        args: wtArgs,
        cwd: cwdChoice.cwd,
        env: withPath({ ...process.env, DSH_HOME: dshHome }, shimPath),
        onExit: (result) => {
          const dict = stringsFor(localeOf())
          if (result.error !== undefined) {
            reportFailure(new Error(dictText(dict, 'error.wt-launch', { reason: result.error })))
          } else if (result.exitCode !== null && result.exitCode !== 0) {
            reportFailure(new Error(dictText(dict, 'error.wt-exit', { code: String(result.exitCode) })))
          }
          if (terminalOperation === operation) terminalOperation = undefined
        },
      })
      terminalOperation = operation
      return
    }

    // 终端侧窗继承主窗的几何记忆（P8-D28）：「主窗记得、侧窗不裸奔」，
    // 此后新增侧窗（如 Workbench 窗）照此办理。
    // 主题**不**跟随（住户 2026-08-23 验收定）：终端永远深色。浅色模式下
    // 的白终端实测被否——终端这个物种的皮肤就是黑底白字，程序员对它的
    // 预期与应用主题无关。DS 原提案的「两套 xterm theme」不做。
    const savedTerminalBounds = uiStore?.read().state.terminalBounds ?? null
    const win = new BrowserWindow({
      width: 900,
      height: 560,
      title: 'DSH Terminal — DeepSeekGUI',
      // 与主窗同款窗口图标（开发态否则是 Electron 默认原子）。
      icon: join(MODULE_DIR, '..', 'src', 'chrome', 'icon.png'),
      // 固定深色；与 terminal/style.css 及 xterm 配色同值（原先三处
      // #0c0c0c/#0a0a0a 不一，顺手统一为 #0a0a0a）。
      backgroundColor: THEME_BACKGROUND.dark,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(MODULE_DIR, 'terminal', 'preload.cjs'),
        // renderer 的退出消息按此选语言（P7-H：英文系统不再看到中文方块字）。
        // shell label 供启动期提示行显示真实宿主（Linux 是 bash/zsh，不再
        // 写死 PowerShell）；URI 编码防 Electron 在 Windows 上按空格拆
        // additionalArguments（"PowerShell 7"）。
        additionalArguments: [
          `--deepseekgui-locale=${desktopLocaleZh() ? 'zh' : 'en'}`,
          `--deepseekgui-shell=${encodeURIComponent(shell.label)}`,
        ],
      },
    })
    terminalWindow = win
    terminalSize = undefined
    // 恢复保存的几何：与主窗同法 clamp 到当前可见工作区，内容区几何进出
    // （setBounds↔getNormalBounds 在 DPI 换算里不是幂等的，见主窗注释）。
    if (savedTerminalBounds !== null) {
      const display = screen.getDisplayMatching(savedTerminalBounds)
      win.setContentBounds(clampBoundsToWorkArea(savedTerminalBounds, display.workArea, 480, 320))
    }
    // 保存时机选 close（而不是 moved/resized 防抖）：终端窗生命周期短、
    // 无 maximized 追踪，关窗一次落盘足够，也不给 uiStore 添写入频率。
    win.once('close', () => {
      const store = uiStore
      if (store === undefined || win.isDestroyed()) return
      if (win.isMinimized() || win.isMaximized()) return
      try {
        store.write({ ...store.read().state, terminalBounds: win.getContentBounds() })
      } catch (error) {
        // UI 偏好写失败只记诊断，绝不挡关窗。
        console.error(`[deepseekgui] 终端窗几何写入失败: ${String(error instanceof Error ? error.message : error)}`)
      }
    })
    win.once('closed', () => {
      terminalWindow = undefined
      if (terminalOperation !== undefined) {
        const closing = terminalOperation
        void closing.cancel().then(() => {
          if (terminalOperation === closing) terminalOperation = undefined
        }, reportFailure)
      }
    })
    await win.webContents.loadFile(join(MODULE_DIR, '..', 'src', 'terminal', 'index.html'))
    if (win.isDestroyed() || quittingNow()) return

    // pty host：packaged = Electron 自身 + asar 内 host.cjs；dev = tsx 源码。
    const runtimeModules = packaged
      ? join(process.resourcesPath, 'dsh', 'node_modules')
      : join(root, 'apps', 'deepseekgui', 'node_modules')
    const hostArgs = packaged
      ? ['--expose-internals', join(MODULE_DIR, 'terminal-host.cjs'), runtimeModules]
      : ['--import', 'tsx/esm', join(root, 'apps', 'deepseekgui', 'src', 'terminal-host.cts'), runtimeModules]
    const hostCommand = packaged ? process.execPath : (process.env.npm_node_execpath ?? 'node')
    let terminalStderr = ''
    let terminalExitReported = false

    const operation = runDesktopCommand({
      slot: 'terminal',
      zh: desktopLocaleZh(),
      command: hostCommand,
      args: hostArgs,
      // host 进程自己的 cwd 与用户终端的 cwd 是两回事：pty 的 cwd 走
      // DEEPSEEKGUI_TERMINAL_CWD（terminal-host 里显式取用）。开发态 host 用
      // `--import tsx/esm` 起源码，Node 按 host cwd 解析 'tsx'——cwd 落在
      // profile 目录时直接 ERR_MODULE_NOT_FOUND（2026-08-23 实机，D36 修好
      // 显示后现形），所以开发态必须以仓库根为 cwd；打包态维持原样。
      cwd: packaged ? cwdChoice.cwd : root,
      env: {
        ...process.env,
        ...packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {},
        DEEPSEEKGUI_TERMINAL_DSH_HOME: dshHome,
        DEEPSEEKGUI_TERMINAL_PATH: shimPath,
        DEEPSEEKGUI_TERMINAL_WELCOME: welcomeLines.join('\n'),
        DEEPSEEKGUI_TERMINAL_SHELL: shell.executable,
        DEEPSEEKGUI_TERMINAL_SHELL_ARGS: JSON.stringify(shell.args),
        DEEPSEEKGUI_TERMINAL_CWD: cwdChoice.cwd,
      },
      onOutput: (stream, text) => {
        if (win.isDestroyed()) return

        if (stream === 'stdout') {
          win.webContents.send('deepseekgui-terminal:data', text)
          return
        }
        // stderr = JSON-lines 事件；非 JSON 行照实透传（已脱敏）。
        terminalStderr += text
        const lines = terminalStderr.split('\n')
        terminalStderr = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') continue
          try {
            const event = JSON.parse(line) as { event?: string; exitCode?: number | null; message?: string }
            if (event.event === 'exit') {
              terminalExitReported = true
              win.webContents.send('deepseekgui-terminal:exit', event.exitCode ?? null)
            } else if (event.event === 'error') {
              win.webContents.send('deepseekgui-terminal:error', redactSecrets(event.message ?? ''))
            } else {
              win.webContents.send('deepseekgui-terminal:data', line)
            }
          } catch {
            win.webContents.send('deepseekgui-terminal:data', line + '\n')
          }
        }
      },
      onExit: (result) => {
        if (result.error !== undefined) {
          // 启动后的真实失败：明确报告（terminal UI 显示），绝不 fallback。
          if (!win.isDestroyed()) {
            win.webContents.send('deepseekgui-terminal:error', redactSecrets(`终端启动失败: ${result.error}`))
          }
        } else if (!win.isDestroyed() && !terminalExitReported) {
          win.webContents.send('deepseekgui-terminal:exit', result.exitCode)
        }
        if (terminalOperation === operation) terminalOperation = undefined
      },
    })
    terminalOperation = operation
    // The renderer can publish its size through IPC while loadFile is awaited.
    const initialSize = terminalSize as { cols: number; rows: number } | undefined
    if (initialSize !== undefined) operation.write(`${JSON.stringify({ type: 'resize', ...initialSize })}\n`)
  }

  // ---- Plugin Manager 执行面（只走官方 dsh plugin CLI + broker maintenance 槽） ----

  /** 从 discovery 找 target 条目（含 bundles/staticStatus 的展示事实）。 */
  const findDiscoveredProfile = (name: string): DiscoveredProfile | null => {
    const discovery = controlState.discovery
    if (discovery === null) return null
    return discovery.profiles.find(item => item.name === name) ?? null
  }

  /** 读取当前磁盘事实的 target 快照（post-check 的 before/after 同源）。 */
  const readPluginSnapshot = (profile: DiscoveredProfile): PluginSnapshot => {
    const manifest = readManifestDependencies(profile.dir)
    return {
      dependencies: manifest.ok ? manifest.dependencies : {},
      bundles: profile.bundles,
      staticStatus: profile.staticStatus,
    }
  }

  // ---- Plugin Mutation Recovery 执行面（P6-F：journal 只在 userData） ----

  const recoveryDir = (): string => join(userDataDir, RECOVERY_DIRNAME)
  const recoveryJournalPath = (): string => join(userDataDir, RECOVERY_DIRNAME, RECOVERY_JOURNAL_FILENAME)
  const recoverySnapshotDir = (txId: string): string => join(userDataDir, RECOVERY_DIRNAME, RECOVERY_SNAPSHOTS_DIRNAME, txId)

  /**
   * 把内存 journal 落盘，并如实报告成没成。
   *
   * 两处改动都要紧：一是原子替换（同目录临时文件 → rename），进程死在写
   * 途中只会留下旧文件或完整新文件，绝不会留半截 JSON——而半截 JSON 会
   * 在下次启动时被当成"没有待恢复事务"，恰好在最需要恢复的时候把恢复
   * 能力清零。二是返回写入结果：原先失败只记一行日志就继续，于是"没有
   * 恢复记录"和"有恢复记录"在调用方眼里长得一模一样。
   * @returns 是否成功落盘（journal 为空视为成功：没有东西需要写）。
   */
  const writeRecoveryJournal = (): boolean => {
    if (recoveryJournal === null) return true
    try {
      mkdirSync(recoveryDir(), { recursive: true })
      atomicWriteFile(recoveryJournalPath(), serializeRecoveryJournal(recoveryJournal), message => new Error(message))
      recoveryJournalError = null
      return true
    } catch (error) {
      recoveryJournalError = redactSecrets(String(error instanceof Error ? error.message : error))
      console.error(`[deepseekgui] recovery journal 写入失败: ${recoveryJournalError}`)
      return false
    }
  }

  /**
   * 恢复写入：单文件原子替换（同目录临时文件 → rename）。进程若恰好在
   * 覆盖 package.json 的那一刻死掉，磁盘上要么是旧版本、要么是完整的
   * 恢复版本，不会留下半截文件——而这几个文件正是 Harness 下次启动要读的。
   * 只保证单文件原子，不做跨文件事务：三个文件的整体一致性由 journal 与
   * applyRestore 的"任一快照不可用就一个字节都不写"共同保证。
   */
  const atomicRestoreWrite = (path: string, content: Buffer): void => {
    atomicWriteFile(path, content, message => new Error(message))
  }

  /** 启动时读取 journal（缺失 = 无未决事务；损坏 = 明确记录，绝不猜测）。 */
  const loadRecoveryJournal = (): void => {
    try {
      recoveryJournal = parseRecoveryJournal(readFileSync(recoveryJournalPath(), 'utf8'))
      recoveryJournalError = null
    } catch (error) {
      const cause = error as NodeJS.ErrnoException
      if (cause.code === 'ENOENT') {
        recoveryJournal = null
        recoveryJournalError = null
        return
      }
      // 损坏的 journal 无法证明归属：按无未决事务处理并明确记录。
      recoveryJournal = null
      recoveryJournalError = redactSecrets(String(error instanceof Error ? error.message : error))
      console.error(`[deepseekgui] recovery journal 损坏，按无未决事务处理: ${recoveryJournalError}`)
    }
  }

  /** 删除一个事务的 journal 与快照（事务结算/放弃/verified 的清理路径）。 */
  const clearRecoveryTransaction = (): void => {
    const journal = recoveryJournal
    recoveryJournal = null
    if (journal === null) return
    try {
      unlinkSync(recoveryJournalPath())
    } catch {
      // journal 文件不存在：快照清理照常。
    }
    try {
      rmSync(recoverySnapshotDir(journal.txId), { recursive: true, force: true })
    } catch {
      // 快照清理失败只记诊断：孤儿快照是 dead data，下次可手动清理。
    }
  }

  /**
   * 失败/取消后保留事务，并如实写下这次失败是谁造成的。
   *
   * 原先这三条路径一律清事务，理由是"没通过验证的操作不进入恢复边界"。
   * 听起来自洽，代价却是：pnpm 取消时可能已经改了一半磁盘，而唯一能修好
   * 它的快照，恰好在这一刻被我们自己删了——用户重启发现 Harness 起不来，
   * 界面上连"恢复"按钮都没有，因为记录已经没了。
   *
   * failure 这段话有两个读者：出事的用户，和 Profile 里那个要向用户解释
   * 的 AI。所以它必须说清归因，别让谁背不该背的锅。
   * @param cause - 失败归因。
   */
  const keepRecoveryForManualHandling = (cause: PluginFailureCause): void => {
    const journal = recoveryJournal
    if (journal === null) return
    const zh = desktopLocaleZh()
    const reason = describePluginFailure(cause, zh)
    const at = new Date().toISOString()
    // 事件文件先写：failure 摘要要带上它的路径，用户在设置页看到路径才知道
    // 去哪查，也才好让 Profile 里的 DS 去读。
    const eventFile = appendDesktopEvent(journal.homePath, {
      at: formatStampLocal(at),
      title: zh ? '插件操作失败' : 'Plugin operation failed',
      sections: [
        [
          zh ? '发生了什么' : 'What happened',
          zh
            ? `在 Profile ${journal.profile} 上执行 ${journal.operation}${journal.spec === null ? '' : `（${redactSecrets(journal.spec)}）`} 没有成功。`
            : `A ${journal.operation}${journal.spec === null ? '' : ` of ${redactSecrets(journal.spec)}`} on profile ${journal.profile} did not succeed.`,
        ],
        [zh ? '原因' : 'Cause', reason],
        [
          zh ? '如果用户问起' : 'If the user asks',
          zh
            ? '照上面的事实说明就好。这类失败不是 DeepSeekGUI 的故障，也不是助手的错，不需要道歉或替谁承担；'
              + '恢复记录和快照都还在，可以告诉用户在 DeepSeekGUI 的设置页里恢复到这次操作之前的状态。'
            : 'State the facts above as they are. This is not a DeepSeekGUI fault, and not something the assistant did wrong; there is nothing to apologise for. '
              + 'The recovery record and snapshot are intact, so the user can restore the pre-operation state from the DeepSeekGUI settings page.',
        ],
      ],
    }, zh)
    recoveryJournal = {
      ...journal,
      state: 'recovery-needed',
      failure: eventFile === null ? reason : `${reason}${zh ? `完整记录：${eventFile}` : ` Full record: ${eventFile}`}`,
      updatedAt: at,
    }
    writeRecoveryJournal()
  }

  /**
   * 恢复记录连续写不进去的次数。前两次一律拦住，第三次才把决定权交给
   * 用户——正常人看到"磁盘满了"会先去清磁盘，两次之后还坚持要装的，是
   * 自己知道在做什么。把话说在前头，责任才谈得上是他自己选的。
   */
  let recoveryJournalWriteFailures = 0

  /**
   * 恢复记录写不进去时的处置：说清楚为什么，前两次拒绝，第三次让用户选。
   * @param rawError - 原始写入错误消息（用于翻译成人话）。
   * @returns 是否在没有恢复保护的情况下继续安装。
   */
  const confirmWithoutRecoveryProtection = async (rawError: string | null): Promise<boolean> => {
    const zh = desktopLocaleZh()
    recoveryJournalWriteFailures += 1
    const cause = describeWriteFailure(rawError ?? '', zh)
    const reason = cause ?? (zh ? '写入失败' : 'the write failed')
    const where = zh ? `位置：${recoveryDir()}` : `Location: ${recoveryDir()}`
    if (recoveryJournalWriteFailures < 3) {
      await dialog.showMessageBox({
        type: 'error',
        noLink: true,
        buttons: [zh ? '知道了' : 'OK'],
        message: zh ? '无法建立恢复记录，安装已取消' : 'Could not create the recovery record; the install was cancelled',
        detail: [
          zh ? `原因：${reason}。` : `Cause: ${reason}.`,
          where,
          '',
          zh
            ? '恢复记录是插件装坏时退回上一个状态的唯一依据。它写不进去就先不动 Profile——处理好上面的问题再试一次。'
            : 'The recovery record is the only way back if a plugin install goes wrong. Until it can be written, the profile is left untouched — fix the problem above and try again.',
        ].join('\n'),
      }).catch(() => undefined)
      return false
    }
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [
        zh ? '仍要安装（没有恢复保护）' : 'Install anyway (no recovery protection)',
        zh ? '取消' : 'Cancel',
      ],
      defaultId: 1,
      cancelId: 1,
      message: zh ? '仍然无法建立恢复记录' : 'The recovery record still cannot be written',
      detail: [
        zh ? `原因：${reason}。` : `Cause: ${reason}.`,
        where,
        '',
        zh
          ? '这已经是第三次了。你可以选择继续，但请先知道代价：这次安装如果失败或者被中断，DeepSeekGUI 没有办法帮你退回上一个状态，需要你自己处理 Profile 里的文件。'
          : 'This is the third attempt. You may continue, but know the cost: if this install fails or is interrupted, DeepSeekGUI cannot roll the profile back for you — you will have to fix the files yourself.',
      ].join('\n'),
    }).catch(() => ({ response: 1 }))
    return choice.response === 0
  }

  /** 仅删除快照（recovered 后 journal 作为证据保留，快照不再需要）。 */
  const clearRecoverySnapshots = (): void => {
    if (recoveryJournal === null) return
    try {
      rmSync(recoverySnapshotDir(recoveryJournal.txId), { recursive: true, force: true })
    } catch {
      // 同上：孤儿快照无害。
    }
  }

  /**
   * 单事务规则：同一 Home/Profile 已有未验证事务时禁止发起新的写操作。
   * @param profile - 目标 Profile。
   * @returns 阻止原因；null = 可继续。
   */
  const blockedByPendingTransaction = (profile: string): string | null => {
    const journal = recoveryJournal
    if (journal === null || !isJournalPending(journal)) return null
    const state = launcher.read()
    const dshHome = resolveHarnessHome(state.active.home, userDataDir)
    if (journal.homePath === dshHome && journal.profile === profile) {
      return '该 Home / Profile 已有一项未验证的插件变更；请先重启并验证上一次插件变更（或放弃恢复）'
    }
    // 别的 Home/Profile 的未决事务同样要挡：journal 是单份文件，放行会让
    // 新事务直接覆盖它——上一个事务的恢复承诺静默失效，快照变成谁也找不到
    // 的孤儿目录。施工单要的"一个窄 journal"就意味着同一时刻只能有一个
    // 未决事务，跨目标也不例外。
    return `另一个目标已有未验证的插件变更（${journal.profile} @ ${journal.homePath}）；`
      + '请先切回该目标重启验证或放弃恢复，再发起新的写操作'
  }

  /**
   * 插件事务结算：boot 健康后 verified（删事务）；boot 失败时按 P6 6.9-6.11
   * 走 drift → fail closed / Managed 自动恢复一次 / Existing 等待确认。
   */
  const settlePluginRecovery = async (): Promise<void> => {
    const zh = desktopLocaleZh()
    const journal = recoveryJournal
    if (journal === null) return
    // `recovered` 是一次性告知（"上次装插件把启动搞坏了，已经替你恢复"），
    // 不是待办：它不再 pending，所以下面的结算分支永远碰不到它，而面板
    // 的 recovery 区块直接读 journal——不清就会一直挂着那句话，且没有任何
    // 用户可达的出口（Abandon 只接受 pending）。生命周期止于下一次启动
    // 动作：出事的那次会话里看得到，此后消失。
    if (journal.state === 'recovered') {
      clearRecoveryTransaction()
      broadcast()
      return
    }
    if (!isJournalPending(journal)) return
    const state = launcher.read()
    const dshHome = resolveHarnessHome(state.active.home, userDataDir)
    if (journal.homePath !== dshHome || journal.profile !== state.active.profile) return
    const status = harness.status()
    const profileDir = join(dshHome, 'profiles', journal.profile)
    const now = (): string => new Date().toISOString()
    if (status.phase === 'running') {
      const action = bootHealthySettleAction(journal.state)
      if (action === 'verify') {
        // 下一代 Host + Web readiness + Client Loader settle 全部通过：
        // 事务 verified，删除 journal 与快照。
        clearRecoveryTransaction()
        broadcast()
      } else if (action === 'resolve-stale') {
        // state==='running' 且无在途操作 = 崩溃残留（post-check 从未完成）：
        // 事务不成立，与取消路径同语义清理并解锁单事务规则。在途操作
        // （broker 未结算）保持不动——boot 结算绝不能把"当前代仍在跑"
        // 当成"下一代健康"（实测：add 期间 settle 清掉过 running journal）。
        if (!pluginOperationInFlight()) {
          clearRecoveryTransaction()
          broadcast()
        }
      }
      // action==='keep'：recovery-needed / drift 是人工处理状态，boot 成功
      // 不自动解除（用户可 Abandon）。
      return
    }
    if (status.phase !== 'failed') return
    if (journal.state === 'recovery-needed' || journal.state === 'drift') return
    if (journal.autoRecoveredOnce) {
      recoveryJournal = { ...journal, state: 'recovery-needed', updatedAt: now() }
      writeRecoveryJournal()
      broadcast()
      return
    }
    // state==='running' 且 boot 失败：post-check 从未完成（postHashes 必为
    // null），走下面的 postHashes===null 分支 → recovery-needed 人工入口，
    // 绝不自动恢复。
    // boot 失败：先证明文件归属（post hash 无 drift），否则 fail closed。
    let current: RecoveryFacts
    try {
      current = readWhitelistFacts(profileDir)
    } catch (error) {
      // 白名单文件存在却读不到（权限/占用/IO）：既证明不了归属，也判不了
      // drift。绝不在这种状态下自动改写用户的 Profile——转人工恢复入口。
      recoveryJournal = {
        ...journal,
        state: 'recovery-needed',
        failure: zh
          ? `无法读取 Profile 的白名单文件：${redactSecrets(String(error instanceof Error ? error.message : error))}；自动恢复已停止，请人工处理。`
          : `Could not read the whitelisted profile files: ${redactSecrets(String(error instanceof Error ? error.message : error))}. Automatic recovery has stopped; handle this manually.`,
        updatedAt: now(),
      }
      writeRecoveryJournal()
      broadcast()
      return
    }
    if (journal.postHashes === null) {
      recoveryJournal = {
        ...journal,
        state: 'recovery-needed',
        failure: zh
          ? '缺少 post-operation hash，无法证明文件归属；自动恢复已停止，请人工处理。'
          : 'Post-operation hashes are missing, so file ownership cannot be proven. Automatic recovery has stopped; handle this manually.',
        updatedAt: now(),
      }
      writeRecoveryJournal()
      broadcast()
      return
    }
    const drift = detectDrift(journal.postHashes, current)
    if (drift.length > 0) {
      recoveryJournal = {
        ...journal,
        state: 'drift',
        failure: zh
          ? `事务后这些文件被外部修改：${drift.join('、')}。自动恢复已停止，绝不覆盖外部修改。`
          : `These files were modified externally after the transaction: ${drift.join(', ')}. Automatic recovery has stopped and will never overwrite external changes.`,
        updatedAt: now(),
      }
      writeRecoveryJournal()
      broadcast()
      return
    }
    if (journal.homeKind === 'existing') {
      // Existing Home 恢复必须用户确认：绝不静默覆盖用户 Profile。
      recoveryJournal = {
        ...journal,
        state: 'recovery-needed',
        failure: zh
          ? '插件变更后 Harness 启动失败；恢复需要你的确认。'
          : 'The plugin change broke the Harness launch; recovery requires your confirmation.',
        updatedAt: now(),
      }
      writeRecoveryJournal()
      broadcast()
      return
    }
    // Managed Home：hash 无 drift 时允许自动恢复一次 + 最多自动重启一次。
    try {
      const plan = planRestore(journal.preFacts, journal.postHashes, current)
      // 先把"这一次已经用掉了"钉进磁盘，再动 Profile。反过来写的话，进程
      // 死在"恢复完成"与"标志落盘"之间，下次启动会把同一次自动恢复重跑
      // 一遍——一次性保证就不再是一次性的了。落不了盘就干脆别恢复。
      recoveryJournal = {
        ...journal,
        autoRecoveredOnce: true,
        failure: zh
          ? '已自动恢复三个白名单文件，正在重启验证。'
          : 'The three whitelisted files were restored automatically; restarting to verify.',
        updatedAt: now(),
      }
      if (!writeRecoveryJournal()) {
        throw new Error(zh
          ? `无法写入恢复记录（${describeWriteFailure(recoveryJournalError ?? '', true) ?? '原因未知'}），未改动任何文件`
          : `Could not persist the recovery record (${describeWriteFailure(recoveryJournalError ?? '', false) ?? 'unknown cause'}); nothing was changed`)
      }
      applyRestore(profileDir, recoverySnapshotDir(journal.txId), journal.preFacts, plan, atomicRestoreWrite, unlinkSync)
      await harness.restart()
      const after = harness.status()
      if (after.phase === 'running') {
        // 只改 state 会把 failure 里那句「正在重启验证」留在屏幕上——验证其实
        // 几秒前就过了。住户实测因此以为还要自己手动重启一次（2026-08-26）。
        recoveryJournal = {
          ...recoveryJournal,
          state: 'recovered',
          failure: zh
            ? '已自动恢复并重启成功，可以继续使用；刚才那个插件没有装上。'
            : 'Recovered automatically and restarted successfully; the plugin was not installed.',
          updatedAt: now(),
        }
        writeRecoveryJournal()
        // DeepSeekGUI 自己动了用户 Profile 里的文件——这件事必须留下记录，
        // 否则用户看到文件内容变了却查不到是谁改的。
        appendDesktopEvent(journal.homePath, {
          at: formatStampLocal(now()),
          title: zh ? 'DeepSeekGUI 自动恢复了插件配置文件' : 'DeepSeekGUI restored the plugin configuration automatically',
          sections: [
            [
              zh ? '发生了什么' : 'What happened',
              zh
                ? `上一次插件操作之后 Harness 起不来，DeepSeekGUI 把 Profile ${journal.profile} 的三个配置文件恢复到了操作之前的样子，然后重启验证通过。`
                : `The harness failed to start after the last plugin operation, so DeepSeekGUI restored the three configuration files of profile ${journal.profile} to their pre-operation state and verified the restart.`,
            ],
            [
              zh ? '用户的文件被改了吗' : 'Were the user files changed',
              zh
                ? '是的，但只改了这三个白名单文件（package.json / pnpm-lock.yaml / pnpm-workspace.yaml），而且改回的是操作之前的原样内容，逐字节一致。其他文件一律没碰。'
                : 'Yes, but only the three whitelisted files (package.json / pnpm-lock.yaml / pnpm-workspace.yaml), and only back to their exact pre-operation bytes. Nothing else was touched.',
            ],
            [
              zh ? '如果用户问起' : 'If the user asks',
              zh
                ? '照实说明就好：这是 DeepSeekGUI 的自动恢复，只会发生一次，目的是让 Harness 能重新启动。用户之前装的那个插件没有装上。'
                : 'State it plainly: this was DeepSeekGUI automatic recovery, it happens at most once, and its purpose was to get the harness starting again. The plugin the user tried to install is not installed.',
            ],
          ],
        }, zh)
        clearRecoverySnapshots()
      } else {
        recoveryJournal = {
          ...recoveryJournal,
          state: 'recovery-needed',
          failure: zh
            ? '自动恢复后重启仍失败；自动动作已停止，请人工处理。'
            : 'Harness still fails after automatic recovery and restart; automatic actions have stopped. Handle this manually.',
          updatedAt: now(),
        }
        writeRecoveryJournal()
      }
      broadcast()
    } catch (error) {
      recoveryJournal = {
        ...journal,
        state: 'recovery-needed',
        failure: redactSecrets(
          zh
            ? `自动恢复失败：${String(error instanceof Error ? error.message : error)}`
            : `Automatic recovery failed: ${String(error instanceof Error ? error.message : error)}`,
        ),
        autoRecoveredOnce: recoveryJournal?.autoRecoveredOnce ?? journal.autoRecoveredOnce,
        updatedAt: now(),
      }
      writeRecoveryJournal()
      broadcast()
    }
  }

  /** 用户确认后执行恢复（Existing Home 路径；Managed 失败后的人工入口共用）。 */
  const runRecoveryRestore = async (): Promise<void> => {
    const journal = recoveryJournal
    if (journal === null || journal.state !== 'recovery-needed') return
    const state = launcher.read()
    const dshHome = resolveHarnessHome(state.active.home, userDataDir)
    const zh = desktopLocaleZh()
    // 恢复目标恒为 journal 记录的那个 Home——恢复区块在切换 Home 后依然
    // 显示，此时当前 active home 已不是事务发起时的那个。用当前 home 拼
    // profileDir 会把 A 的快照写进 B 的 Profile（真实的数据破坏路径）。
    // 目标不一致时一律拒绝执行，只指路，绝不跨 Home 写入。
    if (journal.homePath !== dshHome) {
      void dialog.showMessageBox({
        type: 'warning',
        noLink: true,
        buttons: [zh ? '确定' : 'OK'],
        message: zh ? '恢复目标不是当前 Harness Home' : 'The recovery target is not the current Harness Home',
        detail: [
          zh
            ? '这项待恢复的插件变更属于另一个 Harness Home。DeepSeekGUI 绝不会把它的快照写进当前 Home。'
            : 'This pending plugin change belongs to a different Harness Home. DeepSeekGUI will never write its snapshot into the current Home.',
          '',
          `${zh ? '事务目标' : 'Transaction target'}：${journal.homePath}`,
          `${zh ? '当前 Home' : 'Current Home'}：${dshHome}`,
          `Profile：${journal.profile}`,
          '',
          zh
            ? '请先切回该 Home 再执行恢复；或在此放弃恢复（放弃只清除记录，不改动任何文件）。'
            : 'Switch back to that Home before restoring, or abandon the recovery here (abandoning only clears the record and changes no files).',
        ].join('\n'),
      }).catch(() => undefined)
      return
    }
    const profileDir = join(dshHome, 'profiles', journal.profile)
    // 同 settle：读不到就证明不了归属，宁可不恢复，也不拿猜测覆盖用户文件。
    // 这条路径要读两次（确认框之后磁盘可能已变），失败的说法只此一份。
    const readFactsOrReport = (): RecoveryFacts | null => {
      try {
        return readWhitelistFacts(profileDir)
      } catch (error) {
        void dialog.showMessageBox({
          type: 'error',
          noLink: true,
          buttons: [zh ? '确定' : 'OK'],
          message: zh ? '无法读取 Profile 文件，恢复未执行' : 'Could not read the profile files; nothing was restored',
          detail: redactSecrets(String(error instanceof Error ? error.message : error)),
        }).catch(() => undefined)
        return null
      }
    }
    const current = readFactsOrReport()
    if (current === null) return
    const plan = recoveryPlan(journal.preFacts, journal.postHashes, current)
    if (plan === null) {
      // fail closed，与 settlePluginRecovery 对 postHashes===null 的判定一致：
      // 该组合可达（事务在 post-check 记录 hash 之前崩溃/被杀，boot 失败后
      // settle 置 recovery-needed 并写明"无法证明归属"）。缺少 post hash 时
      // 恢复计划的归属证明不成立——`?? {}` 降级虽不会误删（pre-absent 永不进
      // remove 分支），却会把快照写回覆盖当前文件，等于绕过了"DeepSeekGUI 自己
      // 发起、hash 能证明归属"的恢复前提。此处只给人工入口，绝不执行恢复。
      const choice = await dialog.showMessageBox({
        type: 'warning',
        noLink: true,
        buttons: [zh ? '打开 Profile 文件夹' : 'Open Profile Folder', zh ? '取消' : 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: zh ? '无法证明文件归属，恢复不可用' : 'Recovery unavailable: file ownership cannot be proven',
        detail: [
          `Home：${journal.homeKind === 'managed' ? (zh ? '托管模式' : 'Managed') : (zh ? '已有目录' : 'Existing')}`,
          `${zh ? '完整路径' : 'Full path'}：${dshHome}`,
          `Profile：${journal.profile}`,
          ...journal.failure === null
            ? [`${zh ? '失败摘要' : 'Failure summary'}：${zh ? '缺少 post-operation hash，无法证明文件归属；请人工处理。' : 'Post-operation hashes are missing; file ownership cannot be proven. Please handle this manually.'}`]
            : [`${zh ? '失败摘要' : 'Failure summary'}：${journal.failure}`],
        ].join('\n'),
      })
      if (choice.response === 0) void shell.openPath(profileDir)
      return
    }
    const fileList = [...plan.restore.map(name => `${name}（${zh ? '恢复' : 'restore'}）`), ...plan.remove.map(name => `${name}（${zh ? '删除' : 'delete'}）`)]
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [zh ? '恢复之前的插件配置' : 'Restore previous plugin configuration', zh ? '取消' : 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: zh ? '恢复之前的插件配置？' : 'Restore previous plugin configuration?',
      detail: [
        `Home：${journal.homeKind === 'managed' ? (zh ? '托管模式' : 'Managed') : (zh ? '已有目录' : 'Existing')}`,
        `${zh ? '完整路径' : 'Full path'}：${dshHome}`,
        `Profile：${journal.profile}`,
        ...journal.failure === null ? [] : [`${zh ? '失败摘要' : 'Failure summary'}：${journal.failure}`],
        '',
        `${zh ? '将恢复的具体文件' : 'Files to restore'}：`,
        ...fileList.length === 0 ? [zh ? '（无需恢复任何文件）' : '(nothing to restore)'] : fileList,
      ].join('\n'),
    })
    if (choice.response !== 0) return
    if (recoveryJournal?.txId !== journal.txId || recoveryJournal.state !== 'recovery-needed') return
    if (resolveHarnessHome(launcher.read().active.home, userDataDir) !== dshHome) return
    // 确认框可能开了很久，而这期间 Profile 是活的：用户可能自己动过手，
    // 别的程序也可能写过。此刻的计划是弹框之前算的，直接照着写等于拿一份
    // 过期备份覆盖用户的现场——所以落盘前必须再读一次磁盘对账。
    // 中断恢复可以留下 pre/post 混合；确认期间的任何变化仍拒绝覆盖。
    const atWriteTime = readFactsOrReport()
    if (atWriteTime === null) return
    const recoveryDrift = detectRecoveryDrift(journal, atWriteTime)
    if (recoveryDrift === null) return
    const driftedNow = [...new Set([...recoveryDrift, ...detectDrift(hashesOfFacts(current), atWriteTime)])]
    if (driftedNow.length > 0) {
      recoveryJournal = { ...journal, state: 'drift', failure: zh
        ? `恢复期间这些文件发生了变化：${driftedNow.join('、')}。为避免覆盖新的改动，恢复已取消。`
        : `These files changed while the dialog was open: ${driftedNow.join(', ')}. Restoring was cancelled so the newer changes are not overwritten.`,
      updatedAt: new Date().toISOString() }
      writeRecoveryJournal()
      appendDesktopEvent(journal.homePath, {
        at: formatStampLocal(new Date().toISOString()),
        title: zh ? '恢复已取消（文件被改动过）' : 'Restore cancelled (files had changed)',
        sections: [
          [
            zh ? '发生了什么' : 'What happened',
            zh
              ? `用户确认恢复 Profile ${journal.profile} 之后，这些文件已经不是本次插件操作留下的那一版：${driftedNow.join('、')}。`
              : `After the user confirmed the restore of profile ${journal.profile}, these files were no longer the version this plugin operation left behind: ${driftedNow.join(', ')}.`,
          ],
          [
            zh ? '为什么没有恢复' : 'Why nothing was restored',
            zh
              ? '继续恢复会用旧快照覆盖掉这些更新的改动。DeepSeekGUI 选择什么都不做，磁盘保持原样。'
              : 'Restoring would have overwritten those newer changes with an old snapshot, so DeepSeekGUI did nothing and the disk is untouched.',
          ],
          [
            zh ? '如果用户问起' : 'If the user asks',
            zh
              ? '这是保护性行为，不是失败：文件在确认期间被改过（可能是用户自己、也可能是别的程序）。'
                + '磁盘没有被动过，用户可以自己查看这几个文件后再决定。'
              : 'This is protective behaviour, not a failure: the files changed while the dialog was open, either by the user or another program. '
                + 'Nothing on disk was modified; the user can inspect those files and decide.',
          ],
        ],
      }, zh)
      broadcast()
      void dialog.showMessageBox({
        type: 'warning',
        noLink: true,
        buttons: [zh ? '打开 Profile 文件夹' : 'Open Profile Folder', zh ? '确定' : 'OK'],
        defaultId: 1,
        cancelId: 1,
        message: zh ? '文件在确认期间被改动，恢复已取消' : 'Files changed while confirming; restore was cancelled',
        detail: [
          zh
            ? '这些文件在你确认之前发生了变化，已经不是本次插件操作留下的那一版：'
            : 'These files changed before you confirmed and are no longer the version this plugin operation left behind:',
          ...driftedNow,
          '',
          zh
            ? '继续恢复会覆盖掉这些新的改动，所以恢复没有执行。请人工处理。'
            : 'Restoring would overwrite those newer changes, so nothing was restored. Please handle this manually.',
        ].join('\n'),
      }).then((result) => {
        if (result.response === 0) void shell.openPath(profileDir)
      }).catch(() => undefined)
      return
    }
    try {
      // 写序与自动恢复相反，这是刻意的。自动路径必须先把 autoRecoveredOnce 落
      // 盘再动磁盘：它由启动流程触发，死在两步之间会让「同一次事务只自动恢复一
      // 次」的保证失效，所以那里宁可落不了盘就不恢复。手动恢复没有这条约束——
      // 它由用户每次点击触发，不会自己重跑，因此先恢复磁盘、再记录结果，写
      // journal 失败也不会留下一条描述着并未发生的恢复的记录。
      applyRestore(profileDir, recoverySnapshotDir(journal.txId), journal.preFacts, plan, atomicRestoreWrite, unlinkSync)
      recoveryJournal = { ...journal, autoRecoveredOnce: true, failure: null, updatedAt: new Date().toISOString() }
      writeRecoveryJournal()
      await harness.restart()
      const after = harness.status()
      if (after.phase === 'running') {
        recoveryJournal = { ...recoveryJournal, state: 'recovered', updatedAt: new Date().toISOString() }
        writeRecoveryJournal()
        clearRecoverySnapshots()
      } else {
        recoveryJournal = {
          ...recoveryJournal,
          state: 'recovery-needed',
          failure: zh ? '恢复后重启仍失败；请人工处理。' : 'Harness still fails after restoring; handle it manually.',
          updatedAt: new Date().toISOString(),
        }
        writeRecoveryJournal()
      }
      broadcast()
    } catch (error) {
      recoveryJournal = {
        ...journal,
        state: 'recovery-needed',
        failure: zh
          ? `恢复执行失败：${redactSecrets(String(error instanceof Error ? error.message : error))}`
          : `Restore failed: ${redactSecrets(String(error instanceof Error ? error.message : error))}`,
        updatedAt: new Date().toISOString(),
      }
      writeRecoveryJournal()
      broadcast()
    }
  }

  /** 放弃恢复：保留当前磁盘状态，清除事务（journal + 快照）。 */
  const runRecoveryAbandon = (): void => {
    if (recoveryJournal === null || !isJournalPending(recoveryJournal)) return
    clearRecoveryTransaction()
    broadcast()
  }

  /**
   * 打开目标 Profile 文件夹（drift/recovery-needed 的人工处理入口）。
   * 打开的恒是 journal 记录的那个 Home——用户要人工处理的是出事的那个
   * Profile，不是碰巧正在用的那个。
   */
  const runRecoveryOpenProfile = (): void => {
    const journal = recoveryJournal
    if (journal === null) return
    void shell.openPath(join(journal.homePath, 'profiles', journal.profile))
  }

  /** 插件写操作的目标透明度确认：Home kind、完整路径、Profile、操作、spec。 */
  const confirmPluginOperation = async (request: PluginOperationRequest): Promise<boolean> => {
    if (SMOKE) return true
    const state = launcher.read()
    const zh = desktopLocaleZh()
    const text = pluginConfirmText({
      homeKind: state.active.home.kind,
      dshHome: resolveHarnessHome(state.active.home, userDataDir),
      profile: request.profile,
      action: request.action,
      spec: request.spec,
      locale: zh ? 'zh' : 'en',
    })
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [zh ? '执行' : 'Run', zh ? '取消' : 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: text.message,
      detail: text.detail,
    })
    return choice.response === 0
  }

  /**
   * 请求一次插件写操作：校验 → 本地路径锚定 → 目标透明度确认 → broker
   * （maintenance 槽）跑官方 CLI → 流式输出 → exit 0 才 post-check →
   * 完成后刷新 discovery/inventory 并给出 restart handoff。绝不自动重启、
   * 绝不改变 active Profile 或 launcher selection。
   * @param raw - renderer 请求（action/profile/spec；锚定目录由 main 补）。
   */
  const requestPluginOperation = async (raw: { action: PluginAction; profile: string; spec: string | null }): Promise<void> => {
    // 施工单要求"同一目标一次只允许一个写操作"：确认框等待期（in-flight）
    // 与运行/验证中的操作都挡住新请求；终态（done/failed/cancelled）允许
    // 开始下一次操作（先清掉旧视图）。
    if (pluginOperationInFlight()) {
      reportFailure(new Error(dictText(stringsFor(localeOf()), 'error.plugin-busy')))
      return
    }
    pluginRequestInFlight = true
    try {
      await beginPluginOperation(raw)
    } catch (error) {
      // 没有这个 catch 时，beginPluginOperation 的任何未预期抛出都只会变成一次
      // 未处理的 rejection——调用方是 `void requestPluginOperation(request)`，
      // 于是用户点了按钮界面毫无反应，日志里也没有归因。与 P11 修掉的
      // startSession 静默失败是同一形态。busy 分支早就走 reportFailure，这里
      // 补齐后失败路径只此一个出口。
      reportFailure(error)
    } finally {
      pluginRequestInFlight = false
    }
  }

  /** 一次插件写操作的主体（requestPluginOperation 持有 in-flight 守卫）。 */
  const beginPluginOperation = async (raw: { action: PluginAction; profile: string; spec: string | null }): Promise<void> => {
    const requestedSelection = launcher.read().active
    // boot 进行中（start/switch/recover）会读 profile manifest：此刻写插件
    // 会让 boot 读到 pnpm 的半写状态。running 时允许（新组合本来就要求
    // restart 才生效，写操作不干扰已运行的 runtime）。
    const booting = harness.status().phase
    if (booting === 'starting' || booting === 'switching' || booting === 'recovering') {
      reportFailure(new Error(dictText(stringsFor(localeOf()), 'error.harness-booting')))
      return
    }
    // 相对路径 spec：锚定目录必须是用户明确选择的结果，绝不默认 Electron 目录。
    let anchorDir: string | null = null
    if (raw.action === 'add' && raw.spec !== null && isRelativeSpec(raw.spec)) {
      const anchorTitle = desktopLocaleZh()
        ? '选择本地插件的锚定目录'
        : 'Choose the anchor directory for the local plugin'
      const picked = await (new Promise<string | null>((resolve) => {
        void dialog.showOpenDialog({ properties: ['openDirectory'], title: anchorTitle }).then(
          (result) => {
            resolve(result.canceled ? null : result.filePaths[0] ?? null)
          },
          () => {
            resolve(null)
          },
        )
      }))
      if (picked === null) return
      anchorDir = picked
    }
    const request: PluginOperationRequest = { action: raw.action, profile: raw.profile, spec: raw.spec, anchorDir }
    const invalid = validatePluginRequest(request)
    if (invalid !== null) {
      reportFailure(new Error(invalid))
      return
    }
    // 本地路径 spec 的 pre-check：pnpm 对不存在的目录只 WARN 并写 link
    // 依赖（exit 0），"目录真实存在且是目录"必须由 desktop 在操作前证明。
    const localError = validateLocalSpecTarget(request, {
      exists: path => existsSync(path),
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      },
    })
    if (localError !== null) {
      reportFailure(new Error(localError))
      return
    }
    const targetError = validatePluginTarget(request.profile, controlState.discovery)
    if (targetError !== null) {
      reportFailure(new Error(targetError))
      return
    }
    // 单事务规则（P6 6.7）：同 Home/Profile 已有 pending unverified 事务时
    // 禁止新的写操作；用户可先重启验证、或放弃恢复。
    const blocked = blockedByPendingTransaction(request.profile)
    if (blocked !== null) {
      reportFailure(new Error(blocked))
      return
    }
    if (!await confirmPluginOperation(request)) return
    if (quitting || !sameHarnessSelection(launcher.read().active, requestedSelection) || migration.isRunning()) {
      throw new Error(desktopLocaleZh() ? '操作目标已改变，插件操作已取消，请重新选择。' : 'The target changed. The plugin operation was cancelled; select it again.')
    }

    // P6-F 快照：确认之后、broker 之前，只对三个白名单文件做
    // byte-identical 快照 + hash；文件不存在记录 absent，不伪造空文件。
    // 快照失败 = 没有恢复承诺：fail loud 拒绝执行（绝不无保护地写）。
    const dshHome = resolveHarnessHome(launcher.read().active.home, userDataDir)
    const txId = randomUUID()
    try {
      const profileDir = join(dshHome, 'profiles', request.profile)
      const facts = readWhitelistFacts(profileDir)
      mkdirSync(recoverySnapshotDir(txId), { recursive: true })
      writeWhitelistSnapshot(profileDir, facts, recoverySnapshotDir(txId))
      recoveryJournal = {
        schemaVersion: 1,
        txId,
        homeKind: launcher.read().active.home.kind,
        homePath: dshHome,
        profile: request.profile,
        operation: request.action,
        spec: request.spec,
        startedAt: new Date().toISOString(),
        preFacts: facts,
        postHashes: null,
        state: 'running',
        failure: null,
        updatedAt: new Date().toISOString(),
        autoRecoveredOnce: false,
      }
      // 落盘前的最后一次核对，位置刻意贴着启动 pnpm 那一刻：读事实与复制
      // 快照之间、复制与真正开始改动之间，都存在别的程序动这些文件的窗口。
      // 尤其是"本来不存在"的那一条——中间冒出来的文件如果被记成本次事务的
      // 产物，将来恢复会把它删掉，而它根本不是我们造的。
      const beforeMutation = readWhitelistFacts(profileDir)
      const driftedBeforeStart = detectDrift(hashesOfFacts(facts), beforeMutation)
      if (driftedBeforeStart.length > 0) {
        throw new Error(
          `准备期间这些文件发生了变化：${driftedBeforeStart.join('、')}；操作未执行`,
        )
      }
      if (writeRecoveryJournal()) {
        recoveryJournalWriteFailures = 0
      } else {
        // 恢复记录没落盘 = 这次操作没有退路。默认不许开始；用户在两次拦截
        // 之后仍坚持的话，明确告知代价后按无保护模式继续。
        const proceedUnprotected = await confirmWithoutRecoveryProtection(recoveryJournalError)
        recoveryJournal = null
        try {
          rmSync(recoverySnapshotDir(txId), { recursive: true, force: true })
        } catch {
          // 孤儿快照无害。
        }
        if (!proceedUnprotected) return
      }
    } catch (error) {
      // 快照/journal 写失败：清理半成品并拒绝操作（没有恢复承诺就不动磁盘）。
      recoveryJournal = null
      try {
        rmSync(recoverySnapshotDir(txId), { recursive: true, force: true })
      } catch {
        // 半成品快照清理失败无害。
      }
      reportFailure(new Error(`插件操作前的恢复快照失败（操作未执行）：${redactSecrets(String(error instanceof Error ? error.message : error))}`))
      return
    }

    const beforeProfile = findDiscoveredProfile(request.profile)
    const before: PluginSnapshot = beforeProfile === null
      ? { dependencies: {}, bundles: [], staticStatus: 'candidate' }
      : readPluginSnapshot(beforeProfile)

    pluginOperationView = {
      action: request.action,
      profile: request.profile,
      spec: request.spec,
      step: 'running',
      output: [],
      exitCode: null,
      postCheck: null,
      message: null,
    }
    broadcast()
    // plugin 子命令自带 --profile requiredOption，官方 grammar 拒绝父级
    // --profile/--host/--port——必须用 resolveDshCommand（只注入 DSH_HOME、
    // args 原样追加），绝不能用 resolveDshLaunch 的启动参数形态。
    const launch = resolveDshCommand({
      packaged,
      root,
      dshHome,
      args: buildPluginOperationArgs(request),
      ...packaged ? {
        resourcesPath: process.resourcesPath,
        packagedCwd: app.getPath('home'),
      } : {},
    })
    // 官方 plugin.ts 内部 spawn pnpm 走 PATH：prepend 应用私有 shim 目录
    // （pnpm.cmd 转发私有 Runtime），绝不依赖系统 pnpm、绝不改系统 PATH。
    // dsh.cmd wrapper 的默认 Profile 必须始终是 launcher active——用 target
    // profile 会把开着终端里的 bare dsh 默认悄悄改掉。
    const shimDir = ensureTerminalShims(launcher.read().active.profile)
    const shimPath = `${shimDir}${delimiter}${process.env.PATH ?? ''}`
    const op = runDesktopCommand({
      slot: 'maintenance',
      zh: desktopLocaleZh(),
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      env: withPath(launch.env, shimPath),
      onOutput: (_stream, text) => {
        appendPluginOutput(text)
        broadcast()
      },
      onExit: (result) => {
        void settlePluginOperation(request, before, result.exitCode).catch(reportFailure)
      },
    })
    pluginOperationHandle = op
    if (!op.running()) {
      // spawn 同步失败（error 事件已结算）：onExit 已处理收尾。
      pluginOperationHandle = undefined
    }
  }

  /** 结算一次插件操作：exit 0 → post-check → handoff；其余明确失败/取消。 */
  const settlePluginOperation = async (
    request: PluginOperationRequest,
    before: PluginSnapshot,
    exitCode: number | null,
  ): Promise<void> => {
    pluginOperationHandle = undefined
    if (pluginOperationView === null) return
    const cancelled = pluginOperationView.step === 'cancelled'
    if (cancelled) {
      // 取消时 pnpm 可能已改了一半磁盘（node_modules 写了、manifest 未
      // reconcile）：刷新事实让 inventory 反映真实磁盘状态，绝不展示旧快照。
      // 事务与快照保留：这一刻磁盘可能正处在半改状态，快照是唯一的退路。
      keepRecoveryForManualHandling({ kind: 'cancelled' })
      await refreshPluginFacts()
      broadcast()
      return
    }
    if (exitCode !== 0) {
      pluginOperationView = {
        ...pluginOperationView,
        step: 'failed',
        exitCode,
        postCheck: null,
        message: exitCode === null
          ? '无法启动 dsh plugin（请查看诊断日志）'
          : `dsh plugin 以退出码 ${String(exitCode)} 结束；目标 Profile 与 launcher selection 未改变`,
      }
      // 同取消：非零退出同样可能留下半改的 manifest / lock，保留退路。
      keepRecoveryForManualHandling(exitCode === null ? { kind: 'spawn-failed' } : { kind: 'exit-code', code: exitCode })
      await refreshPluginFacts()
      broadcast()
      return
    }
    // exit 0 才进入 post-check：重读磁盘事实，绝不信任内存旧快照。
    pluginOperationView = { ...pluginOperationView, step: 'post-check' }
    broadcast()
    await refreshPluginFacts()
    const afterProfile = findDiscoveredProfile(request.profile)
    const after: PluginSnapshot = afterProfile === null
      ? { dependencies: {}, bundles: [], staticStatus: 'malformed' }
      : readPluginSnapshot(afterProfile)
    const postCheck = verifyPluginPostCheck(before, after, request)
    pluginOperationView = {
      ...pluginOperationView,
      step: postCheck.ok ? 'done' : 'failed',
      exitCode,
      postCheck,
      message: postCheck.ok ? null : '操作已退出 0，但验证与磁盘事实不符',
    }
    if (postCheck.ok && recoveryJournal !== null && recoveryJournal.state === 'running') {
      // post-check 成功：记录 post-operation hash，journal → pending-verification。
      // 下一代 Host/Client 健康后才会 verified（见 settlePluginRecovery）。
      // 读不到就不记：journal 停在 running，下一次 boot 结算会按"缺少
      // post hash、无法证明归属"走人工恢复——宁可少一条证据，绝不记假的。
      const postHashes: Record<string, string | null> = {}
      let postHashesComplete = true
      try {
        for (const [name, fact] of Object.entries(readWhitelistFacts(join(recoveryJournal.homePath, 'profiles', recoveryJournal.profile)))) {
          postHashes[name] = fact.sha256
        }
      } catch (error) {
        postHashesComplete = false
        console.error(`[deepseekgui] post-operation hash 读取失败，journal 保持 running: ${redactSecrets(String(error instanceof Error ? error.message : error))}`)
      }
      // 只有读全了才升 pending-verification。读不到就停在 running——
      // handoff 提示照常给（操作本身已经成功，用户仍需重启），少的只是
      // 那条恢复证据。绝不在这里 return：那会连"需要重启 Harness"一起吞掉。
      if (postHashesComplete) {
        recoveryJournal = {
          ...recoveryJournal,
          postHashes,
          state: 'pending-verification',
          updatedAt: new Date().toISOString(),
        }
        writeRecoveryJournal()
      }
    } else {
      // post-check 失败：磁盘事实与预期不符——正是最需要留下退路的情形。
      keepRecoveryForManualHandling({ kind: 'post-check' })
    }
    if (shouldShowHandoff(exitCode, postCheck)) pluginHandoffPending = true
    broadcast()
  }

  /** 取消当前插件操作：broker cancel 杀完整 child tree，等待结算。 */
  const cancelPluginOperation = (): void => {
    if (pluginOperationView === null || pluginOperationView.step !== 'running') return
    pluginOperationView = {
      ...pluginOperationView,
      step: 'cancelled',
      // 诚实文案：launcher selection 未变，但目标 Profile 可能停在 pnpm 的
      // 中间状态（node_modules 已写、manifest 未 reconcile），刷新可见真实事实。
      message: dictText(moduleDict(), 'msg.plugin-op-cancelled'),
    }
    broadcast()
    if (pluginOperationHandle !== undefined) void pluginOperationHandle.cancel().catch((error: unknown) => {
      if (pluginOperationView !== null) pluginOperationView = {
        ...pluginOperationView, step: 'failed', message: redactSecrets(String(error)),
      }
      reportFailure(error)
      broadcast()
    })
  }

  /** 操作完成后刷新 discovery/inventory（零写入，官方 inspection）。 */
  const refreshPluginFacts = async (): Promise<void> => {
    const state = launcher.read()
    try {
      controlState.discovery = await discover(resolveHarnessHome(state.active.home, userDataDir))
      controlState.discoveryError = null
    } catch (error) {
      controlState.discovery = null
      controlState.discoveryError = redactSecrets(error instanceof Error ? error.message : String(error))
    }
  }

  // ---- Permission 执行面（Harness 是唯一权限事实源；实现在 permission-control） ----

  const permissions = createPermissionControl({
    rpc,
    showMessageBox: request => dialog.showMessageBox({ ...request, buttons: [...request.buttons] }),
    zh: desktopLocaleZh,
    home: () => {
      const state = launcher.read()
      return {
        kind: state.active.home.kind === 'managed' ? 'managed' : 'existing',
        path: resolveHarnessHome(state.active.home, userDataDir),
        profile: state.active.profile,
      }
    },
    broadcast,
  })

  // ---- Update service 执行面（provider/downloader/verifier/handoff） ----

  /**
   * 组装 Diagnostics Center 面板事实（allowlist，现场计算绝不缓存）。
   * facts 只是"同一次调用里已经读过的同一批事实"的传递通道——广播路径
   * 一次 buildModel 里读一次就够，绝不为此建第二份状态或缓存跨调用。
   * 不传则自己现读（面板复制/诊断包导出等独立入口）。
   * @param facts - 调用方已读到的 launcher state 与 feed URL。
   */
  const buildDiagnosticsView = (
    facts?: { state: LauncherStateV1; feedUrl: string | null },
  ): DiagnosticsView => {
    const state = facts?.state ?? launcher.read()
    const status = harness.status()
    const harnessStatusText = status.phase === 'running' || status.phase === 'starting'
      || status.phase === 'switching' || status.phase === 'recovering'
      ? `${status.phase} · ${status.selection.profile}`
      : status.phase
    const feedUrl = facts === undefined ? readUpdateFeed(userDataDir) : facts.feedUrl
    return {
      buildInfo: buildInfoLines({
        version: versionInfo,
        homeKind: state.active.home.kind,
        profile: state.active.profile,
        harnessStatus: harnessStatusText,
        logPath: service.logPath ?? null,
        updateChannel: feedUrl ?? 'unconfigured',
        lastUpdate: readInstallStampText(userDataDir, versionInfo.appVersion),
        maskPath: maskUserHome,
      }),
      homeDisplay: maskUserHome(resolveHarnessHome(state.active.home, userDataDir)),
      logPath: service.logPath ?? null,
      lastExport: lastDiagnosticsExport,
      uncleanExit,
    }
  }

  // ---- Update service 执行面（接线 update-runner 服务层；main 只做接线） ----

  /** main 侧的 runner deps：工厂 + 真实 https 与真实 installer spawn。 */
  const updateRunnerDeps: UpdateRunnerDeps = createUpdateRunnerDeps(
    https.get.bind(https),
    async (path) => {
      // 同上：spawn 失败只走 error 事件，once() 会把它变成一次拒绝。
      await once(spawn(path, [], { detached: true, stdio: 'ignore' }), 'spawn')
    },
  )

  const updates = createUpdateControl({
    runner: updateRunnerDeps,
    autoDownload: initialAutoDownload,
    userDataDir,
    appVersion: versionInfo.appVersion,
    readFeed: () => readUpdateFeed(userDataDir),
    text: (key, vars) => dictText(moduleDict(), key, vars),
    zh: desktopLocaleZh,
    showBalloon: (title, content) => {
      if (tray === undefined) return
      tray.displayBalloon({ iconType: 'info', title, content })
    },
    dshHome: () => resolveHarnessHome(launcher.read().active.home, userDataDir),
    redact: redactSecrets,
    broadcast: () => { broadcast() },
  })

  /**
   * installer handoff：确认 → orderly stop → spawn 已验证 installer → 退出。
   *
   * 留在入口而不是 update-control：它以 proceedQuit 收尾——四个退出入口
   * 共享的那条唯一有序清理路径，只把最后一步换成 app.exit(0)。
   */
  let installationPending = false
  const performInstallUpdate = async (): Promise<void> => {
    const recheck = await updates.recheckInstaller()
    if (!recheck.ok) {
      if (recheck.reason === 'mismatch') {
        // 落盘记录恢复的文件可能在会话间被改动，绝不执行与记录不符的安装包。
        const failed = stringsFor(localeOf())
        void dialog.showMessageBox({
          type: 'error',
          noLink: true,
          buttons: [dictText(failed, 'dialog.ok')],
          message: dictText(failed, 'dialog.install-verify-failed.title'),
          detail: dictText(failed, 'dialog.install-verify-failed.detail'),
        }).catch(() => undefined)
      }
      return
    }
    const file = recheck.file
    const dict = stringsFor(localeOf())
    // Linux 只做与当前 AppImage 发行事实相符的提示交接——绝不调用 Windows
    // 安装器。已校验的文件交给用户手动替换。
    if (process.platform !== 'win32') {
      shell.showItemInFolder(file.path)
      updates.noteMessage(dictText(dict, 'msg.update-linux-manual'))
      broadcast()
      return
    }
    // 运行中的任务必须先让用户看见：安装会停掉 Harness，正在执行的工作会
    // 被中断，绝不在后台强退。
    const runningCount = await queryRunningSessionCount(rpc)
    const choice = await dialog.showMessageBox({
      type: 'info',
      noLink: true,
      buttons: [dictText(dict, 'dialog.install-confirm.button'), dictText(dict, 'dialog.cancel')],
      defaultId: 0,
      cancelId: 1,
      message: dictText(dict, 'dialog.install-confirm.title'),
      detail: installConfirmDetail(runningCount, dict, file.version),
    })
    if (choice.response !== 0) {
      updates.noteInstallCancelled()
      broadcast()
      return
    }
    const confirmed = await updates.recheckInstaller()
    if (!confirmed.ok || confirmed.file !== file || quitting) {
      updates.noteMessage(dictText(dict, 'msg.update-install-state-changed'))
      broadcast()
      return
    }
    // 先 spawn installer（once('spawn') 确认成功）再停止一切——spawn 失败时
    // 当前应用保持可用，不删除当前安装、不伪造成功。
    const outcome = await runUpdateHandoff(updateRunnerDeps, file.path)
    if (outcome === 'spawn-failed') {
      void dialog.showMessageBox({
        type: 'error',
        noLink: true,
        buttons: [dictText(dict, 'dialog.ok')],
        message: dictText(dict, 'dialog.install-spawn-failed.title'),
        detail: dictText(dict, 'dialog.install-spawn-failed.detail'),
      }).catch(() => undefined)
      broadcast()
      return
    }
    // 安装程序已确认启动：走与 Quit 完全相同的 orderly cleanup，只把最后
    // 一步换成 app.exit(0)（不再经 quit 事件链）。
    await proceedQuit(() => { app.exit(0) })
  }

  // ---- Diagnostics 执行面 ----
  const installUpdate = async (): Promise<void> => {
    if (installationPending || quitting) return
    installationPending = true
    try { await performInstallUpdate() } finally { installationPending = false }
  }

  /** 打开日志所在文件夹（缺失则打开 userData）。 */
  const openLogFolder = (): void => {
    const target = service.logPath === undefined ? userDataDir : dirname(service.logPath)
    void shell.openPath(target)
  }


  /** 导出 Diagnostics Bundle：本地目录 + manifest + redacted 日志副本（含轮转历史）+ build-info。 */
  const exportDiagnostics = (): void => {
    try {
      const home = app.getPath('home')
      // 日志副本（current + 全部轮转历史）先 redaction 再交给纯函数组装
      // （组装函数负责 allowlist 过滤与正文归一化——写盘的每个字节都过
      // <USER_HOME> 归一化，不只是 manifest 元数据）。
      const logEntries = [
        ...collectLogFamily(service.logPath, redactSecrets),
        // 主进程自己的日志（#19）：桌面壳的失败在这里，不在服务日志里。
        ...collectLogFamily(join(userDataDir, MAIN_LOG_FILENAME), redactSecrets),
      ]
      // 空日志的 unavailable 占位由 assembleDiagnosticsBundle 统一生成。
      // Crashpad 本地 dump（总量有界）+ 上次退出状态一并进入 bundle。
      const crashEvidence = collectCrashDumpEvidence(userDataDir)
      const lastExit = uncleanExit === null ? 'unknown' : uncleanExit ? 'unclean (previous run did not end normally)' : 'clean (previous run ended normally)'
      const files = assembleDiagnosticsBundle({
        home,
        homeAliases: homeShortAliases,
        version: versionInfo,
        logEntries,
        buildInfo: buildInfoText(buildDiagnosticsView().buildInfo),
        exportedAt: new Date().toISOString(),
        extraFiles: crashEvidence.extraFiles,
        skippedEvidence: crashEvidence.skipped,
        lastExit,
      })
      const dir = writeDiagnosticsBundle(userDataDir, files, new Date())
      lastDiagnosticsExport = dir
      broadcast()
      const dict = stringsFor(localeOf())
      void dialog.showMessageBox({
        type: 'info',
        noLink: true,
        buttons: [dictText(dict, 'dialog.open-folder'), dictText(dict, 'dialog.ok')],
        defaultId: 1,
        cancelId: 1,
        message: dictText(dict, 'dialog.export-ok.title'),
        detail: dictText(dict, 'dialog.export-ok.detail', { dir }),
      }).then((choice) => {
        if (choice.response === 0) void shell.openPath(dir)
      }, () => undefined)
    } catch (error) {
      // 导出失败：明确反馈给用户，绝不静默穿过 dispatcher；原日志与
      // 用户数据一律不动。
      lastDiagnosticsExport = null
      broadcast()
      const dict = stringsFor(localeOf())
      void dialog.showMessageBox({
        type: 'error',
        noLink: true,
        buttons: [dictText(dict, 'dialog.ok')],
        message: dictText(dict, 'dialog.export-failed.title'),
        detail: redactSecrets(String(error instanceof Error ? error.message : error)),
      }).catch(() => undefined)
    }
  }

  // Plugin Mutation Recovery journal：在首次 buildModel 之前加载（面板视图
  // 消费它）；缺失/损坏都有明确语义，绝不挡启动——恢复链在 boot 结算时消费。
  loadRecoveryJournal()

  // ---- Feedback 执行面（P7-A~E）：诊断收集 → AI 排查 / 降级 → issue 组装 ----

  /** 当前 locale 的文案字典（与 buildModel 同一判据）。 */
  const localeOf = (): 'zh' | 'en' =>
    desktopLocaleZh() ? 'zh' : 'en'

  /** Windows 版本文本（About 事实同一来源；osVersion() 空时回退 release）。 */
  const windowsVersionText = osVersion() !== '' ? osVersion() : `Windows ${release()}`

  /**
   * 进程内收集反馈诊断包：复用官方唯一事实（launcher/controller/插件
   * inventory/journal），日志只取尾部 N 行且逐行先过凭据脱敏；组装函数
   * 再过用户上下文脱敏（用户名段/邮箱/token/密钥赋值）。写进面板的第一
   * 个字节就是脱敏后的（P7-C 规则脱敏不可跳过）。
   * @returns 脱敏后的诊断文本。
   */
  const collectFeedbackDiagnostics = (): string => {
    const state = launcher.read()
    const status = harness.status()
    const harnessStatusText = status.phase === 'running' || status.phase === 'starting'
      || status.phase === 'switching' || status.phase === 'recovering'
      ? `${status.phase} · ${status.selection.profile}`
      : status.phase
    // 已安装插件（仅名称 + spec，来自唯一 inventory 事实）。
    const plugins: { name: string; spec: string }[] = []
    for (const profile of buildPluginManagerView().profiles) {
      for (const dep of profile.inventory.dependencies) {
        plugins.push({ name: dep.name, spec: dep.spec })
      }
    }
    // 日志尾部：读失败如实为空（日志本身缺失是诊断目标之一）。
    const logTail: string[] = []
    for (const path of [service.logPath, join(userDataDir, MAIN_LOG_FILENAME)]) {
      if (path === undefined) continue
      try {
        const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => line !== '')
        logTail.push(...lines.slice(-FEEDBACK_LOG_TAIL_LINES).map(line => redactSecrets(line)))
      } catch {
        // 读不到日志：摘要如实为空，不中断面板。
      }
    }
    const permission = permissions.view()
    return buildFeedbackDiagnostics({
      version: versionInfo,
      windowsVersion: windowsVersionText,
      homeKind: state.active.home.kind,
      profile: state.active.profile,
      permissionLabel: permission.mode === 'unavailable' ? null : permission.mode,
      plugins,
      lastExitUnclean: uncleanExit,
      recoveryJournalState: recoveryJournal === null ? null : recoveryJournal.state,
      logTail,
      harnessStatus: harnessStatusText,
      redact: { home: app.getPath('home'), hostname: hostname() },
    })
  }

  /** 排查会话的总预算：超过就降级成静态模板，绝不让面板一直转。 */
  const FEEDBACK_TRIAGE_TIMEOUT_MS = 60_000
  /** 轮询最新回复的间隔。 */
  const FEEDBACK_TRIAGE_POLL_MS = 1_500

  /**
   * 发送用户问题给 AI 排查（#15，2026-09-11 人工测试后由莉莉丝定"真做"）。
   *
   * B5-P1 起这条路一直是无条件降级：当时读回复依赖已退役的 history 轮询，
   * 注释写着"等官方通道恢复再接回"，后来 session/create 与 session/prompt
   * 接通了，却没人回头接这一段。现在读回复走我们自己的 workbenchInspector
   * （它在 Harness 里，直接读会话日志），不碰 follow/WS 流式通道。
   *
   * 排查会话是隐藏的：cwd 落在 userData 下一个专用空目录（沙箱可写范围里
   * 什么都没有），起名 `[反馈排查]`，读到回复后立即归档，不留在列表里。
   * 任何一步失败都降级成静态模板，并把真实原因摆在面板上。
   */
  const sendFeedback = (text: string, diagnostics: string): void => {
    if (feedbackView.phase === 'sending' || feedbackGatewayBusy) return
    feedbackUserText = text
    // 面板里的编辑稿生效：用户可见可编辑的诊断包是发给 AI/issue 的那份。
    feedbackView.diagnostics = diagnostics
    feedbackView.notice = null
    feedbackView.reply = null
    feedbackView.degradedReason = null
    feedbackView.issueTitle = issueTitle(null, text, desktopLocaleZh())
    const zh = desktopLocaleZh()
    const api = harnessApi
    const degrade = (reason: string): void => {
      feedbackView.phase = 'degraded'
      feedbackView.degradedReason = redactSecrets(reason)
      broadcast()
    }
    if (api === undefined || harness.status().phase !== 'running') {
      degrade(zh ? 'Harness 未运行或正在恢复中' : 'The Harness is not running or is recovering')
      return
    }
    feedbackView.phase = 'sending'
    broadcast()
    const started = Date.now()
    void (async () => {
      const cwd = join(userDataDir, 'feedback-triage')
      mkdirSync(cwd, { recursive: true })
      const { sessionId } = await api.sessionCreate({ cwd })
      try {
      // 起名先于提问：列表里哪怕闪现一秒也要能认出它是什么。
        await api.sessionRename(sessionId, zh ? '[反馈排查] DeepSeekGUI' : '[Feedback triage] DeepSeekGUI').catch(() => undefined)
        await api.sessionPrompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: feedbackTriagePrompt(text, diagnostics, zh) }] })
        let reply: string | null = null
        while (Date.now() - started < FEEDBACK_TRIAGE_TIMEOUT_MS) {
          await delay(FEEDBACK_TRIAGE_POLL_MS)
          const latest = await api.workbenchLastReply(sessionId)
          if (latest.complete && latest.text !== null) {
            reply = latest.text
            break
          }
        }
        // 排查完的隐藏会话不留在列表里；归档失败不影响结果。
        if (reply === null) throw new Error(zh ? `AI 在 ${String(FEEDBACK_TRIAGE_TIMEOUT_MS / 1000)} 秒内没有给出完整回复` : `The AI did not finish a reply within ${String(FEEDBACK_TRIAGE_TIMEOUT_MS / 1000)}s`)
        // 面板可能已经换了话题（用户又点了一次发送）：只有还是这一次才落结果。
        if (feedbackUserText !== text || feedbackView.phase !== 'sending') return
        feedbackView.phase = 'replied'
        feedbackView.reply = reply
        feedbackView.issueTitle = issueTitle(reply, text, zh)
        broadcast()
      } finally {
        await api.sessionArchive(sessionId).catch(() => undefined)
      }
    })().catch((error: unknown) => {
      if (feedbackUserText !== text || feedbackView.phase !== 'sending') return
      degrade(error instanceof Error ? error.message : String(error))
    })
  }

  /** 当前反馈视图对应的 issue 正文：复制和网关直传两条出口用的是同一份事实。 */
  const currentIssueBody = (): string => {
    const state = launcher.read()
    return buildIssueBody({
      zh: desktopLocaleZh(),
      appVersion: versionInfo.appVersion,
      dshVersion: versionInfo.embeddedDshVersion,
      windowsVersion: windowsVersionText,
      homeKind: state.active.home.kind,
      userText: feedbackUserText,
      reply: feedbackView.phase === 'replied' ? feedbackView.reply : null,
      diagnostics: feedbackView.diagnostics,
    })
  }

  /** 复制 issue 正文 + 打开 GitHub issue 页（零后端零 Token；正文走剪贴板）。 */
  const feedbackCopyOpen = (): void => {
    if (feedbackView.phase !== 'replied' && feedbackView.phase !== 'degraded') return
    const dict = stringsFor(localeOf())
    const body = currentIssueBody()
    try {
      clipboard.writeText(body)
      // 标题+正文全走 URL 预填（P8-D30 收尾）：用户打开 GitHub 只剩点
      // Create。剪贴板仍然复制完整正文——URL 超长截断时的兜底。
      void shell.openExternal(githubNewIssueUrl(feedbackView.issueTitle, body, desktopLocaleZh()))
      feedbackView.notice = dict['feedback.notice.copied'] ?? 'feedback.notice.copied'
    } catch (error) {
      feedbackView.notice = `${dict['feedback.notice.failed'] ?? 'feedback.notice.failed'}${redactSecrets(String(error instanceof Error ? error.message : error))}`
    }
    broadcast()
  }

  /**
   * 无 GitHub 通道（P8-D32）：网关已配置先直传（POST，token 只活在网关侧），
   * 未配置或直传失败降级为导出反馈文件并打开所在文件夹。两条路都不需要
   * GitHub 账号，也不需要能访问 GitHub 的网络。
   */
  let feedbackGatewayBusy = false
  const feedbackSubmitGateway = (): void => {
    if (feedbackView.phase !== 'replied' && feedbackView.phase !== 'degraded') return
    if (feedbackGatewayBusy) return
    const dict = stringsFor(localeOf())
    const state = launcher.read()
    const body = currentIssueBody()
    const exportFeedbackFile = (): void => {
      const dir = join(userDataDir, 'feedback-exports')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, feedbackExportFileName(new Date()))
      writeFileSync(path, body)
      shell.showItemInFolder(path)
    }
    const gatewayUrl = resolveFeedbackGatewayUrl(process.env)
    if (gatewayUrl === '') {
      try {
        exportFeedbackFile()
        feedbackView.notice = dict['feedback.gateway.exported'] ?? 'feedback.gateway.exported'
      } catch (error) {
        feedbackView.notice = `${dict['feedback.gateway.export-failed'] ?? 'feedback.gateway.export-failed'}${redactSecrets(String(error instanceof Error ? error.message : error))}`
      }
      broadcast()
      return
    }
    feedbackGatewayBusy = true
    feedbackView.notice = dict['feedback.gateway.sending'] ?? 'feedback.gateway.sending'
    broadcast()
    void (async () => {
      const result = await submitFeedbackToGateway({
        url: gatewayUrl,
        payload: {
          schemaVersion: 1,
          kind: 'bug-report',
          title: feedbackView.issueTitle,
          body,
          appVersion: versionInfo.appVersion,
          dshVersion: versionInfo.embeddedDshVersion,
          windowsVersion: windowsVersionText,
          homeKind: state.active.home.kind,
          locale: localeOf(),
          submittedAt: new Date().toISOString(),
        },
        fetchImpl: fetch,
      })
      if (result.ok) {
        feedbackView.notice = result.issueUrl === null
          ? dict['feedback.gateway.sent'] ?? 'feedback.gateway.sent'
          : `${dict['feedback.gateway.sent-url'] ?? 'feedback.gateway.sent-url'}${result.issueUrl}`
      } else {
        // 直传失败（网络不可达/网关故障）：降级导出，反馈绝不丢。
        try {
          exportFeedbackFile()
          feedbackView.notice = dict['feedback.gateway.failed-exported'] ?? 'feedback.gateway.failed-exported'
        } catch (error) {
          feedbackView.notice = `${dict['feedback.gateway.export-failed'] ?? 'feedback.gateway.export-failed'}${redactSecrets(String(error instanceof Error ? error.message : error))}`
        }
      }
      feedbackGatewayBusy = false
      broadcast()
    })()
  }

  /** 会打断运行中会话的动作的确认（switch/restart/换 Home/视图切换共用）。 */
  const confirmDisruptive: ControlDispatchDeps['confirmDisruptive'] = async (action) => {
    // 文案只说真话：会中断什么、丢什么、不动什么。绝不用"可能会有影响"
    // 之类的模糊说法糊过去——用户要凭这句话决定敢不敢点。
    const dict = stringsFor(localeOf())
    const active = launcher.read().active.profile
    const restartLike = action.kind === 'restart-harness'
    const message = action.kind === 'switch-profile'
      ? dictText(dict, 'dialog.confirm.switch.title', { profile: JSON.stringify(action.profile) })
      : action.kind === 'use-managed-home'
        ? dictText(dict, 'dialog.confirm.use-managed.title')
        : action.kind === 'choose-existing-home'
          ? dictText(dict, 'dialog.confirm.choose-existing.title', { profile: JSON.stringify(action.profile) })
          : dictText(dict, 'dialog.confirm.restart.title')
    const choice = await dialog.showMessageBox({
      type: 'warning',
      noLink: true,
      buttons: [dictText(dict, restartLike ? 'dialog.confirm.restart' : 'dialog.confirm.switch-restart'), dictText(dict, 'dialog.cancel')],
      defaultId: 1,
      cancelId: 1,
      message,
      detail: [
        action.kind === 'switch-profile'
          ? dictText(dict, 'dialog.confirm.switch.detail', { profile: JSON.stringify(active) })
          : action.kind === 'use-managed-home'
            ? dictText(dict, 'dialog.confirm.use-managed.detail')
            : action.kind === 'choose-existing-home'
              ? dictText(dict, 'dialog.confirm.choose-existing.detail')
              : dictText(dict, 'dialog.confirm.restart.detail'),
        // 这句原本写的是「未保存的对话内容会丢失」——那是假话（P8-D27，DS 第 12
        // 扇窗走查抓获）。DSH 的会话是落盘持久化的（jsonl，官方 UI 的会话列表与
        // 续聊就靠它），被打断的只是进行中的这一轮，历史仍在磁盘上。
        //
        // 说假话的代价不是吓退一次，是**门铃从此没人信**：用户怕丢全部对话不敢
        // 切，切了发现什么都在，下回就直接点确认了。P7-F 的铁律「宁可说得弱，
        // 不可说得假」管的正是这种地方。
        //
        // 换 Home 的情形单独点名：会话不是没了，是留在原来那个 Home 里——不说
        // 清楚，用户在新 Home 的空列表前一样会以为丢了。
        dictText(dict, 'dialog.confirm.session-note'),
        action.kind === 'use-managed-home' || action.kind === 'choose-existing-home'
          ? dictText(dict, 'dialog.confirm.home-note')
          : dictText(dict, 'dialog.confirm.resume-note'),
        dictText(dict, 'dialog.confirm.files-note'),
      ].join('\n'),
    })
    return choice.response === 0
  }

  /**
   * Workbench ↔ Compatibility View 切换（B3-P2）：同一控制器 restart
   * 唯一路径，运行中先走现有 disrupt 确认（与重启同杀伤力）。内存态，
   * 不持久化——应用重开默认 Workbench。
   * @param target - 目标界面形态。
   */
  const switchViewMode = async (target: 'workbench' | 'compatibility'): Promise<void> => {
    if (workbenchViewMode === target) return
    // 与 restart-harness 同一条门铃：只在真的有东西会丢时问。
    if (harness.status().phase === 'running' && !await confirmDisruptive({ kind: 'restart-harness' })) return
    workbenchViewMode = target
    await harness.restart()
    broadcast()
  }

  const dispatch = createControlDispatcher({
    zh: desktopLocaleZh,
    controller: harness,
    readState: () => launcher.read(),
    resolveActiveHome: state => resolveHarnessHome(state.active.home, userDataDir),
    discover,
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    },
    // 接管用户自己的 Home 时，把它的 DSH 包版本与我们自带的差异如实记进
    // 事件文件。不弹窗、不阻拦：这是用户自己的目录，版本不同也常常照跑，
    // 为一个"可能"弹模态只会教人闭眼点掉。但一旦真的因为双副本崩了工具
    // 调用，报错本身（Cannot read properties of undefined）指不到这里，
    // 而 Profile 里的 DS 读得到这份记录，能直接把原因讲给用户听。
    recordRuntimeSkew: (homePath, profile) => {
      try {
        const skews = detectRuntimeVersionSkew(
          join(homePath, 'profiles', profile, 'node_modules'),
          join(process.resourcesPath, 'dsh', 'node_modules'),
        )
        const zhSkew = desktopLocaleZh()
        const body = describeRuntimeVersionSkew(skews, zhSkew)
        if (body !== null) {
          appendDesktopEvent(homePath, {
            at: formatStampLocal(new Date().toISOString()),
            title: zhSkew ? 'DSH 包版本与 DeepSeekGUI 自带的不一致' : 'DSH package versions differ from the ones DeepSeekGUI ships',
            sections: [[zhSkew ? '发生了什么' : 'What happened', body]],
          }, zhSkew)
        }
        // 第二件事，主题不同所以单独记一条：DeepSeekGUI 对 Existing Home 一向
        // 只读，唯一的例外在上游 credentials-local——它认出旧版 flat 布局
        // 会就地改写（值不变，只换外层结构）。承诺过不改，就该在改之前把
        // 这一次说清楚，而不是让用户事后发现自己的文件被动过。
        if (hasLegacyCredentialsLayout(homePath)) {
          appendDesktopEvent(homePath, {
            at: formatStampLocal(new Date().toISOString()),
            title: zhSkew ? '这个目录里的凭据文件会被改写一次' : 'The credentials file in this directory will be rewritten once',
            sections: [[zhSkew ? '发生了什么' : 'What happened', describeLegacyCredentialsLayout(zhSkew)]],
          }, zhSkew)
        }
      } catch {
        // 诊断记录失败绝不能连累切换本身：用户要的是换 Home，不是这条笔记。
      }
    },
    // 会打断运行中会话的动作的确认（switch/restart/换 Home 共用）：文案
    // 只说真话——会中断什么、丢什么、不动什么。绝不用"可能会有影响"
    // 之类的模糊说法糊过去——用户要凭这句话决定敢不敢点。
    confirmDisruptive,
    showRecoveryDialog: () => {
      const model = buildModel()
      if (model.recovery === null) return
      const dict = stringsFor(localeOf())
      const zh = localeOf() === 'zh'
      const colon = zh ? '：' : ': '
      const recovery = model.recovery
      dialog.showMessageBox({
        type: 'info',
        title: dictText(dict, 'dialog.recovery.title'),
        message: dictText(dict, 'dialog.recovery.title'),
        detail: [
          `${dict['recovery.stage'] ?? 'recovery.stage'}${colon}${recovery.stage}`,
          `${dict['recovery.message'] ?? 'recovery.message'}${colon}${recovery.message}`,
          ...recovery.failedTarget === null ? [] : [`${dict['recovery.failed-target'] ?? 'recovery.failed-target'}${colon}${recovery.failedTarget}`],
          `${dict['recovery.recovered-to'] ?? 'recovery.recovered-to'}${colon}${recovery.recoveredTo}`,
          `${dict['recovery.log'] ?? 'recovery.log'}${colon}${recovery.logPath ?? dictText(dict, 'recovery.no-log')}`,
        ].join('\n'),
      }).catch(() => undefined)
    },
    showAbout: () => {
      // About 对话框：内容由 about.ts 纯函数组装（四元组 + Home kind +
      // Profile + license + repository），输入面不含任何凭据/环境变量。
      const state = launcher.read()
      const detail = aboutDetailText({
        version: versionInfo,
        homeKind: state.active.home.kind,
        profile: state.active.profile,
        locale: desktopLocaleZh() ? 'zh' : 'en',
      })
      void dialog.showMessageBox({
        type: 'info',
        noLink: true,
        title: dictText(stringsFor(localeOf()), 'menu.about'),
        message: `DeepSeekGUI ${versionInfo.appVersion}`,
        detail,
      }).catch(() => undefined)
    },
    copyFullPath: () => {
      // Copy Full Path：完整路径只在专家详情里出现，复制经 main 的
      // clipboard（renderer 沙箱无剪贴板权限）；路径不发往网络或日志。
      const state = launcher.read()
      clipboard.writeText(resolveHarnessHome(state.active.home, userDataDir))
    },
    acknowledgeRecovery: () => {
      if (recoveryNotice === null) return
      const ui = uiStore?.read().state
      if (ui !== undefined) {
        try {
          uiStore?.write({ ...ui, acknowledgedRecoveryHash: recoveryNotice.ackKey })
        } catch (error) {
          // 确认落盘失败只记诊断：同一条提示可能再次出现，无害。
          console.error(`[deepseekgui] UI 状态写入失败: ${String(error instanceof Error ? error.message : error)}`)
        }
      }
      recoveryNotice = null
      broadcast()
    },
    showTerminal: (sessionId) => {
      // DSH Terminal：同一控制路径（Chrome/Tray 均经此出口）。Workbench 的
      // 桌面动作带当前会话 id，菜单/托盘入口不带（Profile/Home 回退）。
      return openDshTerminal(sessionId)
    },
    requestPluginOperation: (request) => {
      return requestPluginOperation(request)
    },
    cancelPluginOperation,
    restartForPluginHandoff: () => {
      // Restart Now：与 restart-harness 同一 controller.restart 唯一路径，
      // 绝不自动执行、绝不伪造已加载状态。
      pluginHandoffPending = false
      void runCommand({ type: 'restart-harness' }).catch(reportFailure)
    },
    ackPluginHandoff: () => {
      // Later：只关闭提示；loader composition 在下次重启才生效。
      pluginHandoffPending = false
      broadcast()
    },
    pluginRecoveryRestore: () => {
      return runRecoveryRestore()
    },
    pluginRecoveryAbandon: runRecoveryAbandon,
    pluginRecoveryOpenProfile: runRecoveryOpenProfile,
    checkForUpdates: () => {
      void updates.check(false)
    },
    updateDismiss: () => { updates.dismiss() },
    updateDownload: () => {
      // 下载前明确确认（施工单要求）：确认后 Cancel 不得继续下载。
      const pending = updates.pendingDownload()
      if (pending === null) return
      const dict = stringsFor(localeOf())
      void dialog.showMessageBox({
        type: 'info',
        noLink: true,
        buttons: [dictText(dict, 'dialog.download.button'), dictText(dict, 'dialog.cancel')],
        defaultId: 1,
        cancelId: 1,
        message: dictText(dict, 'dialog.download.title', { version: pending.version }),
        detail: dictText(dict, 'dialog.download.detail', { size: pending.sizeMb }),
      }).then((result) => {
        if (result.response === 0) void updates.download()
      }, () => undefined)
    },
    updateCancelDownload: () => { updates.cancelDownload() },
    updateInstall: () => {
      return installUpdate()
    },
    openLogFolder,
    exportDiagnostics,
    setPermissionMode: (mode) => {
      return permissions.switchMode(mode)
    },
    openFeedback: () => {
      // 打开面板：诊断包收集一次（脱敏在收集点完成），面板内容可编辑。
      const stamp = feedbackEnvironmentStamp()
      if (feedbackDiagnosticsStamp !== stamp) {
        feedbackView.diagnostics = collectFeedbackDiagnostics()
        feedbackDiagnosticsStamp = stamp
      }
      feedbackView.open = true
      feedbackView.notice = null
      broadcast()
      // Chrome 的反馈面板已随 P8-D39 移居官方设置页：open-feedback 现在
      // 只承担「收集脱敏诊断包 + 记录 open 事实」，不再向 Chrome 转发
      // 开面板通知（设置分区自己就是入口）。
    },
    closeFeedback: () => {
      feedbackView.open = false
      broadcast()
    },
    sendFeedback,
    feedbackCopyOpen,
    feedbackSubmitGateway,
    browserPaneToggle: () => {
      const win = mainWindow
      if (win === undefined || win.isDestroyed()) return
      // 地球/菜单开关（B3-11）：pane 不存在**或已死**时点击即（重）创建——
      // 只判 undefined 会让渲染进程崩过一次之后的空壳 view 被滑进来，用户
      // 得到一块黑面板且 UI 上没有任何恢复路径。ensureBrowserPane 自己认得
      // 「对象还在但 webContents 已死」这一态。
      ensureBrowserPane(win)
      animateBrowserPane(win, !browserPaneOpen)
      broadcast()
    },
    browserPaneHide: () => {
      const win = mainWindow
      if (win === undefined || win.isDestroyed() || !browserPaneOpen) return
      // 与用户手动收起同一语义：保活收起；AI 下一次打开新网址会再弹出。
      animateBrowserPane(win, false)
      broadcast()
    },
    // 视图切换（B3-P2）：Workbench ↔ Compatibility View，同一控制器
    // restart 唯一路径；运行中先走现有 disrupt 确认（与重启同杀伤力）。
    // 内存态，不持久化——应用重开默认 Workbench。
    openCompatibilityView: () => {
      return switchViewMode('compatibility')
    },
    openWorkbench: () => {
      return switchViewMode('workbench')
    },
    quit: () => {
      // 显式 Quit：真实提示 + orderly cleanup（见 requestQuit/proceedQuit）。
      void requestQuit()
    },
    holder: controlState,
    broadcast,
  })


  // ---- 窄 IPC：只接受 Chrome view 的调用，命令经 parseControlCommand 边界验证 ----

  /**
   * 触发 Harness boot 的控制命令：只有这些命令完成后才有"新一次 boot
   * 结算"的事实，settlePluginRecovery 只能挂在这条线上。普通命令（刷新、
   * 插件写操作等）不重启 Harness，把它们当结算点会把 pending/进行中的
   * 事务误 verified 或误清（验收实测：add 期间 settle 清掉了 running
   * journal；Restart Later 后任意命令会把 pending 事务误标 verified）。
   */
  const BOOT_COMMANDS: ReadonlySet<DesktopControlCommand['type']> = new Set([
    'switch-profile',
    'restart-harness',
    'use-managed-home',
  ])

  /**
   * B5-P7 记忆文件的本机管理（无状态）：只「打开/保存」两份扁平 memory.md
   * 之一，路径一律由 main 从权威事实推出——全局 = active DSH home 的
   * memory.md；项目 = 官方 session.list 解析会话 cwd 后的 memory.md。
   * 绝不接受调用方传来的任意路径，也不经 agent 权限门（全局文件用户经
   * 面板编辑、模型只读；项目文件模型经普通 fs 工具自行维护）。
   * @param command - 已验证的记忆命令。
   */
  const runMemoryCommand = async (
    command: Extract<DesktopControlCommand, { type: 'open-memory' | 'save-global-memory' | 'create-project-agents' }>,
  ): Promise<void> => {
    const home = resolveHarnessHome(launcher.read().active.home, userDataDir)
    const globalPath = join(home, 'memory.md')
    if (command.type === 'save-global-memory') {
      if (home !== command.home || readGlobalMemory(home) !== command.expected) {
        throw new Error(desktopLocaleZh() ? '记忆文件或 Harness 目录已改变，请重新打开全局记忆后再保存。' : 'The memory file or Harness home changed. Reopen global memory before saving.')
      }
      atomicWriteFile(globalPath, command.content, message => new Error(message))
      return
    }
    // D20：项目 AGENTS.md 只按用户按钮从随包模板生成一次；已有即原样保留。
    if (command.type === 'create-project-agents') {
      const cwd = await sessionCwdOf(command.sessionId, command.type)
      seedProjectAgents(cwd, localeOf(), seedTemplatesDir)
      return
    }
    // 记忆文件：在文件管理器里定位（用户看得见它在哪、用自己的编辑器改）；
    // AGENTS.md：直接用系统默认程序打开（按钮文案就是「打开 AGENTS.md」）。
    // 目标不存在时退回打开所在目录。
    const show = async (path: string, fallbackDir: string, editor: boolean): Promise<void> => {
      if (!existsSync(path)) {
        const error = await shell.openPath(fallbackDir)
        if (error !== '') throw new Error(error)
        return
      }
      if (!editor) { shell.showItemInFolder(path); return }
      const error = await shell.openPath(path)
      if (error !== '') throw new Error(error)
    }
    if (command.which === 'global' || command.which === 'global-agents') {
      // 全局两份文件在 Managed Home 首启已种；Existing Home 这里只补建
      // memory.md（空文件，模型只读），绝不替用户写 AGENTS.md。
      if (command.which === 'global' && !existsSync(globalPath)) writeFileSync(globalPath, '', 'utf8')
      await show(command.which === 'global' ? globalPath : join(home, 'AGENTS.md'), home, command.which === 'global-agents')
      return
    }
    if (command.sessionId === undefined) throw new Error('memory: project open requires a session')
    const cwd = await sessionCwdOf(command.sessionId, 'memory')
    // 项目记忆文件名 `<文件夹名>.memory.md`（D20；规则与 workbench-inspector
    // 的 projectMemoryFileName 相同，桌面宿主不依赖该包所以就地写）。
    if (command.which === 'project') {
      await show(join(cwd, `${basename(cwd) || 'project'}.memory.md`), cwd, false)
      return
    }
    await show(join(cwd, 'AGENTS.md'), cwd, true)
  }

  /** D20 随包模板目录：与 chrome/terminal 资产同一套 lib→src 相对路径。 */
  const seedTemplatesDir = join(MODULE_DIR, '..', 'src', 'templates')

  /**
   * D20 首启种子：Managed Home 缺 AGENTS.md / memory.md 时按当前语言种下；
   * 只写缺失的，Existing Home 一律不动。失败只记日志——种子缺席不影响运行。
   */
  const ensureManagedMemorySeed = (): void => {
    const state = launcher.read()
    if (state.active.home.kind !== 'managed') return
    try {
      const home = resolveHarnessHome(state.active.home, userDataDir)
      const result = seedManagedHome(home, localeOf(), seedTemplatesDir)
      if (result.agents === 'created' || result.memory === 'created') {
        console.log(`[deepseekgui] D20 seeded managed home files: AGENTS.md=${result.agents} memory.md=${result.memory}`)
      }
    } catch (error) {
      console.error(`[deepseekgui] D20 managed home seed failed: ${String(error instanceof Error ? error.message : error)}`)
    }
  }

  /** 会话 cwd（官方 session.list 权威解析）；Harness 未运行或会话无 cwd 时抛错。 */
  const sessionCwdOf = async (sessionId: string, what: string): Promise<string> => {
    if (harness.status().phase !== 'running' || harnessApi === undefined) {
      throw new Error(`${what}: harness is not running; cannot resolve the session working directory`)
    }
    const cwd = resolveSessionCwdById((await harnessApi.sessionList()).items, sessionId)
    if (cwd === null) throw new Error(`${what}: the session has no working directory`)
    // B6-3: name the missing folder instead of surfacing a raw shell error.
    if (!existsSync(cwd)) {
      throw new Error(dictText(stringsFor(localeOf()), 'error.workspace-missing', { path: cwd }))
    }
    return cwd
  }

  /**
   * D7 / D5-f / D6（莉莉丝 2026-09-06）：在系统文件管理器里打开整个工作区，
   * 或定位工作区内的一个路径。路径只从会话事实推出；reveal 的目标解析后
   * 必须仍在 cwd 之内，越界即拒绝（对话里任何像路径的文字都可能点到这里）。
   * @param command - 已验证的命令。
   */
  const runRevealCommand = async (
    command: Extract<DesktopControlCommand, { type: 'reveal-path' }>,
  ): Promise<void> => {
    const cwd = await sessionCwdOf(command.sessionId, command.type)
    const outcome = revealTargetOf(cwd, command.path)
    if (outcome.kind === 'missing') throw new Error(`reveal-path: the path does not exist: ${outcome.target}`)
    if (outcome.kind === 'outside') throw new Error('reveal-path: the path is outside the session workspace and its repository')
    if (statSync(outcome.target).isDirectory()) {
      const error = await shell.openPath(outcome.target)
      if (error !== '') throw new Error(error)
      return
    }
    shell.showItemInFolder(outcome.target)
  }

  /**
   * 命令统一出口：dispatch 失败统一报错，随后重算恢复通知并推送最新
   * 模型。恢复通知必须在这里算（而不是 controller 的 onStatusChanged）：
   * switchTo 的 store 写入发生在状态回调之后，命令完成后读到的才是
   * 已晋升的 active/LKG 事实。
   * @param command - 已验证的命令。
   */
  const runCommand = async (command: DesktopControlCommand): Promise<void> => {
    if (pluginOperationInFlight() && [
      'switch-profile', 'choose-existing-profile', 'use-managed-home', 'restart-harness',
      'open-compatibility-view', 'open-workbench', 'migrate-managed-home', 'update-install', 'plugin-recovery-restore',
    ].includes(command.type)) throw new Error(dictText(stringsFor(localeOf()), 'error.plugin-busy'))
    if (migration.isRunning() && [
      'switch-profile', 'choose-existing-home', 'choose-existing-profile', 'use-managed-home',
      'restart-harness', 'open-compatibility-view', 'open-workbench', 'plugin-op-request',
      'plugin-handoff-restart', 'plugin-recovery-restore', 'update-install',
    ].includes(command.type)) throw new Error(stringsFor(localeOf())['error.migration-busy'])
    // B5-P6：notify 是无状态的通知展示命令——不经过 dispatch（dispatch 只
    // 服务桌面状态命令），不结算恢复通知、不动模型、不广播（点击时的导航
    // 广播由 showNotify 自己触发）。
    if (command.type === 'notify') {
      showNotify(command)
      return
    }
    // B5-P7：记忆管理命令同样由 main 直办（需要 DSH home、shell 与官方
    // session.list），不经 dispatch。
    if (command.type === 'open-memory' || command.type === 'save-global-memory' || command.type === 'create-project-agents') {
      await runMemoryCommand(command).catch((error: unknown) => { reportFailure(error); throw error })
      broadcast()
      return
    }
    // B6-P5：完成或跳过首启引导。唯一完成事实原子写入 userData/first-run.json；
    // 失败照常抛回调用方，绝不伪造成功。
    if (command.type === 'first-run-dismiss') {
      firstRunState = markFirstRunCompleted(userDataDir, firstRunState ?? null)
      broadcast()
      return
    }
    // 莉莉丝 2026-09-10 人工验收：删掉一个归档会话的磁盘数据。上游没有这
    // 条通道，所以由 main 直办；归档集合里那个 id 的去留是宿主的账，由渲染
    // 侧删完之后走正规 RPC 收尾。任何一项删不掉都抛回调用方——用户点了删除
    // 却什么都没删掉，必须是一次可见的失败，不能静悄悄过去。
    //
    // 先让 Harness 忘掉它，再删文件（人工测试 #20/#21）：Harness 开机时列过
    // 这个会话，不通知它，列表里会留一个幽灵行——切一下设置标签就回来、
    // "恢复并打开"还能打开一个背后没有日志的会话，第一次写盘就 ENOENT。
    // 顺序是有意的：先忘再删，万一删失败了，最坏是重启后它重新出现；反过来
    // 先删再忘，忘失败了就是那个幽灵。
    if (command.type === 'session-delete') {
      if (harnessApi === undefined || harness.status().phase !== 'running') {
        throw new Error(desktopLocaleZh()
          ? 'Harness 未运行，无法删除会话：删除要先让 Harness 从列表里去掉它'
          : 'The Harness is not running, so the session cannot be deleted: the Harness must drop it from its list first')
      }
      const home = resolveHarnessHome(launcher.read().active.home, userDataDir)
      const signature = sign(null, Buffer.from(`${home}\0${command.sessionId}`), sessionDeletionKeys.privateKey).toString('base64')
      await harnessApi.sessionDelete(command.sessionId, signature)
      broadcast()
      return
    }
    // B6-P6：自动下载开关。单一 owner 是现有 UI state 文件；写失败回滚并
    // 明确报错，绝不假装已保存。关闭只影响将来的自动启动，不中断正在
    // 进行的下载（用户可显式取消）。
    if (command.type === 'update-toggle-auto-download') {
      const store = uiStore
      // app ready 之后恒有值；ready 之前的命令路径不存在（桥还没起来）。
      if (store === undefined) throw new Error('ui state store is not ready')
      const next = !updates.autoDownload()
      try {
        store.write({ ...store.read().state, autoDownloadUpdate: next })
      } catch (error) {
        reportFailure(error)
        throw error
      }
      updates.setAutoDownload(next)
      broadcast()
      return
    }
    // B6-P7：数据迁移与旧副本清理（全程代码执行，助手只解释不执行）。
    if (command.type === 'migrate-managed-home') {
      if (pluginOperationInFlight()) throw new Error(dictText(stringsFor(localeOf()), 'error.plugin-busy'))
      await migration.migrate().catch((error: unknown) => { reportFailure(error); throw error })
      return
    }
    if (command.type === 'migration-cleanup') {
      try {
        migration.cleanup()
      } catch (error: unknown) {
        reportFailure(error)
        throw error
      }
      return
    }
    // D6/D7：定位路径不弹错误对话框——对话里被点的文字未必真是路径，
    // 失败只回给调用方（桥返回错误，页面静默忽略）；打开工作区照常报错。
    if (command.type === 'reveal-path') {
      await runRevealCommand(command)
      return
    }
    try {
      await dispatch(command)
    } catch (error) {
      try { broadcast() } catch (refreshError) { console.error(redactSecrets(String(refreshError))) }
      throw error
    }
    if (command.type === 'choose-existing-profile' || command.type === 'use-managed-home') {
      followHarnessPreferences(resolveHarnessHome(launcher.read().active.home, userDataDir))
    }
    settleRecoveryNotice()
    // 插件事务结算只绑定 boot 型命令（restart/switch/use-managed-home）：
    // 命令完成时 boot 已结算，pending 事务在此 verified 或进入恢复链。
    if (BOOT_COMMANDS.has(command.type)) await settlePluginRecovery()
    broadcast()
  }

  const fromChrome = (sender: Electron.WebContents): boolean =>
    chromeView !== undefined && sender.id === chromeView.webContents.id

  ipcMain.handle('deepseekgui:get-control-model', (event) => {
    if (!fromChrome(event.sender)) throw new Error('拒绝：非 Desktop Chrome 来源')
    return buildModel()
  })
  ipcMain.handle('deepseekgui:run-control-command', async (event, raw: unknown) => {
    const command = parseControlCommand(raw)
    if (command === null) throw new Error('拒绝：未知或非法的控制命令')
    // 浮动反馈层已删（P8-D13 终章）：控制命令重新只认 Desktop Chrome 一个来源。
    if (!fromChrome(event.sender)) {
      throw new Error('拒绝：该来源无权执行此控制命令')
    }
    await runCommand(command).catch((error: unknown) => { reportFailure(error); throw error })
  })
  ipcMain.handle('deepseekgui:set-chrome-expanded', (event, expanded: unknown) => {
    if (!fromChrome(event.sender)) throw new Error('拒绝：非 Desktop Chrome 来源')
    chromeExpanded = expanded === true
    if (mainWindow !== undefined) layoutViews(mainWindow)
  })

  // ---- D39 控制桥：官方设置页里的 DeepSeekGUI 分区（settings-plugin）→ main ----
  //
  // compat view 刻意无 preload（安全边界，不破），设置插件跑在官方页面里,
  // 唯一能走的通道是本机回环 HTTP——与目录选择桥同一个模式：端口只绑
  // 127.0.0.1、凭证随进程一次性生成、经我们自己加载的页面 URL 下发。
  // 命令进的是与 Chrome 菜单**同一个** parseControlCommand + runCommand
  // 出口：没有第二事实源，也没有第二套权限判断。
  {
    const bridge = await startControlBridge({
      appOrigin: `http://${DEFAULT_HOST}:${APP_PORT}`,
      buildModel,
      runCommand,
      redact: redactSecrets,
      // pane 那条路由要摸 WebContentsView 句柄，所以留在入口。
      handlePaneRequest: async (body) => {
        const win = mainWindow
        if (win === undefined || win.isDestroyed()) return { status: 409, body: { error: 'no window' } }
        if (body.action === 'ensure') {
          const view = ensureBrowserPane(win)
          // 只保证 view 存在；弹不弹出由 `reveal` 决定（每次导航都发）。
          broadcastModel()
          // 必须等首个导航提交再回复：paneUrl 是插件在 CDP targets 里认领
          // 这块 view 的钥匙，导航未提交时 getURL() 是空串、CDP 那头还报
          // about:blank，认领当场扑空（首次调用随机失败）。返回**当前** URL
          // 而非固定 marker：断线重连时页面早已导航去了别处。
          await (browserPaneReady ?? Promise.resolve())
          if (view.webContents.isDestroyed()) return { status: 409, body: { error: 'pane destroyed' } }
          const paneUrl = view.webContents.getURL()
          return {
            status: 200,
            body: { ok: true, cdpPort: BROWSER_PANE_CDP_PORT, paneUrl: paneUrl === '' ? BROWSER_PANE_MARKER_URL : paneUrl },
          }
        }
        if (body.action === 'set-proxy' && typeof body.rules === 'string') {
          const view = ensureBrowserPane(win)
          try {
            // `<-loopback>` 必须显式给：Chromium 的隐式绕过规则让 localhost、
            // 127.0.0.0/8、[::1]、169.254/16、[fe80::]/10 不经代理直连，SSRF
            // 代理对这些地址形同虚设——外部页面一个 302 到 127.0.0.1:3080、或一张
            // `<img src="http://localhost:…">`，pane 就直接打到本机服务上；插件的
            // 事后复检只会报错，页面却已经加载出来了。Playwright 起的浏览器自己
            // 会加这条，Electron 的 session 不会。pane 是独立 partition，主界面
            // 的 127.0.0.1:3080 不受影响。
            await configureBrowserPaneProxy(view.webContents.session, body.rules)
            return { status: 200, body: { ok: true } }
          } catch (error) {
            return { status: 500, body: { error: String(error instanceof Error ? error.message : error) } }
          }
        }
        if (body.action === 'hide') {
          animateBrowserPane(win, false)
          broadcastModel()
          return { status: 200, body: { ok: true } }
        }
        // 人工测试 #22（莉莉丝 2026-09-11 定）：AI 每次打开新网址，面板都要
        // 弹出——用户让 AI 去看某个网站，就是要看到它打开；面板优先于官方右侧
        // Sidebar（#13 的互斥会把 Sidebar 收起）。用户随时可以再合上：合上后
        // 同一页面上的快照/点击/滚动照常在隐藏的 view 里进行，只有截图需要
        // 面板可见，那时 AI 要开口请用户打开，而不是自己弹。
        if (body.action === 'reveal') {
          ensureBrowserPane(win)
          animateBrowserPane(win, true)
          broadcastModel()
          return { status: 200, body: { ok: true } }
        }
        return { status: 400, body: { error: 'unknown action' } }
      },
      env: process.env,
    })
    controlBridgeParam = `${String(bridge.port)}.${bridge.controlToken}`
  }

  // ---- 窄 IPC：DSH Terminal 窗口（只接受 terminal 窗口来源） ----

  const fromTerminal = (sender: Electron.WebContents): boolean =>
    terminalWindow !== undefined && sender.id === terminalWindow.webContents.id


  ipcMain.handle('deepseekgui-terminal:send', (event, data: unknown) => {
    if (!fromTerminal(event.sender)) throw new Error('拒绝：非 DSH Terminal 来源')
    if (typeof data !== 'string') throw new Error('拒绝：非法终端输入')
    // 曾经的静默吞键点：host 不在时 optional chaining 把键入无声扔掉——
    // 正是「敲什么都没反应且无任何报错」的形状。现在丢弃必留痕。
    if (terminalOperation === undefined) {
      return
    }
    terminalOperation.write(`${JSON.stringify({ type: 'input', data })}\n`)
  })

  // P8-D47：renderer fit 出的真实尺寸 → 私有 OSC 帧走 host stdin →
  // host 剥帧调 pty.resize。pty 与 xterm 列数一致后 PSReadLine 的重绘
  // 定位才对得上（否则输入行叠影）。帧一次 write 写全，host 侧不拼接。
  ipcMain.on('deepseekgui-terminal:resize', (event, cols: unknown, rows: unknown) => {
    if (!fromTerminal(event.sender)) return
    if (typeof cols !== 'number' || typeof rows !== 'number') return
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return
    if (cols < 20 || cols > 500 || rows < 5 || rows > 300) return
    terminalSize = { cols, rows }
    terminalOperation?.write(`${JSON.stringify({ type: 'resize', cols, rows })}\n`)
  })

  const win = createWindow(uiResult.state)
  // 在 Harness 起来之前问：导入的对话要能被这次 boot 直接看到，否则用户
  // 得重启一次才发现东西进来了。
  await offerSessionImport(resolveHarnessHome(launcher.read().active.home, userDataDir))
  await controller.start()
  followHarnessPreferences(resolveHarnessHome(launcher.read().active.home, userDataDir))
  // B6-P7：上次迁移若停在"等重启核对"，这次启动就是那次重启——按清单逐项
  // 核对新位置。放在 controller.start() 之后：这时应用已经真的从零把新位置
  // 用起来了，核对才代表"从零启动能用"。通过之后删除旧副本的入口才出现。
  migration.verifyOnStartup()
  // 启动完成后结算恢复通知：上次失败已回退 LKG 且本次成功启动时提示一次。
  settleRecoveryNotice()
  // 权限事实：boot 完成后从官方 settings 读取并显示（fail closed）；Managed
  // Home 无明确 preset 时补 DeepSeekGUI 推荐默认（官方唯一写路径，绝不暗改
  // Existing Home）。
  void permissions.refresh().then(() => permissions.ensureManagedDefault())
  // D20：Managed Home 出厂文件（AGENTS.md 模板 + 空 memory.md），只补缺失。
  ensureManagedMemorySeed()
  // 插件事务结算：pending journal + 本次 boot 的结果 → verified（健康）或
  // 恢复链（Managed 自动恢复一次 / Existing 等待确认 / drift fail closed）。
  await settlePluginRecovery()
  const status = controller.status()
  if (status.phase === 'failed') {
    // 需要人工恢复（Existing 等待确认 / drift / 自动恢复后仍失败）时，
    // 绝不直接退出：窗口与托盘保持存活，Plugin Manager 面板显示恢复
    // 区块（Restore / Open Profile Folder / Open DSH Terminal / 放弃）。
    // 其余失败仍走 fail loud 退出。
    const zhFail = desktopLocaleZh()
    const failedStage = status.failure.stage
    // 起不来这件事必须留下记录：这条路径有一半是直接退出的，用户下次开
    // DeepSeekGUI 时想问"上次怎么回事"，DS 手里得有东西可看。
    appendDesktopEvent(resolveHarnessHome(launcher.read().active.home, userDataDir), {
      at: formatStampLocal(new Date().toISOString()),
      title: zhFail ? 'Harness 没能启动' : 'The harness failed to start',
      sections: [
        [
          zhFail ? '发生了什么' : 'What happened',
          zhFail
            ? `DeepSeekGUI 启动内部服务时失败，卡在「${failedStage}」这一步：${redactSecrets(status.failure.message)}`
            : `DeepSeekGUI failed to start its internal service, stopping at the "${failedStage}" stage: ${redactSecrets(status.failure.message)}`,
        ],
        [
          zhFail ? '这通常意味着什么' : 'What this usually means',
          zhFail
            ? (failedStage === 'spawn'
              ? '进程根本没起来，多半是文件缺失、权限不足，或者被安全软件拦下了。'
              : failedStage === 'readiness'
                ? '进程起来了但一直没就绪，常见原因是端口被占用、配置不对，或者某个插件让它起不来。'
                : '服务起来了，但界面没能加载。')
            : (failedStage === 'spawn'
              ? 'The process never started — usually a missing file, a permission problem, or security software blocking it.'
              : failedStage === 'readiness'
                ? 'The process started but never became ready: a port already in use, a bad configuration, or a plugin preventing startup.'
                : 'The service started but the interface could not load.'),
        ],
        [
          zhFail ? '如果用户问起' : 'If the user asks',
          zhFail
            ? '照上面的事实说明就好，这是 DeepSeekGUI 侧的启动问题，不是用户操作错误。'
              + '如果刚装过插件，优先怀疑那次安装；DeepSeekGUI 的设置页里有恢复入口。'
            : 'State the facts above. This is a DeepSeekGUI startup problem, not something the user did wrong. '
              + 'If a plugin was installed recently, suspect that first; the DeepSeekGUI settings page offers a restore entry.',
        ],
      ],
    }, zhFail)
    const needsManualRecovery = recoveryJournal !== null
      && (recoveryJournal.state === 'recovery-needed' || recoveryJournal.state === 'drift')
    if (!needsManualRecovery) {
      failLocalized(
        moduleDict(),
        'fail.dsh-failed.title',
        'fail.dsh-failed.message',
        { stage: status.failure.stage, message: sentence(status.failure.message), hint: diagnosticsHint() },
        1,
      )
      return
    }
    console.error(`[deepseekgui] Harness 启动失败，插件恢复需要人工处理（保持窗口存活）: ${status.failure.stage}: ${status.failure.message}`)
  }
  // 启动尾部只构建一份模型：先广播（此时托盘还没建），托盘建好后用
  // 同一份重建菜单。中间的 refresh-profiles 是异步的，其结果要到自己
  // 的 broadcast 才落地（那次会再重建一遍托盘菜单），所以这两处此刻
  // 看到的事实必然相同，复用不会让托盘停在过期状态。
  const bootModel = buildModel()
  broadcast(bootModel)
  // 启动完成后做一次只读 discovery，让"切换 Profile"开箱即有列表。
  void runCommand({ type: 'refresh-profiles' }).catch(reportFailure)

  // 系统托盘：常驻入口，菜单随唯一模型重建（首次渲染此刻完成）。
  // 图标资产与 chrome/terminal 同锚（MODULE_DIR → ../src/chrome/），经
  // main 的 fs（asar 补丁）读成 buffer 再构造——createFromPath 的
  // root 锚定在打包态指向不存在的路径，空图标会让托盘被静默跳过：
  // 常驻应用没有托盘等于关窗后没有回来的门（实机验收抓获）。
  // P7-I：tray.ico 是多尺寸容器（16/20/24/32），Tray 原样持有、绝不
  // 再硬缩到 16×16——单张 PNG 硬缩是 125%/150%/200% 缩放下发糊的根因，
  // Windows 托盘会按当前 DPI 自选容器里的尺寸。
  // 托盘创建失败对常驻语义是致命的：大声记日志，绝不静默吞掉。
  try {
    // 图标必须走 createFromPath，**不能用 createFromBuffer**：后者只认 PNG/JPEG，
    // 喂给它一个 ICO 容器解码结果是空图——于是 isEmpty() 抛错、托盘被跳过，
    // 而错误只落进 console，打包 GUI 又没有控制台，用户那边就是"托盘图标从来
    // 没出现过"（2026-08-22 实机抓获，P8-D20：住户入住至今一直没有托盘）。
    // P7-I 当初为避开"createFromPath 锚不到路径"才改用 buffer，等于把"路径读
    // 不到"换成了"解码为空"——两种都让托盘静默消失。
    //
    // 打包态取 resources 下的真实文件（electron-builder 的 extraResources
    // 送过去）：createFromPath 是 C++ 侧读盘，不该指望它去解 asar。
    // Linux 托盘不认 ICO 容器：同源生成的 tray.png（32px 单图，见
    // generate-desktop-icon.ts）；Windows 继续用多尺寸 ICO 按 DPI 自选。
    const trayAsset = process.platform === 'win32' ? 'tray.ico' : 'tray.png'
    const trayIconPath = app.isPackaged
      ? join(process.resourcesPath, trayAsset)
      : join(MODULE_DIR, '..', 'src', 'chrome', trayAsset)
    const trayIcon = nativeImage.createFromPath(trayIconPath)
    if (trayIcon.isEmpty()) throw new Error(`托盘图标资产解码为空：${trayIconPath}`)
    tray = new Tray(trayIcon)
    tray.setToolTip('DeepSeekGUI')
    tray.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })
    rebuildTrayMenu(bootModel)
  } catch (error) {
    console.error(`[deepseekgui] 系统托盘创建失败（常驻入口缺失，关窗后需重开快捷方式唤醒）: ${String(error instanceof Error ? error.message : error)}`)
  }

  // M2 single-slot 落盘恢复：重启后读 verified 记录（记录损坏/指向缓存目录
  // 之外一律当没有；digest 在下载复用与安装前都重新验证）。孤儿产物由下一次
  // 下载的目录清理回收，绝不无限累积。
  const restoredUpdate = readVerifiedRecord(updateCacheDir(userDataDir))
  if (restoredUpdate !== null) {
    updates.restoreVerified(restoredUpdate, dictText(moduleDict(), 'msg.update-verified-cached'))
  }

  // background 更新检查：延迟调度、不阻塞启动；未配置/网络错误静默；
  // 只有 strictly newer stable 才通过托盘气泡提示一次（Manual 有完整结果）。
  if (!SMOKE) {
    setTimeout(() => {
      void updates.check(true)
    }, 8000)
  }

  if (SMOKE) {
    console.log('[deepseekgui] window loaded')
    // smoke：跳过常驻与确认流程，直接真实关窗退出。
    quitting = true
    win.close()
  }
})

/** 自动下载开关的启动初值；UI state 读到之后、控制器建起来之前的暂存。 */
let initialAutoDownload = true

/**
 * 本模块所在目录：chrome/terminal 的页面与 preload、托盘与窗口图标、模板
 * 资产全都以它为锚。此前七处各算一遍，其中三处还各自声明了一份同名局部。
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** ControlModel 推送出口（whenReady 里绑定；此前调用是安全的空操作）。 */
let broadcastModel: () => void = () => {}

// 常驻模式：窗口全部关闭但托盘还在时保持运行；真正的退出只走
// requestQuit/proceedQuit 的 quitting 流程（或 OS session-end）。
app.on('window-all-closed', () => {
  if (!quitting) return
  app.quit()
})

// （B1 时代此处还有一个 before-quit 里 stop-then-quit 的处理器；其职责
// 已被顶部的 before-quit → proceedQuit 路由完全覆盖，保留会造成同一次
// 退出触发两路并发 stop 与重复 app.quit，故移除。）
