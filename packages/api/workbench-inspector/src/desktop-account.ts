/**
 * DeepSeekGUI desktop account bridge: the Host half of running the official
 * account UI inside the DeepSeekGUI window.
 *
 * The official account settings, sign-in and onboarding register only when the
 * page carries the official Desktop's `dshDesktop` carrier, and the native
 * Platform view needs a `dshPlatform` bridge before those plugins apply. A
 * plugin cannot run earlier than the official roster, so the Host adds one
 * classic script to the served index: it installs these globals only in a page
 * DeepSeekGUI itself loaded (the URL carries its control-bridge parameter), so
 * an external browser tab or `dsh web` stays plain Web. The same script also
 * provides `dshOnboarding` — the official Desktop onboarding asks it whether any
 * API key is configured (the official welcome backend's reading, over the page's
 * own same-origin Harness RPC), and DeepSeekGUI's welcome overlay saves the key
 * through it.
 *
 * The second half mirrors the official Desktop Host's platform-session
 * publisher: every account snapshot, with the Host-only Platform session, goes
 * to the DeepSeekGUI main process over its loopback bridge, whose address and
 * credential arrive in `DEEPSEEKGUI_ACCOUNT_BRIDGE`. The page never receives the
 * token. Without that variable (any launch not made by DeepSeekGUI) nothing
 * here runs.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { AccountView, DeepSeekAccount, PlatformSession } from '@deepseek-ai/dsh-deepseek-account'

/** Environment variable naming the main-process account route: `host:port#token`. */
export const ACCOUNT_BRIDGE_ENV = 'DEEPSEEKGUI_ACCOUNT_BRIDGE'

/** One pushed account frame: the UI-safe view plus the Host-only Platform session. */
export interface DesktopAccountFrame {
  readonly view: AccountView
  readonly session: PlatformSession | null
}

/**
 * The page script. It runs before every official client script, so the
 * account plugins find both carriers when they apply. `dshPlatform` forwards to
 * the desktop's control bridge with the page's own control credential.
 */
export const DESKTOP_ACCOUNT_SHIM = `(() => {
  const match = /[?&]deepseekgui-control=([^&#]+)/.exec(location.search)
  if (match === null) return
  const value = decodeURIComponent(match[1])
  const dot = value.indexOf('.')
  if (dot <= 0) return
  const base = 'http://127.0.0.1:' + value.slice(0, dot)
  const token = value.slice(dot + 1)
  const send = async (request) => {
    const response = await fetch(base + '/control/platform', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': token },
      body: JSON.stringify(request),
    })
    if (!response.ok) throw new Error('DeepSeekGUI Platform view: HTTP ' + response.status)
  }
  const bounds = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  const record = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const rpc = async (method, args) => {
    const rpcId = crypto.randomUUID()
    const response = await fetch('/api/' + method, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    if (!response.ok) throw new Error('DeepSeekGUI onboarding: HTTP ' + response.status)
    const envelope = await response.json()
    if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
      || !record(envelope.result) || envelope.result.ok !== true) throw new Error('DeepSeekGUI onboarding: RPC failed')
    return envelope.result.value
  }
  const officialRef = async () => {
    const settings = await rpc('settings/describe', {})
    if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('DeepSeekGUI onboarding: no settings')
    const official = settings.namespaces.find(item => record(item) && item.ns === 'llm-deepseek')
    const ref = record(official) && record(official.value) && typeof official.value.apiKeyEnv === 'string' ? official.value.apiKeyEnv : undefined
    return { namespaces: settings.namespaces, ref }
  }
  Object.defineProperty(globalThis, 'dshDesktop', { value: Object.freeze({ shell: 'deepseekgui' }) })
  Object.defineProperty(globalThis, 'dshPlatform', { value: Object.freeze({
    open: (page, rect) => send({ type: 'open', page, bounds: bounds(rect) }),
    setBounds: (rect) => send({ type: 'bounds', bounds: bounds(rect) }),
    close: () => send({ type: 'close' }),
  }) })
  Object.defineProperty(globalThis, 'dshOnboarding', { value: Object.freeze({
    // The official Desktop tells its main process while onboarding shows;
    // DeepSeekGUI has nothing to change then, but the official entry calls it.
    setActive() {},
    async hasApiKey() {
      const { namespaces, ref } = await officialRef()
      const providers = await rpc('llm/listConfigurableProviders', {})
      if (!Array.isArray(providers)) throw new Error('DeepSeekGUI onboarding: no providers')
      const refs = providers.flatMap((provider) => {
        if (!record(provider) || typeof provider.settingsNs !== 'string' || !Array.isArray(provider.settingsPath)) return []
        const ns = namespaces.find(item => record(item) && item.ns === provider.settingsNs)
        let v = record(ns) ? ns.value : undefined
        for (const key of provider.settingsPath) v = record(v) && typeof key === 'string' ? v[key] : undefined
        return record(v) && typeof v.apiKeyEnv === 'string' ? [v.apiKeyEnv] : []
      })
      const unique = [...new Set([...(ref === undefined ? [] : [ref]), ...refs])]
      const states = {}
      for (let offset = 0; offset < unique.length; offset += 64) {
        Object.assign(states, await rpc('credentials/describe', { refs: unique.slice(offset, offset + 64) }))
      }
      return Object.values(states).some(v => record(v) && v.configured === true)
    },
    async saveApiKey(value) {
      if (typeof value !== 'string' || !/^[\\x21-\\x7e]+$/.test(value)) return false
      try {
        const { ref } = await officialRef()
        if (ref === undefined) return false
        await rpc('credentials/set', { ref, value })
        return true
      } catch { return false }
    },
  }) })
})()`

