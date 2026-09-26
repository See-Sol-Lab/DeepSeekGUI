/**
 * @vitest-environment jsdom
 *
 * Desktop Chrome renderer 的面板意图接线：openMenu 扩 Chrome view bounds 是
 * 跨进程往返，往返期间用户可以按下别的意图（菜单里的"检查更新"直接切
 * diagnostics、Escape 关闭）。这些路径同步改 openPanel，若 await 落地后
 * 无条件写回自己的 panel 就会覆盖它们——真实表现是"点了没反应"：面板
 * 内容已渲染在 DOM 里却被重新藏起（DS 打包态实测抓获）。
 * 本文件钉死"最后一次意图获胜"。
 * @module @see-sol-lab/deepseekgui/tests/chrome-renderer
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildControlModel, type DesktopControlCommand, type DesktopControlModel } from '../src/control-model.ts'
import { usageViewOf } from '../src/usage-service.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** 跨进程 setChromeExpanded 的模拟往返延迟（ms）。 */
const IPC_MS = 5

const commands: DesktopControlCommand[] = []
/** main 转发的"打开反馈面板"通知；入口按钮住在另一层，这里只收通知。 */
let pushModel: (model: DesktopControlModel) => void

/** v1.1.1 真实发布说明（中英双语、锚点、`---`、共享尾注、围栏代码）。 */
const REAL_NOTES = readFileSync(join(here, 'fixtures', 'release-notes-v1.1.1.md'), 'utf8')

/** renderer 只接受单调递增的 revision：每个模型都拿一个新号，旧模型不会被误当成回退。 */
let revisionCounter = 0

const model = (locale: 'zh' | 'en' = 'zh'): DesktopControlModel => buildControlModel({
  locale,
  state: {
    schemaVersion: 1,
    active: { home: { kind: 'managed' }, profile: 'web' },
    pending: null,
    lastKnownGood: { home: { kind: 'managed' }, profile: 'web' },
    lastBootFailure: null,
    interruptedSwitch: null,
  },
  status: { phase: 'running', selection: { profile: 'web', dshHome: 'C:/ud/dsh' }, recovered: false },
  activeDshHome: 'C:/ud/dsh',
  discovery: { schemaVersion: 1, dshHome: 'C:/ud/dsh', profiles: [] },
  discoveryError: null,
  logPath: 'C:/ud/logs/deepseekgui.log',
  existingHomeCandidate: null,
  effectiveTheme: 'dark',
  highContrast: false,
  recoveryNotice: null,
  revision: revisionCounter += 1,
  viewMode: 'workbench',
  update: {
    channel: null, state: 'idle', result: null, latestVersion: null,
    releaseNotes: null, releasePageUrl: null, progressBytes: null, progressTotal: null, message: null, autoDownload: true,
    viaFallback: false,
  },
  diagnostics: {
    buildInfo: [
      { key: 'diag.build.app', label: 'Version', value: 'DeepSeekGUI 1.0.0' },
      { key: 'diag.build.home', label: 'Home', value: 'managed' },
      { key: 'diag.build.profile', label: 'Profile', value: 'web' },
    ],
    homeDisplay: '<USER_HOME>/ud/dsh',
    logPath: 'C:/ud/logs/deepseekgui.log',
    lastExport: null,
    uncleanExit: null,
  },
  feedback: { open: false, diagnostics: '', phase: 'idle', reply: null, issueTitle: '', degradedReason: null, notice: null, gatewayConfigured: false },
  permissions: { mode: 'sandbox', preset: 'workspace-write', detail: null },
  powerShell7Available: true,
  browserPane: { present: false, open: false },
  dataHome: { homePath: 'C:/ud/dsh', homeKind: 'managed', awaitingRestart: null, verifyFailed: null, pendingCleanup: null },
  usage: usageViewOf(),
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })
const click = (el: Element): void => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) }
const escape = (): void => {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`fixture 缺少 #${id}`)
  return node
}

beforeAll(async () => {
  // 真实 index.html：renderer 在模块顶层按 id 抓元素，缺一个就整个接线失败。
  const html = readFileSync(join(here, '..', 'src', 'chrome', 'index.html'), 'utf8')
  document.documentElement.innerHTML = html
  ;(window as unknown as { deepseekGUIDesktop: unknown }).deepseekGUIDesktop = {
    getControlModel: async () => model(),
    runControlCommand: async (command: DesktopControlCommand) => { commands.push(command) },
    onControlModelChanged: (listener: (next: DesktopControlModel) => void) => {
      pushModel = listener
      return () => {}
    },
    setChromeExpanded: async () => { await sleep(IPC_MS) },
    onOpenUpdatePanel: () => () => {},
  }
  await import('../src/chrome/renderer.ts')
  pushModel(model())
})

