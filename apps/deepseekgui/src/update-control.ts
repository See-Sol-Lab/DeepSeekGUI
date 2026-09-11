/**
 * Update 执行面：provider（取 manifest）、downloader、verifier 与面板状态。
 *
 * **安装交接不在这里。** 那一步要停掉一切、spawn installer、再走与 Quit
 * 完全相同的有序清理才退出——那是进程生命周期的编排，属于入口。这个模块
 * 只负责「知道有什么可更新、把它下下来、验明正身、把状态讲清楚」，安装时
 * 由入口回来问它拿已验证的那一份。
 *
 * 两处按**对象身份**做的过期判定是要害，不是风格：摘要走流式、会让出主
 * 线程，回来时 single-slot 记录或面板状态都可能已被别的路径整体替换（新
 * 一轮检查、取消、安装）。所以回来后先确认还是同一个对象，绝不拿陈旧
 * 快照的结论去写当前状态。
 *
 * 网络、文案与广播都经注入面传入，所以模块不依赖 Electron。
 * @module @see-sol-lab/deepseekgui/update-control
 */

import { prepareUpdateCache, promoteVerifiedFile, updateCacheDir, writeVerifiedRecord } from './update-cache.ts'
import { appendDesktopEvent } from './desktop-events.ts'
import { formatStampLocal } from './diagnostics-service.ts'
import { cancelledInstallView, digestInstaller, updateViewOf } from './update-view.ts'
import {
  sanitizeAssetFilename,
  isNewerStable,
  selectPlatformAsset,
  shouldAutoDownloadUpdate,
  shouldReuseVerifiedInstaller,
  updateCachePaths,
} from './update-service.ts'
import { runUpdateCheck, runUpdateDownload, type CheckOutcome, type UpdateRunnerDeps } from './update-runner.ts'
import type { UpdateManifest } from './update-service.ts'
import type { UpdateView } from './control-model.ts'

/**
 * 下载进度广播的最小间隔（毫秒）。HTTP 每个数据块都回调一次，
 * 逐块广播 = 逐块重建整模型 + 重建托盘菜单 + 全量 IPC + 渲染端全树重建
 * （147MB 安装包按 64KB/块 ≈ 2300 次）。进度状态仍逐块精确更新，
 * 只是推送按此间隔合并；下载结束的终态广播不受节流影响。
 */
const UPDATE_PROGRESS_BROADCAST_INTERVAL_MS = 100

/** 已下载并验证的 installer（single-slot 策略：目录内最多一份）。 */
export interface VerifiedInstaller {
  readonly path: string
  readonly sha256: string
  readonly version: string
}

/** 安装前重新验证的结果。 */
export type InstallerRecheck =
  /** 可以装：文件仍与记录一致。 */
  | { readonly ok: true; readonly file: VerifiedInstaller }
  /** 没有待装的文件，或状态不对。 */
  | { readonly ok: false; readonly reason: 'none' }
  /** 校验期间记录或面板被换过——结论已过期，什么都别做。 */
  | { readonly ok: false; readonly reason: 'stale' }
  /** 磁盘上的文件与记录的摘要不符：绝不执行。 */
  | { readonly ok: false; readonly reason: 'mismatch' }

/** 执行面要用到的宿主能力。 */
export interface UpdateControlDeps {
  /** 网络与 spawn 的注入面（由入口造好）。 */
  readonly runner: UpdateRunnerDeps
  /** 自动下载开关的初值；单一 owner 是 UI state 文件，这里只拿它的当前值。 */
  readonly autoDownload: boolean
  /** userData 目录：下载缓存在它下面。 */
  readonly userDataDir: string
  /** 当前 app version：比较对象只能是它。 */
  readonly appVersion: string
  /** 读生效的更新通道 URL。 */
  readonly readFeed: () => string | null
  /** 取一条本地化文案。 */
  readonly text: (key: string, vars?: Record<string, string>) => string
  /** 当前是否中文界面。 */
  readonly zh: () => boolean
  /** 托盘气泡；没有托盘时是空操作。 */
  readonly showBalloon: (title: string, content: string) => void
  /** 当前 DSH home：下载失败的事件写在那里。 */
  readonly dshHome: () => string
  /** 脱敏。 */
  readonly redact: (text: string) => string
  /** 事实变化后推送控制模型。 */
  readonly broadcast: () => void
}

