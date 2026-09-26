/**
 * 官方账号在 DeepSeekGUI 里的主进程一侧（住户 2026-09-25 定：账号登录与首次
 * 引导改用官方那套）。
 *
 * Host 里的 workbench-inspector 每逢账号状态变化，经控制桥的 account 路由推一帧
 * `{ view, session }`：view 是官方给 UI 的安全视图，session 是只给 Host 与桌面
 * 用的平台会话（含令牌），页面永远拿不到它。这里做三件事，照官方桌面主进程：
 * - 登录尝试进入 waiting-browser 时，用系统浏览器打开授权页（每个尝试只开一次）；
 * - 尝试失败或过期时把窗口拉回前台；
 * - 持有最新的平台会话，给内嵌平台页与用量页取数用。
 *
 * 那条路由的凭证经 env 进 Harness 子进程，agent 读得到——所以推来的每个字段都
 * 当不可信输入严格校验：授权页只认官方平台的 `/dsh/authorize`，会话 origin 只认
 * 官方平台。伪造一帧最多让用量页显示「未登录」，打不开别的网址，也换不走令牌。
 * @module @see-sol-lab/deepseekgui/desktop-account
 */

/** 唯一接受的平台 origin（不支持私有部署的代理改写）。 */
export const PLATFORM_ORIGIN = 'https://platform.deepseek.com'

/** 官方授权页路径（Host 侧 browserUrl 同一规则）。 */
const AUTHORIZE_PATH = '/dsh/authorize'

/** 登录尝试的阶段（官方 SignInAttemptView.phase）。 */
export type AccountAttemptPhase =
  | 'initializing' | 'waiting-browser' | 'exchanging' | 'committing'
  | 'succeeded' | 'cancelled' | 'expired' | 'failed'

const PHASES: readonly AccountAttemptPhase[] = [
  'initializing', 'waiting-browser', 'exchanging', 'committing', 'succeeded', 'cancelled', 'expired', 'failed',
]

/** 桌面关心的账号视图（官方 AccountView 的子集）。 */
export interface DesktopAccountView {
  readonly status: 'signed-out' | 'credential-stored'
  readonly attempt: { readonly id: string; readonly phase: AccountAttemptPhase; readonly authorizeUrl?: string } | null
}

/** 平台会话：只在主进程与 Host 之间流动。 */
export interface DesktopPlatformSession {
  readonly origin: string
  readonly token: string
  readonly userId: string | null
  readonly embeddedPageDist?: string
  readonly requestHeaders?: Readonly<Record<string, string>>
}

/** 一帧已校验的账号推送。 */
export interface DesktopAccountFrame {
  readonly view: DesktopAccountView
  readonly session: DesktopPlatformSession | null
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * 授权页地址是否可以交给系统浏览器：只认官方平台 origin 与授权路径，不带凭据与片段。
 * @param value - Host 给的授权地址。
 * @returns 是否可打开。
 */
export function isAuthorizeUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  return url.origin === PLATFORM_ORIGIN && url.pathname === AUTHORIZE_PATH
    && url.username === '' && url.password === '' && url.hash === ''
}

/**
 * 严格解析一帧推送；任何字段不合规就整帧拒收。
 * @param body - 控制桥收到的 JSON。
 * @returns 已校验的帧；不合规为 null。
 */
