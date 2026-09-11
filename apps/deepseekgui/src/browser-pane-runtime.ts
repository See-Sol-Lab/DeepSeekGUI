/** Electron lifecycle and proxy policy for the external browser pane. */
import type { Session, WebContents } from 'electron'

/**
 * Route every pane request, including loopback redirects, through its SSRF proxy.
 * @param session - The pane's isolated Electron Session.
 * @param proxyRules - Local SSRF proxy address.
 * @returns Completion of Chromium's proxy configuration.
 */
export function configureBrowserPaneProxy(session: Pick<Session, 'setProxy'>, proxyRules: string): Promise<void> {
  return session.setProxy({ proxyRules, proxyBypassRules: '<-loopback>' })
}

/**
 * Release a crashed pane after Electron finishes dispatching its crash event.
 * @param contents - External-page WebContents.
 * @param release - Release this exact pane if it is still owned by the window.
 */
export function releaseCrashedPane(contents: Pick<WebContents, 'once'>, release: () => void): void {
  contents.once('render-process-gone', () => { setImmediate(release) })
}
