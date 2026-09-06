/**
 * DeepSeekGUI visual patches over official components that expose no token
 * hook (the visual layer is ours to adjust; the harness layer is not). One
 * `<style>` element, removed on plugin unload.
 *
 * Stats line (2026-09-06 acceptance, restoring the v1.0.0 look): the
 * official 0.1.2 CSS dropped the `--dsh-statsline-*` hooks, so the session
 * stats row under the composer sits directly on the transparent skin and
 * long replies scroll through the text. It gets the overlay surface back as
 * a centered pill. The row is the only entry ui-chat registers into
 * `conversation.composer.dock`, and the `_sep` child is its own separator.
 */
export const SKIN_STYLE_ID = 'deepseekgui-skin'

const STATS_LINE = '[data-slot="conversation.composer.dock"] > [class*="_root"]:has(> [class*="_sep"])'

const SKIN_CSS = `
${STATS_LINE} {
  width: fit-content;
  max-width: var(--dsh-chat-content-width);
  padding: 3px 14px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
}
`

/**
 * Append the DeepSeekGUI skin patches to the document head.
 * @returns disposer removing the style element.
 */
export function installSkinStyles(): () => void {
  document.getElementById(SKIN_STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = SKIN_STYLE_ID
  style.textContent = SKIN_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
