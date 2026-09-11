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
    /**
     * The desktop's browser pane went from closed to open (#13): the caller
     * collapses the official right Sidebar so the two never share the edge.
     */
    onBrowserPaneOpen?: () => void
  }

/** Poll interval for the desktop model (ms). */
const MODEL_POLL_MS = 2_000

/**
 * Mount the desktop poll into the sidebar footer seat.
 * @param props - optional bridge and the navigation opener (the locale seat
 * is part of the slot contract but this marker carries no text).
 * @returns an invisible marker carrying the phase, or nothing without the bridge.
 */
export function DesktopActions({ bridge: bridgeProp, openSession, onBrowserPaneOpen }: DesktopActionsProps) {
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
  // Last seen pane state (#13): only the closed → open edge collapses the
  // Sidebar; a poll that finds the pane already open changes nothing.
  const paneOpenRef = useRef(false)

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
          const paneOpen = envelope.model.browserPane?.open === true
          if (paneOpen && !paneOpenRef.current) onBrowserPaneOpen?.()
          paneOpenRef.current = paneOpen
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
  }, [bridge, openSession, onBrowserPaneOpen])

  if (bridge === null) return null
  // 这个标记不可见（hidden + aria-hidden），存在的唯一理由是给测试一个观测
  // 点：poll 在不在跑、错误有没有被接住、恢复有没有被识别。所以它带的是
  // phase 原值而不是本地化文案——给一个没人看得见的元素做翻译只会让测试与
  // 运行时看到两样东西（aria-hidden 也意味着辅助技术根本读不到它）。
  return <span hidden aria-hidden="true" data-deepseekgui-phase={error ? 'bridge-error' : phase ?? 'starting'} />
}