beforeEach(async () => {
  commands.length = 0
  escape()
  // 每个用例从"没有更新"的模型起步；有更新的用例自己推送。
  pushModel(model())
  await sleep(IPC_MS * 3)
})

/** 推一个"有可用更新"的模型：v1.2.0 + 真实双语说明 + 已知发布页。 */
function pushAvailable(locale: 'zh' | 'en' = 'zh', over: Partial<DesktopControlModel['update']> = {}): void {
  const base = model(locale)
  pushModel({
    ...base,
    update: {
      ...base.update,
      channel: 'https://github.com/See-Sol-Lab/DeepSeekGUI/releases/latest/download/update-manifest.json',
      state: 'available',
      latestVersion: '1.2.0',
      releaseNotes: REAL_NOTES,
      releasePageUrl: 'https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.2.0',
      ...over,
    },
  })
}

/** 打开更新面板（经汉堡菜单 → 检查更新）并等 IPC 落地。 */
async function openUpdatePanel(): Promise<void> {
  click(byId('hamburger'))
  await sleep(IPC_MS * 4)
  click(document.querySelector('[data-command="check-updates"]') as Element)
  await sleep(IPC_MS * 2)
  expect(byId('update-panel').hidden).toBe(false)
}

describe('openMenu 的面板意图（最后一次意图获胜）', () => {
  it('扩 bounds 往返期间点"检查更新"：更新面板可见，不被陈旧意图盖回去', async () => {
    click(byId('hamburger'))
    // 不等 IPC 落地就点——自动化必然撞上，人手一般撞不上。
    const checkUpdates = document.querySelector('[data-command="check-updates"]')
    expect(checkUpdates).not.toBeNull()
    click(checkUpdates as Element)
    await sleep(IPC_MS * 4)

    // P8-D35①：检查更新有自己的面板（诊断面板已随 D39 移居设置页）。
    expect(byId('update-panel').hidden).toBe(false)
    expect(byId('main-menu').hidden).toBe(true)
    expect(commands).toContainEqual({ type: 'check-for-updates' })
  })

  it('往返落地后点"检查更新"：更新面板同样可见（正常路径不受影响）', async () => {
    click(byId('hamburger'))
    await sleep(IPC_MS * 4)
    click(document.querySelector('[data-command="check-updates"]') as Element)
    await sleep(IPC_MS * 2)

    expect(byId('update-panel').hidden).toBe(false)
    expect(byId('main-menu').hidden).toBe(true)
  })

  it('往返期间按 Escape：菜单保持关闭，不被 openMenu 强行打开', async () => {
    click(byId('hamburger'))
    escape()
    await sleep(IPC_MS * 4)

    expect(byId('main-menu').hidden).toBe(true)
    expect(byId('overlay').hidden).toBe(true)
  })

  it('往返期间再点一次汉堡：第二下是关，不是又开一次', async () => {
    click(byId('hamburger'))
    click(byId('hamburger'))
    await sleep(IPC_MS * 4)

    expect(byId('main-menu').hidden).toBe(true)
    expect(byId('overlay').hidden).toBe(true)
  })

  it('主菜单里的 DSH 终端入口：发同一条 show-terminal 命令并关菜单', async () => {
    click(byId('hamburger'))
    await sleep(IPC_MS * 4)
    click(byId('menu-terminal'))
    await sleep(IPC_MS * 2)

    expect(commands).toContainEqual({ type: 'show-terminal' })
    expect(byId('main-menu').hidden).toBe(true)
  })

  it('未被抢占时照常打开主菜单', async () => {
    click(byId('hamburger'))
    await sleep(IPC_MS * 4)

    expect(byId('main-menu').hidden).toBe(false)
    expect(byId('overlay').hidden).toBe(false)
  })
})

