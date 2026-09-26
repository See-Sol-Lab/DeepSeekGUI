/**
 * Desktop control bridge, the narrow slice the skills page needs: the same
 * loopback channel the settings plugin uses, addressed by the
 * `deepseekgui-control=<port>.<token>` query the DeepSeekGUI window puts
 * in the page URL. Outside that window there is no bridge and the page
 * falls back to a typed path.
 */

/** A parsed bridge address: local loopback port plus one-shot credential. */
export interface ControlBridgeAddress {
  port: string
  token: string
}

/** What one `skill-pick-source` command brings back in the model. */
export interface SkillPickSnapshot {
  nonce: number
  kind: 'directory' | 'file'
  path: string | null
}

/** The slice of the control model this page reads. */
export interface SkillsControlModel {
  skillPick?: SkillPickSnapshot | null
}

/** Bridge client: one verified command, answered with the model snapshot. */
export interface ControlBridgeClient {
  run(command: Record<string, unknown>): Promise<SkillsControlModel>
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

/**
 * Read the bridge from the current page location.
 * @returns a client bound to the parsed address, or null outside DeepSeekGUI.
 */
export function readBridge(): ControlBridgeClient | null {
  const address = parseControlBridge(window.location.search)
  if (address === null) return null
  const base = `http://127.0.0.1:${address.port}`
  return {
    async run(command) {
      const r = await fetch(`${base}/control/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': address.token },
        body: JSON.stringify({ command }),
      })
      const body = await r.json().catch(() => ({})) as { error?: unknown; model?: unknown }
      if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(r.status)}`)
      return (body.model ?? {}) as SkillsControlModel
    },
  }
}

/**
 * Ask the desktop for a source path through its system dialog.
 * @param bridge - the control bridge.
 * @param kind - a skill directory, or a ZIP / Markdown file.
 * @returns the chosen absolute path, or null when the person cancelled.
 */
export async function pickSource(bridge: ControlBridgeClient, kind: 'directory' | 'file'): Promise<string | null> {
  const model = await bridge.run({ type: 'skill-pick-source', kind })
  const pick = model.skillPick
  if (pick === undefined || pick === null || pick.kind !== kind) return null
  return pick.path
}
