/**
 * DeepSeekGUI streaming-prose display (B6-P4).
 *
 * The Workbench composes the optional `chatTextDisplay` service the official
 * chat view consults once per frame while an assistant text block streams.
 * Only the paint increment is scheduled: the Session log, the projection, tool
 * events, approvals, and errors keep their exact arrival order, and settled
 * text is authoritative immediately. Composing this plugin out leaves the
 * chat view on its authoritative-text path.
 *
 * @module @see-sol-lab/deepseekgui-workbench/client/text-display
 */
import { DEFAULT_SMOOTH_TEXT, SmoothedTextDisplay } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatTextDisplay } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Service name the official chat view resolves per frame. */
export const CHAT_TEXT_DISPLAY_SERVICE = 'chatTextDisplay'

/**
 * Compose the DeepSeekGUI prose smoother into the client context.
 * @param ctx - client context whose `provide` publishes the service.
 * @returns disposer dropping every schedule.
 */
export function installTextDisplay(ctx: { provide(name: string, value: unknown): void }): () => void {
  const display = new SmoothedTextDisplay(DEFAULT_SMOOTH_TEXT)
  const service: ChatTextDisplay = {
    display: input => display.display(input),
    release: (key) => { display.release(key) },
  }
  ctx.provide(CHAT_TEXT_DISPLAY_SERVICE, service)
  return () => { display.reset() }
}
