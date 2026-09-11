/**
 * DeepSeekGUI visual patches over official components that expose no token
 * hook (the visual layer is ours to adjust; the harness layer is not). One
 * `<style>` element, removed on plugin unload.
 *
 * Stats line (2026-09-06 acceptance, restoring the v1.0.0 look): the official
 * CSS exposes no opaque surface for the session stats row under the composer,
 * so it sits directly on the transparent skin and long replies scroll through
 * the text. It gets the overlay surface back as a centered pill.
 *
 * dsh 0.1.5 replaced that row with StatsPills: `.root` (marked
 * `data-composer-stats`) holds two `.anchor` > `.pill` pairs, every one of them
 * `background: transparent`, so the overlap this patch fixes is still present.
 * The first port of the selector aimed at `_anchor` as a direct child of the
 * dock slot; the anchors sit one level deeper, so nothing matched and the mask
 * quietly disappeared (2026-09-11 manual test #7). The row's own stable
 * attribute is the hook now: the whole two-pill row becomes one pill.
 *
 * Right Sidebar in fullscreen (2026-09-11 manual tests #6 and #12): the
 * official fullscreen shell is `position: fixed; inset: 0` painted with the
 * base background token — which the theme makes transparent so the desktop
 * backdrop shows through (the skin-tokens guard below keeps that token's
 * name out of this file on purpose). Docked, the panel sits in its own column and the
 * transparency is harmless; fullscreen, the whole frame shows through it,
 * so the file tree lands on top of the left column ("the Sidebar flew to the
 * left"). Fullscreen is remembered per session, which is why a Sidebar
 * reopened after a chat looked the same way. The panel gets the reading
 * surface the settings dialog uses, plus a blur for the last few percent.
 */
const SKIN_STYLE_ID = 'deepseekgui-skin'

const STATS_LINE = '[data-slot="conversation.composer.dock"] [data-composer-stats]'

const SIDEBAR_FULLSCREEN = '[data-sidebar-right-panel="fullscreen"]'

const SKIN_CSS = `
${STATS_LINE} {
  width: fit-content;
  padding: 3px 14px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
}
${SIDEBAR_FULLSCREEN} {
  background: var(--dsw-alias-bg-layer-2);
  backdrop-filter: blur(12px);
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