/** Update 执行面。 */
export interface UpdateControl {
  /** 面板状态（channel 由内部维护，autoDownload 一并带出）。 */
  readonly view: () => UpdateView
  /** 检查更新；background = 静默（不弹错、不显示"已是最新"）。 */
  readonly check: (background: boolean) => Promise<void>
  /** 下载并验证 installer（下载前已由调用方确认）。 */
  readonly download: () => Promise<void>
  /** 取消进行中的下载。 */
  readonly cancelDownload: () => void
  /** 关闭 available/verified 面板状态（不删除已验证 installer）。 */
  readonly dismiss: () => void
  /** 自动下载开关当前值。 */
  readonly autoDownload: () => boolean
  /** 设置自动下载开关（持久化由调用方负责）。 */
  readonly setAutoDownload: (next: boolean) => void
  /**
   * 启动时恢复上次已验证的 installer。
   * @param file - 落盘记录里的那一份。
   * @param message - 面板提示；由调用方给，模块不持有文案。
   */
  readonly restoreVerified: (file: VerifiedInstaller, message: string) => void
  /** 待下载的版本与体积，供确认对话框使用；不在 available 时为 null。 */
  readonly pendingDownload: () => { version: string; sizeMb: string } | null
  /** 安装前重新验证磁盘上的文件仍与记录一致。 */
  readonly recheckInstaller: () => Promise<InstallerRecheck>
  /** 用户取消安装：回到 available 并说明安装包仍在。 */
  readonly noteInstallCancelled: () => void
  /** 在当前面板状态上附一条消息（Linux 手动替换提示走这里）。 */
  readonly noteMessage: (message: string) => void
}

/**
 * 建一个 Update 执行面。
 * @param deps - 宿主能力。
 * @returns Update 执行面。
 */
