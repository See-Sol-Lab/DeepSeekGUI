/**
 * Desktop control bridge (B3-P2): the loopback channel from the official
 * page to the DeepSeekGUI main process — the same mechanism the settings
 * plugin uses. The address and one-shot credential arrive in the page URL
 * query (`deepseekgui-control=<port>.<token>`), so the bridge exists only
 * in windows DeepSeekGUI itself loaded; an external browser tab sees
 * nothing and renders no desktop actions.
 */

/** A parsed bridge address: local loopback port plus one-shot credential. */
export interface ControlBridgeAddress {
  port: string
  token: string
}

/**
 * Parse the control-bridge parameter from a page query string.
 * @param search - `window.location.search` value.
 * @returns the bridge address, or null when absent or malformed.
 */
export function parseControlBridge(search: string): ControlBridgeAddress | null {
  const match = /[?&]deepseekgui-control=([^&#]+)/.exec(search)
  if (match === null) return null
  const value = decodeURIComponent(match[1] ?? '')
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  return { port: value.slice(0, dot), token: value.slice(dot + 1) }
}

/** The harness status phases the desktop actions render. */
export type HarnessPhase =
  | 'idle' | 'stopping' | 'starting' | 'switching'
  | 'recovering' | 'running' | 'recovered' | 'failed'

/** The narrow slice of the desktop control model the actions read. */
export interface ControlModelSnapshot {
  status: { phase: HarnessPhase }
  activeProfile: string
  homeKind: 'managed' | 'existing'
  /** Content revision (P7): the next conditional fetch sends it as ?since=. */
  revision: number
  /**
   * One-shot session navigation request (B4-P8): the desktop writes it when
   * a system notification is clicked; the actions open the session and
   * remember the nonce so one request never navigates twice.
   */
  navigateRequest?: { sessionId: string; nonce: number } | null
  /** First-run guide visibility (B6-P5); absent from older desktops = hidden. */
  firstRun?: { pending: boolean } | null
  /** Desktop browser pane state (B3-11); `open` drives the Sidebar exclusion (#13). */
  browserPane?: { present: boolean; open: boolean }
}

/**
 * One conditional model fetch (P9-2): either the content moved and the full
 * snapshot rides along, or it did not and only the revision comes back. The
 * union keeps both shapes checked — no envelope is ever cast into a model.
 */
type ControlModelFetch =
  | { changed: false; revision: number }
  | { changed: true; revision: number; model: ControlModelSnapshot }

/** Bridge client: conditional model fetch plus one verified command. */
export interface ControlBridgeClient {
  /**
   * Fetch the control model, conditionally: `since` is the last seen
   * revision (null/undefined = unconditional full fetch). Unchanged content
   * answers a small `{ changed: false }` envelope.
   */
  model(since?: number | null): Promise<ControlModelFetch>
  /** Run one verified desktop command (the same exit as the Chrome menus). */
  run(command: Record<string, unknown>): Promise<ControlModelSnapshot>
}

/**
 * Read the bridge from the current page location.
 * @returns a client bound to the parsed address, or null outside DeepSeekGUI.
 */
export function readBridge(): ControlBridgeClient | null {
  const address = parseControlBridge(window.location.search)
  if (address === null) return null
  const base = `http://127.0.0.1:${address.port}`
  return {
    async model(since) {
      const query = typeof since === 'number' ? `?since=${String(since)}` : ''
      const r = await fetch(`${base}/control/model${query}`, { headers: { 'x-deepseekgui-control-token': address.token } })
      if (!r.ok) throw new Error(`HTTP ${String(r.status)}`)
      const body = await r.json() as { revision?: unknown; changed?: unknown; model?: ControlModelSnapshot }
      if (typeof body.revision !== 'number') throw new Error('control bridge: envelope carries no revision')
      if (body.changed === false) return { changed: false, revision: body.revision }
      if (body.model === undefined) throw new Error('control bridge: changed envelope carries no model')
      return { changed: true, revision: body.revision, model: body.model }
    },
    async run(command) {
      const r = await fetch(`${base}/control/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': address.token },
        body: JSON.stringify({ command }),
      })
      const body = await r.json().catch(() => ({})) as { error?: unknown; model?: unknown }
      if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(r.status)}`)
      return body.model as ControlModelSnapshot
    },
  }
}