export function parseAccountFrame(body: unknown): DesktopAccountFrame | null {
  if (!record(body) || !record(body.view)) return null
  const view = body.view
  if (view.status !== 'signed-out' && view.status !== 'credential-stored') return null
  let attempt: DesktopAccountView['attempt'] = null
  if (view.attempt !== null) {
    const raw = view.attempt
    if (!record(raw) || typeof raw.id !== 'string' || raw.id === '' || raw.id.length > 200
      || !PHASES.includes(raw.phase as AccountAttemptPhase)) return null
    if (raw.authorizeUrl !== undefined && (typeof raw.authorizeUrl !== 'string' || !isAuthorizeUrl(raw.authorizeUrl))) return null
    attempt = {
      id: raw.id,
      phase: raw.phase as AccountAttemptPhase,
      ...typeof raw.authorizeUrl === 'string' ? { authorizeUrl: raw.authorizeUrl } : {},
    }
  }
  let session: DesktopPlatformSession | null = null
  if (body.session !== null) {
    const raw = body.session
    if (!record(raw) || raw.origin !== PLATFORM_ORIGIN || typeof raw.token !== 'string'
      || raw.token === '' || raw.token.length > 8192 || /\s/u.test(raw.token)) return null
    if (raw.userId !== null && (typeof raw.userId !== 'string' || raw.userId.length > 200)) return null
    if (raw.embeddedPageDist !== undefined && (typeof raw.embeddedPageDist !== 'string' || raw.embeddedPageDist.length > 200)) return null
    let requestHeaders: Record<string, string> | undefined
    if (raw.requestHeaders !== undefined) {
      if (!record(raw.requestHeaders)) return null
      requestHeaders = {}
      for (const [name, value] of Object.entries(raw.requestHeaders)) {
        if (typeof value !== 'string' || !/^[\w-]{1,64}$/u.test(name) || /[\r\n]/u.test(value) || value.length > 4096) return null
        requestHeaders[name] = value
      }
    }
    session = {
      origin: PLATFORM_ORIGIN,
      token: raw.token,
      userId: raw.userId,
      ...typeof raw.embeddedPageDist === 'string' && raw.embeddedPageDist !== '' ? { embeddedPageDist: raw.embeddedPageDist } : {},
      ...requestHeaders === undefined ? {} : { requestHeaders },
    }
  }
  return { view: { status: view.status, attempt }, session }
}

/** 主进程注入的能力。 */
export interface DesktopAccountDeps {
  /** 用系统浏览器打开（已校验的）授权页。 */
  readonly openExternal: (url: string) => void
  /** 把主窗口拉回前台。 */
  readonly focusWindow: () => void
  /** 当前外观是否深色（授权页跟随桌面配色）。 */
  readonly dark: () => boolean
  /** 平台会话变化（内嵌平台页据此重开，用量页据此刷新）。 */
  readonly onSessionChange: (session: DesktopPlatformSession | null) => void
  /** 账号状态变化（控制模型广播用）。 */
  readonly onViewChange: () => void
}

/** 主进程里的账号状态。 */
export interface DesktopAccount {
  /** 接收一帧已校验的推送。 */
  accept(frame: DesktopAccountFrame): void
  /** 当前账号视图；Harness 还没推过为 null。 */
  view(): DesktopAccountView | null
  /** 当前平台会话；未登录或未知为 null。 */
  session(): DesktopPlatformSession | null
  /** Harness 停止或换代：旧状态作废，等新一代推送。 */
  reset(): void
}

/**
 * 建账号状态。
 * @param deps - 主进程能力。
 * @returns 状态对象。
 */
export function createDesktopAccount(deps: DesktopAccountDeps): DesktopAccount {
  let view: DesktopAccountView | null = null
  let session: DesktopPlatformSession | null = null
  let openedAttempt: string | undefined
  let returnedAttempt: string | undefined
  const sameSession = (a: DesktopPlatformSession | null, b: DesktopPlatformSession | null): boolean =>
    JSON.stringify(a) === JSON.stringify(b)
  return {
    accept(frame) {
      const previousStatus = view?.status
      view = frame.view
      if (!sameSession(session, frame.session)) {
        session = frame.session
        deps.onSessionChange(session)
      }
      const attempt = frame.view.attempt
      if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
        openedAttempt = attempt.id
        const url = new URL(attempt.authorizeUrl)
        url.searchParams.set('theme', deps.dark() ? 'dark' : 'light')
        deps.openExternal(url.href)
      }
      if ((attempt?.phase === 'failed' || attempt?.phase === 'expired') && returnedAttempt !== attempt.id) {
        returnedAttempt = attempt.id
        deps.focusWindow()
      }
      if (attempt?.phase === 'succeeded' && previousStatus !== 'credential-stored') deps.focusWindow()
      deps.onViewChange()
    },
    view: () => view,
    session: () => session,
    reset() {
      view = null
      if (session !== null) {
        session = null
        deps.onSessionChange(null)
      }
      deps.onViewChange()
    },
  }
}
