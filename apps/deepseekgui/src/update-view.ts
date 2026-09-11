/**
 * update 面板的事实读取与默认形态（B6-P8 从 main.ts 提取）。
 *
 * 这里只放「读事实、拼形态」：更新通道配置、装机时刻、安装包摘要，以及
 * {@link UpdateView} 的默认形态。状态机与副作用（检查、下载、校验、交接安装）
 * 仍由 main 单处持有——本模块不持有更新状态，也不发起任何网络请求。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/update-view
 */

import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateView } from './control-model.ts'
import { formatStampLocal, resolveInstallStamp } from './diagnostics-service.ts'
import { resolveUpdateFeed, sha256Stream } from './update-service.ts'

/** 更新通道配置文件（userData 下；缺失/损坏/非 https = unconfigured）。 */
export const UPDATE_FEED_FILENAME = 'deepseekgui-update-feed.json'

/** 当前版本装机时刻的记录（userData 下；见 {@link readInstallStampText}）。 */
export const INSTALL_STATE_FILENAME = 'deepseekgui-install-state.json'

/** 装机时刻文本的进程内缓存（一次运行里恒定，见 {@link readInstallStampText}）。 */
let installStampCache: string | null = null

/**
 * update 面板状态的默认形态：每次状态迁移只写与默认不同的字段，其余归位。
 * 八个字段曾在十余处被逐字重建，漏写一个就会把上一态的残留带进新状态。
 * @param overrides - 本次迁移真正要改的字段。
 * @returns 完整的 UpdateView。
 */
export function updateViewOf(overrides: Partial<UpdateView> = {}): UpdateView {
  return {
    channel: null, state: 'idle', result: null, latestVersion: null, releaseNotes: null,
    progressBytes: null, progressTotal: null, message: null, autoDownload: true,
    ...overrides,
  }
}

/**
 * 取消安装后的面板状态：回到 available 并说明安装包仍在（single-slot 保留）。
 * 对话框取消与面板取消是两条入口、同一语义；P11 起由本函数统一组装，主进程
 * 只提供通道、版本、release notes 与已本地化的提示文案。
 * @param input - 通道、版本、release notes 与提示文案。
 * @returns 迁移后的 UpdateView。
 */
export function cancelledInstallView(input: {
  channel: string | null
  version: string
  releaseNotes: string | null
  message: string
}): UpdateView {
  return updateViewOf({
    channel: input.channel,
    state: 'verified',
    latestVersion: input.version,
    releaseNotes: input.releaseNotes,
    message: input.message,
  })
}

/**
 * 读取生效的更新通道：userData 下的配置文件优先，没有该文件时用内置的
 * 公开通道（{@link DEFAULT_UPDATE_FEED_URL}）。解析规则见 resolveUpdateFeed
 * ——文件存在却非法时明确 unconfigured，绝不回落默认。
 * @param userDataDir - Electron userData 目录。
 * @returns feed URL 或 null（unconfigured）。
 */
export function readUpdateFeed(userDataDir: string): string | null {
  let text: string | null
  try {
    text = readFileSync(join(userDataDir, UPDATE_FEED_FILENAME), 'utf8')
  } catch (error) {
    // 只有"没有这个文件"才算未覆盖；读得到却读失败（权限等）按未配置处理。
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
    text = null
  }
  return resolveUpdateFeed(text)
}

/**
 * 流式计算安装包摘要：整包同步读+哈希会把主进程钉住（147MB installer
 * 实测阻塞约 117ms，冷盘更久），校验语义不变——读不到就返回 null，
 * 由调用方按"与记录不符"处理，绝不放行。
 * @param path - 安装包绝对路径。
 * @returns hex 摘要；读取或哈希失败返回 null。
 */
export async function digestInstaller(path: string): Promise<string | null> {
  try {
    return await sha256Stream(createReadStream(path))
  } catch {
    return null
  }
}

/**
 * 读取（必要时补写）当前版本的装机时刻，返回面板用的可读文本。
 *
 * 只在版本变化时落盘一次，正常启动是纯读。写不进去（只读介质、权限）
 * 时如实回落到"这次算起"——这一行是给人看的说明，绝不能因为写盘失败
 * 就把启动拦下来。
 * @param userDataDir - Electron userData 目录。
 * @param version - 当前应用版本。
 * @returns `YYYY-MM-DD HH:mm` 文本；无法确定时返回 unknown。
 */
export function readInstallStampText(userDataDir: string, version: string): string {
  // 进程内缓存：这一行事实在一次运行里不可能变（版本是启动时定死的），
  // 而 buildDiagnosticsView 每次广播都会问它一次，设置页还在轮询模型。
  // 不缓存就是把一次性的常量读成了每 2 秒一次的磁盘 I/O。
  if (installStampCache !== null) return installStampCache
  const file = join(userDataDir, INSTALL_STATE_FILENAME)
  let raw: string | null
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    raw = null
  }
  const { stamp, changed } = resolveInstallStamp(raw, version, new Date().toISOString())
  if (changed) {
    try {
      writeFileSync(file, `${JSON.stringify(stamp, undefined, 2)}\n`)
    } catch {
      // 记不下来也要显示得出：本次仍按这一刻算。
    }
  }
  const text = formatStampLocal(stamp.since)
  installStampCache = text === '' ? 'unknown' : text
  return installStampCache
}
