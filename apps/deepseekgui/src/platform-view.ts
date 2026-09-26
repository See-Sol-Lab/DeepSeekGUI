/**
 * 内嵌平台页（充值、用量）：官方桌面 `apps/desktop/src/platform-view.ts`（0.1.7-rc.2）
 * 的移植，住户 2026-09-25 定「充值也一起做」。
 *
 * 平台页开在一个独立的 WebContentsView 里：沙箱、上下文隔离、无 Node；preload
 * （platform-preload.cts）只在平台 origin 的主框架里向 main 要一次令牌与语言，
 * 交给平台前端的嵌入模式（`window.dsh.getAuthToken()`），用户不用在这里再登录一次。
 * 会话分区按账号区分并在每次关闭时清掉登录态，令牌只活在这个视图里。
 *
 * 与官方的两处不同：
 * - 官方的应用页面铺满整个窗口；我们的官方页面在自己的 WebContentsView 里，所以
 *   「宿主」拆成窗口（挂子视图、窗口关闭）与页面（导航、崩溃）两个对象；
 * - 请求头按官方 platformClientHeaders 的形状内联，平台身份报 `web`（DeepSeekGUI
 *   不是官方桌面，不冒充 desktop-win），版本报内嵌 DSH 的版本。
 * @module @see-sol-lab/deepseekgui/platform-view
 */

import { createHash, randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { WebContentsView, session, shell, type Session, type View, type WebFrameMain } from 'electron'
import type { DesktopPlatformSession } from './desktop-account.ts'

/** preload 与 main 之间的私有通道。 */
export const PLATFORM_IPC = {
  bootstrap: 'deepseekgui-platform:bootstrap',
  localeChanged: 'deepseekgui-platform:locale-changed',
} as const

/** 平台页的语言。 */
export type PlatformLocale = 'en_US' | 'zh_CN'

/** 允许打开的平台页。 */
export type PlatformPage = 'usage' | 'top-up'

/** 窗口内容坐标下的矩形。 */
export interface PlatformBounds { x: number; y: number; width: number; height: number }

/**
 * 校验页面给的矩形。
 * @param value - 请求体里的 bounds。
 * @returns 取整后的非负有限坐标。
 */
export function platformBounds(value: unknown): PlatformBounds {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Platform bounds')
  const row = value as Record<string, unknown>
  const result: PlatformBounds = { x: 0, y: 0, width: 0, height: 0 }
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = row[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100_000) throw new Error('Invalid Platform bounds')
    result[key] = Math.round(n)
  }
  return result
}

/**
 * 合并 Cookie 头（同名以 override 为准，其余保留）——官方 mergePlatformCookies 的内联版。
 * @param base - 请求原有的 Cookie。
 * @param override - 部署要求的 Cookie。
 * @returns 合并后的 Cookie 头。
 */
