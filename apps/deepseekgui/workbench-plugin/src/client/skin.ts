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
 * reopened after a chat looked the same way. The open fullscreen panel gets
 * the reading surface the settings dialog uses over an opaque frost ground
 * (see SIDEBAR_FULLSCREEN below for why the ground is a ::before).
 */
const SKIN_STYLE_ID = 'deepseekgui-skin'

const STATS_LINE = '[data-slot="conversation.composer.dock"] [data-composer-stats]'

/*
 * The fullscreen right panel covers the conversation at the dock layer (40).
 * Its ground is a ::before one layer below the docked panes: a backdrop-filter
 * on the panel itself made the panel a stacking context at level 0, so the
 * new-session hero (z-index 1) painted over it (found 2026-09-24), and it
 * would also turn the panel into the containing block of the floating panes
 * the kit keeps fixed. The ground is the opaque frost, so no crisp text shows through.
 * Only while open: a narrow window (the browser pane slid in) keeps the
 * fullscreen presentation on a collapsed panel too, and the ground used to
 * frost the whole conversation then.
 */
const SIDEBAR_FULLSCREEN = '[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]'

/*
 * Glass pass (2026-09-16, 住户定：质感 / 克制 / 呼吸感). The theme-plugin
 * already makes the big surfaces translucent (tokens); this layer adds what
 * a token cannot express — frosted blur, the 1px top highlight that reads as
 * a glass edge, soft diffuse elevation, and eased state changes. Only two
 * large surfaces blur (sidebar column, composer card): backdrop-filter is a
 * GPU cost per element, and message bubbles are many, so they stay
 * translucent without blur. Hooks are the official slot / composer / theme
 * attributes, never the hashed module class names.
 */
const SIDEBAR = '[data-slot="sidebar"]'
const COMPOSER_CARD = '[data-composer-card]'
const DARK = 'body[data-ds-dark-theme]'
const GLASS_BLUR = 'blur(24px) saturate(140%)'
/** The frost filter (see FROST_CSS): opaque ground under the blur, so crisp text cannot leak through. */
const FROST_FILTER_ID = 'deepseekgui-composer-frost-filter'
const GLASS_FROST = `url(#${FROST_FILTER_ID}-f)`
/*
 * Pop-up layers (batch 3). All three ARIA roles sit on the painted surface
 * itself in the official components (Tooltip bubble, Menu list, Modal /
 * Settings panel), never on a mask, so elevation here is safe. Blur only on
 * menus and dialogs: they portal to body. Tooltips are fixed elements inside
 * overflow-hidden containers and Chromium clips their backdrop sample to
 * that ancestor, so they stay opaque (token layer) with highlight + shadow.
 */
const TOOLTIP = '[role="tooltip"]'
const MENU = '[role="menu"]'
const DIALOG = '[role="dialog"]'

/*
 * Bottom clearance for our own tabs (住户 2026-09-22). Our views scroll inside
 * the view area while the composer seat keeps the floor of the scroller, so a
 * view's last lines end up behind the card and read through its translucent
 * fill (measured: the memory view's box ran 120px past the card's top edge).
 * The seat's own ResizeObserver publishes its height on the scroller as
 * --dsh-composer-height; this turns it into the inset our shared view style
 * reserves. The variable only reaches our own views — the official Chat
 * transcript does not read it — so nothing else grows a gap.
 */
const CONVERSATION_SCROLLER = '[data-conversation-scroll]'

