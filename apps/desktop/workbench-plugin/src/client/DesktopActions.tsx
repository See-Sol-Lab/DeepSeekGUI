/**
 * The Workbench desktop seat in the official `sidebar.footer.action` list.
 * Since D1 (2026-09-05, the developer's ruling) it paints nothing: the
 * sidebar status light duplicated the shell's status pill. The component
 * stays mounted because it owns the desktop-model poll that consumes
 * notification-click navigation requests (B4-P8). Without the bridge (an
 * external browser tab) there is nothing to poll either.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { readBridge, type ControlBridgeClient, type HarnessPhase } from './bridge.ts'
import type { WorkbenchKey } from './locales.ts'

type DesktopActionsProps = SidebarFooterActionOwnerProps
  & PropsLocale<'deepseekgui.workbench'>
  & {
    /** Bridge client override for tests; defaults to the page bridge. */
    bridge?: ControlBridgeClient | null
    /**
     * Open one session in the official conversation view (B4-P8): the
     * notification-click navigation request lands here.
     */
    openSession: (sessionId: SessionId) => void
  }

/** Status phases → localized dictionary keys (exposed as a data attribute for tests and assistive tech). */
const STATUS_KEYS: Record<HarnessPhase, WorkbenchKey> = {
  idle: 'status.idle',
  stopping: 'status.stopping',
  starting: 'status.starting',
  switching: 'status.switching',
  recovering: 'status.recovering',
  running: 'status.running',
  recovered: 'status.recovered',
  failed: 'status.failed',
}

/** Poll interval for the desktop model (ms). */
const MODEL_POLL_MS = 2_000

/**
 * Mount the desktop poll into the sidebar footer seat.
 * @param props - locale seat, optional bridge, and the navigation opener.
 * @returns an invisible marker carrying the phase, or nothing without the bridge.
 */
export function DesktopActions({ t, bridge: bridgeProp, openSession }: DesktopActionsProps) {
  const bridgeRef = useRef<ControlBridgeClient | null>(bridgeProp === undefined ? readBridge() : bridgeProp)
  const bridge = bridgeRef.current
  const [phase, setPhase] = useState<HarnessPhase | null>(null)
  const [error, setError] = useState(false)
  // Last seen content revision (P9-2): idle ticks send it as ?since= and a
  // changed:false envelope touches no React state. Reset to null on failure
  // so recovery re-fetches the full model unconditionally.
  const revisionRef = useRef<number | null>(null)
  // The last consumed navigation nonce (B4-P8): a one-shot navigate request
  // from a notification click opens its session exactly once.
  const handledNavigateNonce = useRef<number | null>(null)

  useEffect(() => {
    if (bridge === null) return
    let alive = true
    const refresh = (): void => {
      bridge.model(revisionRef.current).then(
        (envelope) => {
          if (!alive) return
          revisionRef.current = envelope.revision
          if (!envelope.changed) return
          setPhase(envelope.model.status.phase)
          setError(false)
          // Notification-click navigation (B4-P8): open the requested
          // session once per nonce. The desktop only ever writes this for a
          // session that exists (it came from an official event), so an
          // unknown id here is a stale request — the open is a no-op.
          const navigate = envelope.model.navigateRequest
          if (navigate !== null && navigate !== undefined
            && handledNavigateNonce.current !== navigate.nonce) {
            handledNavigateNonce.current = navigate.nonce
            openSession(navigate.sessionId as SessionId)
          }
        },
        () => {
          if (!alive) return
          revisionRef.current = null
          setError(true)
        },
      )
    }
    refresh()
    const timer = setInterval(refresh, MODEL_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [bridge, openSession])

  if (bridge === null) return null
  const statusText = error
    ? t('actions.bridge.error')
    : phase === null
      ? t('status.starting')
      : t(STATUS_KEYS[phase])
  return <span hidden aria-hidden="true" data-deepseekgui-phase={statusText} />
}