describe('更新面板（R10：说明外链化，面板只留状态与动作）', () => {
  it('可用状态：版本行 + 提示 + 下载/关闭/新功能/自动下载；不再渲染说明正文', async () => {
    pushAvailable('zh')
    await openUpdatePanel()
    expect(byId('diag-update-version').textContent).toBe('有新版本可用：1.2.0')
    const actions = byId('update-actions')
    expect(actions.querySelector('#diag-download-update')).not.toBeNull()
    expect(actions.querySelector('#diag-dismiss-update')).not.toBeNull()
    expect(actions.querySelector('#diag-toggle-auto-download')).not.toBeNull()
    expect(actions.querySelector('#diag-release-page')).not.toBeNull()
    // 长说明不再进面板（R10）：正文、折叠钮、空态占位一概不存在。
    expect(document.getElementById('diag-release-notes')).toBeNull()
    expect(document.getElementById('diag-release-notes-toggle')).toBeNull()
    expect(byId('update-status').textContent).not.toContain('新增首次启动引导')
  })

  it('「新功能」只发 open-external-link 跳 Release 页，不导航不下载', async () => {
    pushAvailable('zh')
    await openUpdatePanel()
    expect(byId('diag-release-page').textContent).toBe('新功能 ↗')
    click(byId('diag-release-page'))
    expect(commands).toContainEqual({ type: 'open-external-link', url: 'https://github.com/See-Sol-Lab/DeepSeekGUI/releases/tag/v1.2.0' })
    expect(commands.filter(command => command.type === 'update-download')).toHaveLength(0)
  })

  it('私有 feed 没有已知发布页：不显示「新功能」', async () => {
    pushAvailable('zh', { channel: 'https://feed.example/m.json', releasePageUrl: null })
    await openUpdatePanel()
    expect(document.getElementById('diag-release-page')).toBeNull()
  })

  it('已验证状态：安装按钮带 🎁，没有下载按钮', async () => {
    pushAvailable('zh', { state: 'verified', message: '下载并验证完成，可以安装' })
    await openUpdatePanel()
    expect(byId('diag-update-message').textContent).toBe('下载并验证完成，可以安装')
    const install = byId('update-actions').querySelector('#diag-install-update')
    expect(install).not.toBeNull()
    expect(install?.textContent).toContain('🎁')
    expect(byId('update-actions').querySelector('#diag-download-update')).toBeNull()
  })

  it('版本简行不携带 source/commit 尾注（R1）；title 保留全值', async () => {
    const base = model('zh')
    pushModel({
      ...base,
      diagnostics: {
        ...base.diagnostics,
        buildInfo: [
          { key: 'diag.build.app', label: 'Version', value: 'DeepSeekGUI 1.1.2' },
          { key: 'diag.build.dsh', label: 'Embedded DSH', value: '0.1.5-rc.2 (source abc1234def5)' },
          { key: 'diag.build.profile', label: 'Profile', value: 'web' },
        ],
      },
    })
    await openUpdatePanel()
    const values = [...byId('update-info').querySelectorAll('.info-value')]
    expect(values).toHaveLength(2)
    expect(values[1]?.textContent).toBe('0.1.5-rc.2')
    expect((values[1] as HTMLElement).title).toBe('0.1.5-rc.2 (source abc1234def5)')
  })
})

describe('更新气泡（R10：Codex 式状态提示）', () => {
  it('没有更新时隐藏；available/downloading/verified 三态各有文案', () => {
    expect(byId('update-hint').hidden).toBe(true)
    pushAvailable('zh')
    expect(byId('update-hint').hidden).toBe(false)
    expect(byId('update-hint').textContent).toBe('发现新版本 1.2.0')
    pushAvailable('zh', { state: 'downloading' })
    expect(byId('update-hint').textContent).toBe('1.2.0 下载中…')
    pushAvailable('zh', { state: 'verified' })
    expect(byId('update-hint').textContent).toBe('更新已就绪 🎁')
    pushAvailable('en')
    expect(byId('update-hint').textContent).toBe('New version 1.2.0')
  })

  it('汉堡菜单「检查更新」行随状态带小图标', async () => {
    pushAvailable('zh', { state: 'downloading' })
    click(byId('hamburger'))
    await sleep(IPC_MS * 4)
    expect(byId('menu-check-updates').textContent).toBe('检查更新 ⬇️')
    pushAvailable('zh', { state: 'verified' })
    expect(byId('menu-check-updates').textContent).toBe('检查更新 🎁')
    escape()
  })

  it('点击气泡打开更新面板；气泡从不发下载/安装命令', async () => {
    pushAvailable('zh')
    click(byId('update-hint'))
    await sleep(IPC_MS * 3)
    expect(byId('update-panel').hidden).toBe(false)
    expect(commands.filter(command => command.type === 'update-download' || command.type === 'update-install')).toHaveLength(0)
  })

  it('更新被关闭后气泡消失', () => {
    pushAvailable('zh')
    expect(byId('update-hint').hidden).toBe(false)
    pushModel(model())
    expect(byId('update-hint').hidden).toBe(true)
  })
})

// Feedback 面板用例已随 P8-D39 移除：反馈整体移居官方设置页的
// DeepSeekGUI 分区（settings-plugin），Chrome 不再有对应容器与入口。