export function createUpdateControl(deps: UpdateControlDeps): UpdateControl {
  /** update 面板状态。 */
  let view: UpdateView = updateViewOf()
  /**
   * 自动下载开关的内存镜像。单一 owner 是 UI state 文件；这里只缓存最近
   * 一次读到的值，启动时同步一次、切换时写回并更新。
   */
  let autoDownload = deps.autoDownload
  /** 最近一次 check 解析出的 manifest（下载/安装只认它）。 */
  let manifest: UpdateManifest | null = null
  /** 已下载并验证的 installer。 */
  let downloaded: VerifiedInstaller | null = null
  /** 进行中下载的取消信号。 */
  let abort: AbortController | null = null
  /** background 提示只发一次（同一版本不反复打扰）。 */
  let balloonVersion: string | null = null

  const performDownload = async (): Promise<void> => {
    if (abort !== null || manifest === null || view.state !== 'available') return
    const current = manifest
    const picked = selectPlatformAsset(current.assets, process.platform)
    if (!picked.ok) return
    const asset = picked.asset
    // single-slot 复用：上次已验证的同版本 installer 还在、记录 digest 匹配、
    // 且磁盘文件 digest 仍匹配 → 跳过下载直接 verified。
    const recorded = downloaded
    if (recorded !== null && shouldReuseVerifiedInstaller(
      recorded.sha256, recorded.version, asset, current.latestVersion,
    )) {
      const viewBefore = view
      const existingDigest = await digestInstaller(recorded.path)
      // 摘要是流式的，校验期间让出了主线程：回来后按对象身份比对，被换过
      // 就说明结论已过期，直接退出。
      if (downloaded !== recorded || view !== viewBefore) return
      if (existingDigest === recorded.sha256) {
        view = updateViewOf({
          channel: view.channel,
          state: 'verified',
          latestVersion: current.latestVersion,
          releaseNotes: current.releaseNotes,
          message: deps.text('msg.update-verified-cached'),
        })
        deps.broadcast()
        return
      }
    }
    const updateDir = updateCacheDir(deps.userDataDir)
    // 下载中的临时文件与校验通过的最终文件分名——只有校验通过后 rename
    // 出的最终名字才是 runner/安装路径能看到的对象。
    const paths = updateCachePaths(updateDir, sanitizeAssetFilename(asset.filename) ?? 'DeepSeekGUI-Setup.exe')
    // single-slot：目录内最多一份产物——新下载前清掉旧产物与旧 verified
    // 记录；verified 成功后落盘记录，重启后可复用，绝不产生孤儿文件。
    prepareUpdateCache(updateDir)
    downloaded = null
    const signal = new AbortController()
    abort = signal
    view = updateViewOf({
      channel: view.channel,
      state: 'downloading',
      latestVersion: current.latestVersion,
      releaseNotes: current.releaseNotes,
      progressBytes: 0,
      progressTotal: asset.size,
    })
    deps.broadcast()
    // 进度节流：状态每块都更新（终态数字精确），推送最多每
    // UPDATE_PROGRESS_BROADCAST_INTERVAL_MS 一次。最后一块可能被丢掉，
    // 但紧接着的终态一定会广播，所以界面不会停在中间数字上。
    let lastProgressBroadcastAt = 0
    const outcome = await runUpdateDownload(
      deps.runner,
      current,
      asset,
      paths.partial,
      signal.signal,
      (bytes) => {
        view = { ...view, progressBytes: bytes }
        const now = Date.now()
        if (now - lastProgressBroadcastAt < UPDATE_PROGRESS_BROADCAST_INTERVAL_MS) return
        lastProgressBroadcastAt = now
        deps.broadcast()
      },
      deps.zh(),
    )
    abort = null
    switch (outcome.kind) {
      case 'verified': {
        // 校验通过才把临时文件改名为最终文件；改名失败等于这一份不可用。
        const renameFailure = promoteVerifiedFile(paths.partial, paths.verified)
        if (renameFailure !== null) {
          view = updateViewOf({
            channel: view.channel,
            state: 'error',
            result: 'error',
            latestVersion: current.latestVersion,
            releaseNotes: current.releaseNotes,
            message: deps.redact(renameFailure),
          })
          break
        }
        downloaded = { path: paths.verified, sha256: outcome.sha256, version: outcome.version }
        try {
          writeVerifiedRecord(updateDir, downloaded)
        } catch {
          // 记录失败只影响重启复用，不影响本次安装。
        }
        view = updateViewOf({
          channel: view.channel,
          state: 'verified',
          latestVersion: outcome.version,
          releaseNotes: current.releaseNotes,
          progressBytes: outcome.bytes,
          progressTotal: outcome.total,
          message: deps.text('msg.update-verified'),
        })
        break
      }
      case 'cancelled':
        // partial 清理是 runUpdateDownload 的产品路径（已删 destPath）。
        view = updateViewOf({
          channel: view.channel,
          state: 'available',
          latestVersion: current.latestVersion,
          releaseNotes: current.releaseNotes,
          message: deps.text('msg.update-download-cancelled'),
        })
        break
      case 'failed': {
        view = updateViewOf({
          channel: view.channel,
          state: 'error',
          result: 'error',
          latestVersion: current.latestVersion,
          releaseNotes: current.releaseNotes,
          message: deps.redact(outcome.message),
        })
        const zh = deps.zh()
        appendDesktopEvent(deps.dshHome(), {
          at: formatStampLocal(new Date().toISOString()),
          title: zh ? '更新包下载失败' : 'Update download failed',
          sections: [
            [
              zh ? '发生了什么' : 'What happened',
              zh
                ? `下载 ${current.latestVersion} 版本的更新包没有成功：${deps.redact(outcome.message)}`
                : `Downloading the ${current.latestVersion} update did not succeed: ${deps.redact(outcome.message)}`,
            ],
            [
              zh ? '现在的状态' : 'Current state',
              zh
                ? '当前安装的版本没有被改动，未通过校验的下载不会用于安装。用户可以稍后再试。'
                : 'The installed version is untouched. Unverified downloads will not be installed; the user can retry later.',
            ],
            [
              zh ? '如果用户问起' : 'If the user asks',
              zh
                ? '这多半是网络问题或更新服务器暂时不可达，不是 DeepSeekGUI 坏了，也不是用户做错了什么。现在的版本照常可用。'
                : 'This is usually a network problem or a temporarily unreachable update server — DeepSeekGUI is not broken and the user did nothing wrong. The current version keeps working.',
            ],
          ],
        }, zh)
        break
      }
    }
    deps.broadcast()
  }

  const download = async (): Promise<void> => {
    try {
      await performDownload()
    } catch (error) {
      abort?.abort()
      abort = null
      view = updateViewOf({ ...view, state: 'error', result: 'error', message: deps.redact(String(error instanceof Error ? error.message : error)) })
      try { deps.broadcast() } catch (displayError) { console.error(deps.redact(String(displayError))) }
    }
  }

  /** 把 runner 的 check 结果落进单一状态机（语义 reason 归 result 字段）。 */
  const applyCheckOutcome = (feedUrl: string | null, outcome: CheckOutcome, background: boolean): void => {
    switch (outcome.kind) {
      case 'unconfigured':
        manifest = null
        view = updateViewOf({ result: 'unconfigured' })
        return
      case 'current':
        manifest = null
        view = updateViewOf({ channel: feedUrl, result: 'current' })
        return
      case 'available': {
        // 平台没有对应资产（例如 Linux 上只有 .exe）是明确拒绝，绝不退回
        // assets[0] 去下载另一个平台的包。
        const picked = selectPlatformAsset(outcome.manifest.assets, process.platform)
        if (!picked.ok) {
          manifest = null
          view = updateViewOf({
            channel: feedUrl,
            state: 'error',
            result: 'error',
            latestVersion: outcome.manifest.latestVersion,
            releaseNotes: outcome.manifest.releaseNotes,
            message: deps.text('msg.update-no-platform-asset'),
          })
          return
        }
        manifest = outcome.manifest
        const reusable = downloaded !== null
          && shouldReuseVerifiedInstaller(downloaded.sha256, downloaded.version, picked.asset, manifest.latestVersion)
        view = updateViewOf({
          channel: feedUrl,
          state: reusable ? 'verified' : 'available',
          latestVersion: outcome.manifest.latestVersion,
          releaseNotes: outcome.manifest.releaseNotes,
        })
        if (background && balloonVersion !== outcome.manifest.latestVersion) {
          balloonVersion = outcome.manifest.latestVersion
          try {
            deps.showBalloon(
              deps.text('dialog.update-balloon.title', { version: outcome.manifest.latestVersion }),
              deps.text('dialog.update-balloon.content'),
            )
          } catch (error) { console.error(deps.redact(String(error))) }
        }
        // 自动下载：同一版本只有一个任务——busy 是唯一在跑的下载。
        if (shouldAutoDownloadUpdate({
          autoDownload,
          state: view.state,
          busy: abort !== null,
          verifiedVersion: reusable ? downloaded?.version ?? null : null,
          latestVersion: outcome.manifest.latestVersion,
        })) void download()
        return
      }
      case 'error':
        manifest = null
        view = updateViewOf({
          channel: feedUrl,
          state: background ? 'idle' : 'error',
          result: background ? null : 'error',
          message: background ? null : deps.redact(outcome.message),
        })
    }
  }

  const check = async (background: boolean): Promise<void> => {
    if (abort !== null || view.state === 'checking' || view.state === 'downloading') return
    try {
      const feedUrl = deps.readFeed()
      view = updateViewOf({ channel: feedUrl, state: 'checking' })
      deps.broadcast()
      const outcome = await runUpdateCheck(deps.runner, feedUrl, deps.appVersion, deps.zh())
      applyCheckOutcome(feedUrl, outcome, background)
      deps.broadcast()
    } catch (error) {
      manifest = null
      view = updateViewOf({ channel: view.channel, state: background ? 'idle' : 'error', result: background ? null : 'error', message: background ? null : deps.redact(String(error)) })
      try { deps.broadcast() } catch (displayError) { console.error(deps.redact(String(displayError))) }
    }
  }

  const recheckInstaller = async (): Promise<InstallerRecheck> => {
    if (downloaded === null || view.state !== 'verified') return { ok: false, reason: 'none' }
    // 安装前重新验证 digest：落盘记录恢复的文件可能在会话间被改动，绝不
    // 执行与记录不符的安装包。摘要走流式（不阻塞主线程），因此校验期间
    // 记录可能被改写——回来后先确认还是同一份记录再下结论。
    const recorded = downloaded
    const viewBefore = view
    const currentDigest = await digestInstaller(recorded.path)
    if (downloaded !== recorded || view !== viewBefore) return { ok: false, reason: 'stale' }
    if (currentDigest !== recorded.sha256) return { ok: false, reason: 'mismatch' }
    return { ok: true, file: recorded }
  }

  return {
    view: () => ({ ...view, autoDownload }),
    check,
    download,
    cancelDownload: () => {
      if (abort === null || view.state !== 'downloading') return
      abort.abort()
    },
    dismiss: () => {
      if (view.state !== 'available' && view.state !== 'verified') return
      view = updateViewOf({ channel: view.channel })
      deps.broadcast()
    },
    autoDownload: () => autoDownload,
    setAutoDownload: (next) => {
      autoDownload = next
      view = { ...view, autoDownload: next }
    },
    restoreVerified: (file, message) => {
      if (!isNewerStable(file.version, deps.appVersion)) return
      if (process.platform === 'win32' ? !/\.exe$/iu.test(file.path) : process.platform === 'linux' ? !/\.appimage$/iu.test(file.path) : true) return
      downloaded = file
      view = updateViewOf({ ...view, state: 'verified', latestVersion: file.version, message })
    },
    pendingDownload: () => {
      if (manifest === null || view.state !== 'available') return null
      // 体积报的是将要下载的那一项——按平台挑，与 download 同一把尺。
      const picked = selectPlatformAsset(manifest.assets, process.platform)
      return {
        version: manifest.latestVersion,
        sizeMb: String(Math.round((picked.ok ? picked.asset.size : 0) / 1024 / 1024)),
      }
    },
    recheckInstaller,
    noteInstallCancelled: () => {
      // 与面板的取消同一语义——回到 available 并明确提示；已验证 installer
      // 按 single-slot 策略保留。
      if (downloaded === null) return
      view = cancelledInstallView({
        channel: view.channel,
        version: downloaded.version,
        releaseNotes: manifest?.releaseNotes ?? null,
        message: deps.text('msg.update-install-cancelled'),
      })
    },
    noteMessage: (message) => { view = { ...view, message } },
  }
}