const SKIN_CSS = `
${CONVERSATION_SCROLLER} {
  --deepseekgui-view-bottom-inset: calc(var(--dsh-composer-height, 0px) + 16px);
}
${STATS_LINE} {
  width: fit-content;
  padding: 3px 14px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}
${DARK} ${STATS_LINE} {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
${SIDEBAR_FULLSCREEN}::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: calc(var(--dsh-dockkit-dock-layer) - 1);
  pointer-events: none;
  background: var(--dsw-alias-bg-layer-2);
  backdrop-filter: ${GLASS_FROST};
}
/*
 * No backdrop-filter on the sidebar column: the wallpaper behind it lives in
 * another WebContentsView, so there is nothing in this page for it to blur —
 * and a backdrop-filter makes the element a backdrop root, which stopped the
 * workspace HoverCard (rendered inside the sidebar) from blurring the
 * conversation text it floats over. Its glass is the translucent fill token.
 */
${SIDEBAR} [role="treeitem"],
${SIDEBAR} button {
  transition: background-color 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
}
/*
 * No backdrop-filter on the composer card or the stats pill: both live in
 * the official composer seat, which is position: sticky inside the chat
 * scroller, and Chromium samples a sticky element's backdrop at its unstuck
 * layout position — the blur lands on the wrong band while the text under
 * the card stays crisp (measured 2026-09-16; a lower alpha then just leaks
 * text). Their glass is the translucent fill plus highlight and elevation.
 */
${COMPOSER_CARD} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 0 0.5px rgba(0, 0, 0, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.06);
  transition: box-shadow 180ms ease;
}
${COMPOSER_CARD}:focus-within {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 0 1px rgba(77, 107, 254, 0.32),
    0 0 0 3px rgba(77, 107, 254, 0.05),
    0 12px 32px rgba(0, 0, 0, 0.06);
}
${DARK} ${COMPOSER_CARD} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 0 0 0.5px rgba(255, 255, 255, 0.08),
    0 12px 32px rgba(0, 0, 0, 0.32);
}
${DARK} ${COMPOSER_CARD}:focus-within {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.10),
    0 0 0 1px rgba(103, 153, 254, 0.38),
    0 0 0 3px rgba(103, 153, 254, 0.06),
    0 12px 32px rgba(0, 0, 0, 0.32);
}
::-webkit-scrollbar-thumb {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.38);
}
${DARK} ::-webkit-scrollbar-thumb {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10);
}
${TOOLTIP} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 0 0.5px rgba(38, 49, 72, 0.10),
    0 8px 24px rgba(38, 49, 72, 0.10);
}
${DARK} ${TOOLTIP} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 0.5px rgba(255, 255, 255, 0.08),
    0 8px 24px rgba(0, 0, 0, 0.40);
}
${MENU} {
  /* Frost, not a plain blur: at a 0.84 fill the transcript read straight
     through (side-by-side 2026-09-23). Dialogs keep the plain blur — 0.90
     fill over the modal mask showed next to no difference. */
  -webkit-backdrop-filter: ${GLASS_FROST};
  backdrop-filter: ${GLASS_FROST};
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 0 0 0.5px rgba(38, 49, 72, 0.08),
    0 12px 32px rgba(38, 49, 72, 0.10);
  animation: dsg-pop-in 120ms ease-out;
}
${DARK} ${MENU} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 0.5px rgba(255, 255, 255, 0.08),
    0 12px 32px rgba(0, 0, 0, 0.45);
}
${DIALOG} {
  -webkit-backdrop-filter: ${GLASS_BLUR};
  backdrop-filter: ${GLASS_BLUR};
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.7),
    0 0 0 0.5px rgba(38, 49, 72, 0.08),
    0 24px 64px rgba(38, 49, 72, 0.14);
  animation: dsg-pop-in 140ms ease-out;
}
${DARK} ${DIALOG} {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0 0 0.5px rgba(255, 255, 255, 0.08),
    0 24px 64px rgba(0, 0, 0, 0.5);
}
.dsg-btn {
  --dsg-btn-bg: var(--dsw-alias-button-elevated-fill);
  --dsg-btn-border: var(--dsw-alias-border-l3);
}
.dsg-btn:hover:not(:disabled) {
  --dsg-btn-bg: var(--dsw-alias-button-floating-hover);
  --dsg-btn-border: var(--dsw-alias-border-l4);
}
.dsg-btn:active:not(:disabled) {
  --dsg-btn-bg: var(--dsw-alias-interactive-bg-active);
}
.dsg-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
:focus-visible {
  outline-color: rgba(77, 107, 254, 0.55) !important;
}
${DARK} :focus-visible {
  outline-color: rgba(103, 153, 254, 0.60) !important;
}
@keyframes dsg-pop-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  ${MENU}, ${DIALOG} { animation: none; }
}
`

const FROST_ID = 'deepseekgui-composer-frost'

/*
 * The frost's ground under the blurred transcript, per theme. A backdrop
 * filter paints its result OVER the unfiltered content, and this page is
 * transparent (the wallpaper lives in another WebContentsView), so a plain
 * blur comes out mostly transparent and the crisp text shows straight
 * through it (measured 2026-09-23: 50% ground → crisp text, 95% → faint
 * crisp copy, 100% → fully frosted). The filter therefore lays this opaque
 * ground first and the blurred backdrop on top; the card's own translucent
 * fill then sits over both. Values sit near the wallpaper's tone behind the
 * composer.
 */
