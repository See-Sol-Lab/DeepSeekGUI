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
        border: '1px solid currentColor',
        borderRadius: 999,
        fontSize: 11,
        lineHeight: '18px',
        padding: '0 8px',
        opacity: 0.75,
        whiteSpace: 'nowrap',
      }}
    >
      Workbench
    </span>
  )
}
