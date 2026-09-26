/** Inline styles the memory pages share (official alias tokens only). */

import { button, BUTTON_CLASS } from '../views/shared.tsx'

// One button definition for every DeepSeekGUI view; the memory pages used
// to carry a copy (B7 audit A5). The class supplies the glass material.
export { button, BUTTON_CLASS }

export const intro: React.CSSProperties = { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', margin: 0 }
export const caption: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-caption)' }
export const mono: React.CSSProperties = { fontFamily: 'var(--ds-font-family-code)', overflowWrap: 'anywhere' }
// R13（2026-09-14 人工验收）：不带外边距——多数用法在 alignItems:center 的
// flex 行里，顶部外边距会把标题单独压下去；块级场景自己补间距。
export const heading: React.CSSProperties = { fontSize: 15, lineHeight: '22px', fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary)' }
// Primary keeps the brand accent as its ring; danger the error tint. Both are
// hairlines (l4 strength), not the solid label colour they used to borrow.
export const primaryButton: React.CSSProperties = { ...button, color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-brand-primary)' }
export const dangerButton: React.CSSProperties = { ...button, color: 'var(--dsw-alias-state-error-primary)', border: '1px solid var(--dsw-alias-state-error-secondary, var(--dsw-alias-state-error-primary))' }
export const input: React.CSSProperties = {
  font: 'inherit', fontSize: 13, lineHeight: '20px', padding: '3px 8px', boxSizing: 'border-box', width: '100%',
  color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-2)',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
}
export const textarea: React.CSSProperties = { ...input, resize: 'vertical', lineHeight: '22px', padding: '8px 10px' }
export const card: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
  display: 'flex', flexDirection: 'column', gap: 4,
}
export const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }
export const column: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
export const badge: React.CSSProperties = { ...caption, padding: '0 6px', borderRadius: 4, border: '1px solid var(--dsw-alias-border-l1)', whiteSpace: 'nowrap' }
export const errorText: React.CSSProperties = { color: 'var(--dsw-alias-state-error-primary)' }
export const warnText: React.CSSProperties = { color: 'var(--dsw-alias-state-warning-primary, var(--dsw-alias-label-secondary))' }
export const pre: React.CSSProperties = { ...mono, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: '20px', margin: 0 }
