/**
 * The visible Workbench marker (B3-P1): a read-only pill in the session
 * header proving the DeepSeekGUI Workbench plugin is active in this
 * composition. Carries no action and no state.
 * @returns the Workbench marker.
 */
export function WorkbenchBadge() {
  return (
    <span
      title="DeepSeekGUI Workbench"
      style={{
        // Glass pass batch 2: the solid currentColor stroke was the darkest
        // line on the whole header; the l4 hairline keeps it a quiet tag.
        border: '1px solid var(--dsw-alias-border-l4)',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: '18px',
        padding: '0 8px',
        color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap',
      }}
    >
      Workbench
    </span>
  )
}
