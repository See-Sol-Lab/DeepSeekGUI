/**
 * Styles of the welcome overlay: the official Desktop welcome window
 * (0.1.7-rc.2 apps/desktop/renderer/welcome.css) ported into a full-window
 * layer of the DeepSeekGUI page. The native window's titlebar and acrylic tint
 * are gone: the page's own theme tokens colour it, and the skin's grounded
 * frost filter plus the frost ground at 0.86 (the dialog solidity the
 * resident set on 2026-09-16) blur the official page underneath.
 *
 * Rendered as a <style> element inside the overlay (the plugin bundle carries
 * no CSS pipeline); class names are `dsgw-` prefixed so nothing on the official
 * page matches them.
 * @module @see-sol-lab/deepseekgui-workbench/client/welcome/welcome-style
 */

/** The stylesheet text. */
export const WELCOME_CSS = `
.dsgw-root {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  padding: 6px 16px;
  background: color-mix(in srgb, var(--deepseekgui-frost-ground, rgb(238, 243, 250)) 86%, transparent);
  /* The skin's grounded frost (skin.ts): a plain blur over this transparent
     page lets the official page's text show through the welcome. */
  -webkit-backdrop-filter: url(#deepseekgui-composer-frost-filter-f);
  backdrop-filter: url(#deepseekgui-composer-frost-filter-f);
  color: var(--dsw-alias-label-primary);
  font-weight: 300;
  user-select: none;
  -webkit-font-smoothing: antialiased;
}
.dsgw-root [hidden] { display: none !important; }
.dsgw-welcome {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-rows: 40px minmax(0, 1fr) 104px;
  justify-items: center;
  align-items: center;
  padding: 60px 48px 76px;
}
.dsgw-welcome > .dsgw-tagline,
.dsgw-welcome > .dsgw-key-form,
.dsgw-welcome > .dsgw-auth-page { grid-row: 2; grid-column: 1; }
.dsgw-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  color: var(--dsw-alias-label-primary);
  font-size: 26px;
  font-weight: 500;
  letter-spacing: 0.01em;
}
.dsgw-tagline {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 24px;
  font-weight: 300;
  line-height: 40px;
  text-align: center;
  white-space: nowrap;
}
.dsgw-tagline h1, .dsgw-tagline p { margin: 0; font: inherit; }
.dsgw-tagline em {
  color: var(--dsw-alias-label-primary);
  font-size: 26px;
  font-style: normal;
  font-weight: 500;
}
.dsgw-actions {
  position: relative;
  grid-row: 3;
  grid-column: 1;
  align-self: stretch;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 16px;
  width: 240px;
}
.dsgw-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  opacity: 1;
  cursor: pointer;
  transition:
    background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.dsgw-actions button:disabled { cursor: not-allowed; opacity: 0.4; }
.dsgw-actions button:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
.dsgw-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary-inverted); }
.dsgw-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-label-secondary)); }
.dsgw-actions .dsgw-secondary {
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-button-elevated-fill, transparent);
  color: var(--dsw-alias-label-primary);
}
.dsgw-actions .dsgw-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-button-floating-hover, var(--dsw-alias-border-l2));
}
.dsgw-actions .dsgw-back {
  position: absolute;
  top: calc(100% + 16px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  min-width: 58px;
  height: 28px;
  padding: 4px 10px;
  border: 0;
  border-radius: 24px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-weight: 300;
  font-size: 14px;
  line-height: 20px;
}
.dsgw-actions .dsgw-back:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dsgw-actions .dsgw-back:disabled { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); opacity: 1; }
@media (prefers-reduced-motion: reduce) { .dsgw-actions button { transition: none; } }
.dsgw-key-form { display: flex; flex-direction: column; align-items: center; gap: 40px; width: 440px; }
.dsgw-key-heading { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
.dsgw-key-heading h1 { margin: 0; font-size: 20px; font-weight: 400; line-height: 32px; letter-spacing: 0.01em; }
.dsgw-key-heading p {
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 16px;
  font-weight: 300;
  line-height: 22px;
  letter-spacing: 0.02em;
}
.dsgw-key-field { position: relative; width: 100%; }
.dsgw-key-field input {
  display: block;
  width: 100%;
  height: 48px;
  padding: 7px 14px;
  border: 1px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
  border-radius: 12px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-weight: inherit;
  font-size: 14px;
  line-height: 24px;
  user-select: text;
}
.dsgw-key-field input:focus { border-color: var(--dsw-alias-label-primary); }
.dsgw-key-field input::placeholder { color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary)); opacity: 1; }
.dsgw-key-error {
  position: absolute;
  top: 100%;
  width: 100%;
  margin: 8px 0 0;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.dsgw-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.dsgw-auth-page h1 { font-size: 20px; line-height: 24px; font-weight: 400; letter-spacing: normal; }
.dsgw-auth-waiting, .dsgw-auth-expired { gap: 12px; padding-top: 28px; }
.dsgw-auth-waiting p, .dsgw-auth-expired p { line-height: 16px; letter-spacing: normal; }
.dsgw-copy-link {
  margin-top: 20px;
  padding: 0;
  width: 240px;
  min-height: 17px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-weight: inherit;
  font-size: 14px;
  line-height: 20px;
  cursor: pointer;
  text-decoration: underline;
}
.dsgw-copy-link:disabled { cursor: default; }
.dsgw-actions .dsgw-loading:disabled { opacity: 1; }
`
