/**
 * headless 诊断导出（`--export-diagnostics`）的组装与落盘。
 *
 * 只收集本地证据：服务日志与轮转历史（已脱敏）、Crashpad dump（总量有界、
 * 超限如实跳过）、上次退出状态与 build info。**绝不上传任何内容**，也绝不
 * 启动 Harness / Profile / 第三方插件 / 主窗口 / tray，不监听端口，不执行
 * plugin recovery 或 update。全程同步 fs 操作。
 *
 * 独立成模块而不是并进 diagnostics-service：那边被 update-view 依赖着，而
 * 这里要用 update-view 的 readInstallStampText——放进去就是一个环。这个模块
 * 坐在两者上层，环不成立。
 *
 * 进程的去留（stdout 输出与 exit code）**不在这里**：那是入口的策略，留在
 * main 里显式可见。这里只负责「组装好、写下去、把目录告诉调用方」，失败就
 * 抛，由调用方决定怎么退出。
 * @module @see-sol-lab/deepseekgui/diagnostics-export
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVE_RUN_FILENAME, collectCrashDumpEvidence, parseActiveRunMarker } from './crash-evidence.ts'
import {
  assembleDiagnosticsBundle,
  buildInfoLines,
  buildInfoText,
  collectLogFamily,
  MAIN_LOG_FILENAME,
  writeDiagnosticsBundle,
} from './diagnostics-service.ts'
import { redactSecrets } from './redact.ts'
import { readInstallStampText } from './update-view.ts'
import type { DeepSeekGUIVersionInfo } from './version-info.ts'

/** headless 导出要用的全部事实；Electron 侧的几项由调用方取好。 */
export interface HeadlessExportFacts {
  /** userData 目录：日志、dump、marker 与输出目录都在它下面。 */
  readonly userDataDir: string
  /** 用户主目录：导出文本里归一化成 `<USER_HOME>` 的那个。 */
  readonly home: string
  /** 主目录的其它写法（短路径等），一并归一化。 */
  readonly homeAliases: readonly string[]
  /** 版本事实四元组。 */
  readonly version: DeepSeekGUIVersionInfo
  /** 当前 Home 形态；launcher state 读不到时调用方传 'managed' 与 'unknown'。 */
  readonly homeKind: 'managed' | 'existing'
  /** 当前 profile 名。 */
  readonly profile: string
  /** 导出时刻。 */
  readonly at: Date
  /** 整体超时：读盘卡住时明确失败，而不是无限期挂着。 */
  readonly timeoutMs: number
}

/**
 * 组装并写出一份 headless 诊断包。
 * @param facts - 导出所需的全部事实。
 * @returns 写入的目录绝对路径。
 * @throws 超时或写盘失败时抛出；调用方决定如何退出进程。
 */
export function exportHeadlessDiagnostics(facts: HeadlessExportFacts): string {
  // 超时从**现在**起算，不从 `facts.at` 起算。`at` 是这份诊断包标称的时刻，
  // 由调用方决定，可以是任何时间：真实调用恰好传 `new Date()`，于是两者一致，
  // 这个假设便一直没有暴露。一旦 `at` 不是此刻——测试传固定时刻、或将来有人
  // 重放一份历史事实——deadline 就落在过去，第一次检查即抛，导出永远做不完。
  const deadline = Date.now() + facts.timeoutMs
  const assertNotTimedOut = (): void => {
    if (Date.now() >= deadline) {
      throw new Error(`headless 导出超过 ${String(facts.timeoutMs)}ms 未完成`)
    }
  }
  // 服务日志（current + 全部轮转历史），先 redaction 再交给纯函数组装。
  const logPath = join(facts.userDataDir, 'dsh-service.log')
  const logEntries = [
    ...collectLogFamily(logPath, redactSecrets, assertNotTimedOut),
    // 主进程自己的日志也进包（#19）。
    ...collectLogFamily(join(facts.userDataDir, MAIN_LOG_FILENAME), redactSecrets, assertNotTimedOut),
  ]
  // Crashpad 本地 dump：总量有界，最近者优先，超限如实记入 manifest。
  const crashEvidence = collectCrashDumpEvidence(facts.userDataDir)
  assertNotTimedOut()
  // active-run marker 仍存在 = 上次未正常退出（证据，不自动断言 crash）。
  let lastExit = 'unknown'
  try {
    const marker = parseActiveRunMarker(readFileSync(join(facts.userDataDir, ACTIVE_RUN_FILENAME), 'utf8'))
    if (marker !== null) lastExit = `unclean (marker pid ${String(marker.pid)} started ${marker.startedAt})`
  } catch {
    // 无 marker 文件或不可读：unknown。
  }
  const files = assembleDiagnosticsBundle({
    home: facts.home,
    homeAliases: facts.homeAliases,
    version: facts.version,
    logEntries,
    buildInfo: buildInfoText(buildInfoLines({
      version: facts.version,
      homeKind: facts.homeKind,
      profile: facts.profile,
      harnessStatus: 'not running (headless export)',
      logPath: logEntries.length > 0 ? logPath : null,
      updateChannel: 'not read (headless export)',
      lastUpdate: readInstallStampText(facts.userDataDir, facts.version.appVersion),
    })),
    exportedAt: facts.at.toISOString(),
    extraFiles: crashEvidence.extraFiles,
    skippedEvidence: crashEvidence.skipped,
    lastExit,
  })
  const dir = writeDiagnosticsBundle(facts.userDataDir, files, facts.at)
  assertNotTimedOut()
  return dir
}
