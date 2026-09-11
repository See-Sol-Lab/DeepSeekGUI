/**
 * Shared chrome for the first-run guide strips (P11): the desktop-model poll
 * that answers "should the guide show at all" and the presentational strip the
 * two steps render into.
 *
 * Both strips ask the same desktop question, so the conditional, revision-gated
 * poll lives here once instead of in each component.
 * @module @see-sol-lab/deepseekgui-workbench/client/first-run-guide-chrome
 */
import { useEffect, useRef, useState } from 'react'
import type { ControlBridgeClient } from './bridge.ts'
import { button } from './views/shared.tsx'

/** Desktop-model poll interval while a guide strip is mounted (ms). */
export const GUIDE_POLL_MS = 2_000

/**
 * Ask the desktop whether the guide should show, conditionally and once per
 * poll: an unchanged model answers a small envelope and touches no state.
 * @param bridge - the desktop control bridge, or null outside DeepSeekGUI.
 * @returns true while the desktop reports the guide pending.
 */
export function useFirstRunPending(bridge: ControlBridgeClient | null): boolean {
  const [pending, setPending] = useState(false)
  const revision = useRef<number | null>(null)
  useEffect(() => {
    if (bridge === null) return
    let alive = true
    const refresh = (): void => {
      bridge.model(revision.current).then(
        (envelope) => {
          if (!alive) return
          revision.current = envelope.revision
          if (envelope.changed) setPending(envelope.model.firstRun?.pending === true)
        },
        () => {
          // An unreachable desktop leaves the guide hidden rather than
          // guessing; the next tick retries with a full fetch.
          if (alive) revision.current = null
        },
      )
    }
    refresh()
    const timer = setInterval(refresh, GUIDE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [bridge])
  return pending
}

/** Shared control styling: the views' button, pinned so a strip never stretches it. */
export const guideControlStyle: React.CSSProperties = { ...button, flex: 'none' }

/** One guide strip's already-localized copy and actions. */
export interface GuideStripProps {
  /** Accessibility label for the strip (already localized). */
  ariaLabel: string
  /** The sentence the step explains (already localized). */
  text: string
  /** Label of the skip action. */
  skipLabel: string
  /** Skip action (also writes the completion fact). */
  onSkip: () => void
}

/**
 * Render one guide strip.
 * @param props - localized copy and the two actions.
 * @returns the strip element.
 */
export function GuideStrip({ ariaLabel, text, skipLabel, onSkip }: GuideStripProps) {
  return (
    <section
      aria-label={ariaLabel}
      data-deepseekgui="first-run"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '8px 12px',
        marginBottom: 8,
        borderRadius: 10,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        lineHeight: '20px',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
      <button type="button" style={guideControlStyle} onClick={onSkip}>{skipLabel}</button>
    </section>
  )
}