export function mergePlatformCookies(base: string, override: string): string {
  const cookies = new Map<string, string>()
  for (const header of [base, override]) {
    for (const pair of header.split(';')) {
      const separator = pair.indexOf('=')
      if (separator < 1) continue
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
}

/**
 * 发往平台的客户端身份头（官方 platformClientHeaders 的形状）。
 * @param version - 内嵌 DSH 版本。
 * @param locale - 平台语言。
 * @returns 请求头。
 */
export function platformClientHeaders(version: string, locale: PlatformLocale): Record<string, string> {
  return {
    'x-client-bundle-id': '',
    'x-client-platform': 'web',
    'x-client-version': version,
    'x-client-locale': locale,
    // Date.getTimezoneOffset 是「UTC 以西的分钟数」，平台要「UTC 以东的秒数」。
    'x-client-timezone-offset': String(-new Date().getTimezoneOffset() * 60),
  }
}

/** 视图所在的窗口：挂子视图、窗口关闭。 */
type PlatformWindow = Pick<EventEmitter, 'on' | 'removeListener'> & {
  contentView: Pick<View, 'addChildView' | 'removeChildView'>
  isDestroyed(): boolean
}

/** 发起请求的官方页面：它导航、崩溃或销毁时平台页随之关闭。 */
type PlatformPageOwner = Pick<EventEmitter, 'on' | 'removeListener'>

type PlatformSender = { sender: object; senderFrame: Pick<WebFrameMain, 'url'> | null }

/** 原生平台页与它的会话快照同生共死。 */
export class DesktopPlatformView {
  private account: DesktopPlatformSession | null = null
  private view: WebContentsView | undefined
  private window: PlatformWindow | undefined
  private releaseOwner: (() => void) | undefined
  private generation = 0
  private readonly storageCleanup = new Map<Session, Promise<{ error: unknown } | null>>()
  private disposed = false

  /**
   * @param preload - 平台页 preload 的路径。
   * @param getLocale - 当前桌面语言。
   * @param version - 内嵌 DSH 版本（报给平台）。
   */
  constructor(private readonly preload: string, private readonly getLocale: () => PlatformLocale,
    private readonly version: string) {}

  /** 当前是否有平台页开着。 */
  isOpen(): boolean { return this.view !== undefined }

  /** 当前会话是否可用（未登录时页面不该请求打开）。 */
  hasSession(): boolean { return this.account !== null }

  /** @param next - Host 推来的平台会话；只补全身份时保留已开的临时页。 */
  setSession(next: DesktopPlatformSession | null): void {
    if (next?.token === this.account?.token && next?.origin === this.account?.origin
      && next?.embeddedPageDist === this.account?.embeddedPageDist
      && JSON.stringify(next?.requestHeaders) === JSON.stringify(this.account?.requestHeaders)) {
      if (next?.userId === this.account?.userId || this.account?.userId === null) {
        this.account = next
        return
      }
    }
    this.close()
    this.account = next
  }

  /**
   * 打开平台页：有账号 ID 用该账号的持久分区（页面偏好可保留），否则用临时分区。
   * @param window - 挂视图的窗口。
   * @param page - 发起请求的官方页面。
   * @param target - 要打开的平台页。
   * @param bounds - 窗口内容坐标下的矩形。
   * @returns 加载完成；被新请求取代、窗口关闭或页面导航时提前返回。
   */
  async open(window: PlatformWindow, page: PlatformPageOwner, target: PlatformPage, bounds: PlatformBounds): Promise<void> {
    if (this.disposed) throw new Error('Platform view disposed')
    this.close()
    const account = this.account
    if (account === null) throw new Error('Platform account unavailable')
    if (window.isDestroyed()) return
    const generation = this.generation
    this.window = window
    const closeOwnedView = (): void => { if (generation === this.generation) this.close() }
    const navigateOwner = (_event: unknown, _url: string, isInPlace: boolean, isMainFrame: boolean): void => {
      if (isMainFrame && !isInPlace) closeOwnedView()
    }
    page.on('did-start-navigation', navigateOwner)
    page.on('render-process-gone', closeOwnedView)
    page.on('destroyed', closeOwnedView)
    window.on('closed', closeOwnedView)
    this.releaseOwner = () => {
      page.removeListener('did-start-navigation', navigateOwner)
      page.removeListener('render-process-gone', closeOwnedView)
      page.removeListener('destroyed', closeOwnedView)
      window.removeListener('closed', closeOwnedView)
    }
    const partition = account.userId === null ? `deepseekgui-platform-${randomUUID()}`
      : `persist:deepseekgui-platform-${createHash('sha256').update(JSON.stringify([account.origin, account.userId])).digest('hex')}`
    const browserSession = session.fromPartition(partition)
    // 上次非正常退出也可能留下登录态：打开前先清一遍。
    const failure = await this.cleanStorage(browserSession)
    if (generation !== this.generation) return
    if (failure !== null) {
      this.close()
      throw failure.error
    }
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
    const deploymentHeaders = account.requestHeaders ?? {}
    const injectedNames = new Set([...Object.keys(deploymentHeaders), ...Object.keys(platformClientHeaders(this.version, this.getLocale()))]
      .map(name => name.toLowerCase()))
    const injectedRequests = new Set<number>()
    browserSession.webRequest.onCompleted((details) => { injectedRequests.delete(details.id) })
    browserSession.webRequest.onErrorOccurred((details) => { injectedRequests.delete(details.id) })
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      let headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]))
      if (new URL(details.url).origin === account.origin) {
        injectedRequests.add(details.id)
        const injected: Record<string, string> = { ...deploymentHeaders, ...platformClientHeaders(this.version, this.getLocale()) }
        const cookie = headers.cookie ?? ''
        Object.assign(headers, injected)
        if (injected.cookie !== undefined) headers.cookie = mergePlatformCookies(cookie, injected.cookie)
      } else if (injectedRequests.has(details.id)) {
        // 重定向到别的 origin 的子资源不得带着注入的头走。
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !injectedNames.has(name.toLowerCase())))
      }
      callback({ requestHeaders: headers })
    })
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, preload: this.preload, sandbox: true, contextIsolation: true,
      additionalArguments: [`--deepseekgui-platform-origin=${account.origin}`],
      nodeIntegration: false, webSecurity: true,
    } })
    this.view = view
    // 支付、文档等外部页面走系统浏览器，不带内嵌会话与令牌。
    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const destination = new URL(url)
        if (destination.protocol === 'https:' && !destination.username && !destination.password) {
          void shell.openExternal(url).catch(() => { /* 浏览器没起来：内嵌页仍可重试 */ })
        }
      } catch { /* 非法地址：直接拒绝 */ }
      return { action: 'deny' }
    })
    const allowNavigation = (url: string): boolean => {
      try {
        const parsed = new URL(url)
        return parsed.origin === account.origin && !parsed.username && !parsed.password
      } catch { return false }
    }
    view.webContents.on('will-navigate', (event, url) => { if (!allowNavigation(url)) event.preventDefault() })
    view.webContents.on('will-redirect', (event, url) => { if (!allowNavigation(url)) event.preventDefault() })
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
    view.webContents.on('preload-error', () => { if (this.view === view) this.close() })
    view.webContents.on('render-process-gone', () => { if (this.view === view) this.close() })
    view.setVisible(false)
    window.contentView.addChildView(view)
    view.setBounds(bounds)
    try {
      const url = new URL(target === 'usage' ? '/usage' : '/top_up', account.origin)
      if (account.embeddedPageDist !== undefined) url.searchParams.set('dist', account.embeddedPageDist)
      await view.webContents.loadURL(url.href)
    } catch (error) {
      // 平台页可能在首次加载完成前替换自己的 URL（比如消费掉 dist 参数），loadURL
      // 会以 ERR_ABORTED 结束而不是加载失败：视图照常保留。
      const aborted = error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED'
      if (!aborted) {
        if (generation === this.generation) this.close()
        throw error
      }
    }
    if (generation === this.generation && this.view === view) view.setVisible(true)
  }

  /** @param bounds - 新的窗口内容坐标矩形。 */
  setBounds(bounds: PlatformBounds): void { this.view?.setBounds(bounds) }

  /**
   * 只把令牌与语言交给当前平台页的主框架。
   * @param event - Electron 给的发送方身份。
   * @returns 令牌、origin 与语言。
   */
  bootstrap(event: PlatformSender): { origin: string; token: string; locale: PlatformLocale } {
    const view = this.view
    const account = this.account
    if (view === undefined || account === null || event.sender !== view.webContents
      || event.senderFrame !== view.webContents.mainFrame || new URL(event.senderFrame.url).origin !== account.origin) {
      throw new Error('Rejected Platform bootstrap')
    }
    return { origin: account.origin, token: account.token, locale: this.getLocale() }
  }

  /** 桌面语言变了：通知当前平台页。 */
  notifyLocaleChanged(): void {
    const view = this.view
    if (view !== undefined && !view.webContents.isDestroyed()) view.webContents.send(PLATFORM_IPC.localeChanged, this.getLocale())
  }

  /** 销毁平台页并清掉登录态；按账号保存的页面偏好下次还在。 */
  close(): void {
    this.generation++
    const view = this.view
    this.view = undefined
    this.releaseOwner?.()
    this.releaseOwner = undefined
    const window = this.window
    this.window = undefined
    if (view === undefined) return
    if (window !== undefined && !window.isDestroyed()) window.contentView.removeChildView(view)
    const browserSession = view.webContents.session
    const destroyed = new Promise<void>((resolve) => {
      if (view.webContents.isDestroyed()) resolve()
      else {
        view.webContents.once('destroyed', () => { resolve() })
        view.webContents.close({ waitForBeforeUnload: false })
      }
    })
    browserSession.webRequest.onBeforeSendHeaders(null)
    browserSession.webRequest.onCompleted(null)
    browserSession.webRequest.onErrorOccurred(null)
    browserSession.flushStorageData()
    void this.cleanStorage(browserSession, destroyed)
  }

  /** 不再接受新页面，并等所有清理完成（退出、安装更新前）。 */
  async dispose(): Promise<void> {
    this.disposed = true
    this.account = null
    this.close()
    const results = await Promise.all(this.storageCleanup.values())
    const failures = results.filter(result => result !== null)
    if (failures.length > 0) throw new AggregateError(failures.map(result => result.error), 'Platform storage cleanup failed')
  }

  private cleanStorage(browserSession: Session, destroyed: Promise<void> = Promise.resolve()): Promise<{ error: unknown } | null> {
    const previous = this.storageCleanup.get(browserSession)
    const cleanup = Promise.all([previous, destroyed]).then(async () => {
      await browserSession.closeAllConnections()
      const results = await Promise.allSettled([
        browserSession.clearStorageData(browserSession.isPersistent()
          ? { storages: ['cookies', 'filesystem', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'] } : undefined),
        browserSession.clearCache(),
        browserSession.clearAuthCache(),
      ])
      const failures = results.filter(result => result.status === 'rejected')
      if (failures.length > 0) throw new AggregateError(failures.map((result): unknown => result.reason), 'Platform storage cleanup failed')
    }).then(() => null, (error: unknown) => ({ error }))
    this.storageCleanup.set(browserSession, cleanup)
    return cleanup
  }
}