const FROST_CSS = `
body { --deepseekgui-frost-ground: rgb(238, 243, 250); }
${DARK} { --deepseekgui-frost-ground: rgb(20, 24, 32); }
`

/** Install the SVG filter the frost references: opaque ground, then the saturated blur. */
function installFrostFilter(): () => void {
  document.getElementById(FROST_FILTER_ID)?.remove()
  const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  holder.id = FROST_FILTER_ID
  holder.setAttribute('aria-hidden', 'true')
  holder.setAttribute('width', '0')
  holder.setAttribute('height', '0')
  holder.style.position = 'absolute'
  // userSpaceOnUse with a generous region: an objectBoundingBox region is
  // resolved against the wrong origin for a backdrop and clips the result.
  holder.innerHTML = `<filter id="${FROST_FILTER_ID}-f" filterUnits="userSpaceOnUse" x="-10000" y="-10000"`
    + ' width="20000" height="20000" color-interpolation-filters="sRGB">'
    + '<feFlood style="flood-color: var(--deepseekgui-frost-ground)" result="ground"/>'
    + '<feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur"/>'
    + '<feColorMatrix in="blur" type="saturate" values="1.4" result="frosted"/>'
    + '<feMerge><feMergeNode in="ground"/><feMergeNode in="frosted"/></feMerge></filter>'
  document.body.appendChild(holder)
  return () => { holder.remove() }
}

/**
 * Frosted backdrop for the composer card. `backdrop-filter` on the card
 * itself samples the wrong band: the official composer seat is position:
 * sticky inside the chat scroller and Chromium reads a sticky element's
 * backdrop at its unstuck layout position (measured 2026-09-16 — the blur
 * landed above the card while the text under it stayed crisp). A fixed
 * element parented on body has no such ancestor, so this layer sits at
 * z-index 1 — above the z-auto transcript, below the seat's z-index 7 — and
 * follows the card's viewport rect every frame. The card keeps a light
 * translucent fill; the frost is what turns it into glass. Its filter is the
 * SVG one above, not `blur()`: see FROST_CSS for why a plain blur leaks.
 */
function installComposerFrost(): () => void {
  document.getElementById(FROST_ID)?.remove()
  const disposeFilter = installFrostFilter()
  const frost = document.createElement('div')
  frost.id = FROST_ID
  frost.setAttribute('aria-hidden', 'true')
  frost.style.cssText = 'position:fixed;pointer-events:none;z-index:1;display:none;'
    + `-webkit-backdrop-filter:${GLASS_FROST};backdrop-filter:${GLASS_FROST}`
  document.body.appendChild(frost)
  let last = ''
  let frame = 0
  const tick = (): void => {
    frame = requestAnimationFrame(tick)
    const card = document.querySelector<HTMLElement>('[data-composer-card]')
    // Only the docked composer (the sticky seat of an active conversation) has a
    // transcript behind it. The new-session hero card sits in a z-index 1 stack
    // that this layer, later in DOM order, would cover — and its opaque ground
    // then blurs the card's own text (found 2026-09-23); the hero needs no frost.
    const docked = card?.closest('[data-phase="active"], [data-content-phase="active"]') != null
    const rect = docked ? card?.getBoundingClientRect() : undefined
    const key = rect === undefined || rect.height === 0
      ? 'hidden'
      : `${rect.left},${rect.top},${rect.width},${rect.height},${card === null ? '' : getComputedStyle(card).borderRadius}`
    if (key === last) return
    last = key
    if (rect === undefined || card === null || rect.height === 0) { frost.style.display = 'none'; return }
    frost.style.display = 'block'
    frost.style.left = `${rect.left}px`
    frost.style.top = `${rect.top}px`
    frost.style.width = `${rect.width}px`
    frost.style.height = `${rect.height}px`
    frost.style.borderRadius = getComputedStyle(card).borderRadius
  }
  frame = requestAnimationFrame(tick)
  return () => { cancelAnimationFrame(frame); frost.remove(); disposeFilter() }
}

/**
 * Append the DeepSeekGUI skin patches to the document head.
 * @returns disposer removing the style element.
 */
export function installSkinStyles(): () => void {
  document.getElementById(SKIN_STYLE_ID)?.remove()
  const style = document.createElement('style')
  style.id = SKIN_STYLE_ID
  style.textContent = SKIN_CSS + FROST_CSS
  document.head.appendChild(style)
  const disposeFrost = installComposerFrost()
  return () => { disposeFrost(); style.remove() }
}