/**
 * Parse `host:port#token`.
 * @param raw - environment value.
 * @returns the route, or undefined when absent or malformed.
 */
export function parseAccountBridge(raw: string | undefined): { url: string; token: string } | undefined {
  const match = raw === undefined ? null : /^(127\.0\.0\.1:\d{1,5})#(.+)$/u.exec(raw)
  if (match === null) return undefined
  return { url: `http://${match[1]}/control/account`, token: match[2] as string }
}

/** Where the bridge route survives a plugin reload inside the same Host process. */
const BRIDGE_SLOT = Symbol.for('deepseekgui.accountBridge')

/**
 * Take the bridge route out of the environment, once per Host process.
 *
 * The agent's commands inherit this process's environment. A route left there
 * would let a prompt-injected agent push its own account frame — a Platform
 * token for someone else's account behind the Top up page, or a crafted
 * authorization link — so the route is read at the first install, kept in
 * memory, and deleted from the environment before any session can start a
 * command.
 * @param env - the process environment.
 * @returns the route, or undefined when DeepSeekGUI did not launch this Host.
 */
export function takeAccountBridge(env: NodeJS.ProcessEnv): { url: string; token: string } | undefined {
  const holder = globalThis as { [BRIDGE_SLOT]?: { url: string; token: string } | undefined }
  const raw = env[ACCOUNT_BRIDGE_ENV]
  // Delete-and-check keeps the variable out of `env` even when it is malformed.
  Reflect.deleteProperty(env, ACCOUNT_BRIDGE_ENV)
  if (raw !== undefined) holder[BRIDGE_SLOT] = parseAccountBridge(raw)
  return holder[BRIDGE_SLOT]
}

/**
 * Install the page shim and the account publisher when DeepSeekGUI launched this Host.
 * @param ctx - Host context of the inspector plugin.
 * @param env - process environment (injected for tests).
 * @param post - HTTP sender (injected for tests).
 */
export function installDesktopAccountBridge(
  ctx: Context,
  env: NodeJS.ProcessEnv = process.env,
  post: typeof fetch = fetch,
): void {
  const bridge = takeAccountBridge(env)
  if (bridge === undefined) return
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'script', placement: 'head', text: DESKTOP_ACCOUNT_SHIM })
  })
  const push = async (frame: DesktopAccountFrame): Promise<void> => {
    try {
      const response = await post(bridge.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': bridge.token },
        body: JSON.stringify(frame),
        redirect: 'error',
      })
      if (!response.ok) ctx.logger('deepseekgui-account').warn(`desktop refused the account frame: HTTP ${String(response.status)}`)
    } catch {
      ctx.logger('deepseekgui-account').warn('desktop account bridge unreachable')
    }
  }
  ctx.inject(['deepseekAccount'], (accountCtx) => {
    const account: DeepSeekAccount = accountCtx.deepseekAccount
    accountCtx.effect(() => {
      const lifetime = new AbortController()
      const updates = (async () => {
        try {
          for await (const view of account.watch(lifetime.signal)) {
            if (lifetime.signal.aborted) break
            // Identity enrichment also arrives as a frame, so the session is
            // re-read on every one (the official publisher does the same).
            const session = await account.getPlatformSession()
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disposal can abort during the credential read.
            if (!lifetime.signal.aborted) await push({ view, session })
          }
        } catch {
          if (!lifetime.signal.aborted) accountCtx.logger('deepseekgui-account').warn('account subscription failed')
        }
      })()
      return async () => {
        lifetime.abort()
        await updates
      }
    }, 'deepseekgui: desktop account publisher')
  })
}
