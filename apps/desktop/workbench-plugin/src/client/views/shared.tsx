/** Shared read hook and chrome for the DeepSeekGUI conversation views. */
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the generated `workbenchInspector` namespace into the Remote map.
import type {} from '@deepseek-ai/dsh-workbench-inspector/remote'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS_INSPECTOR } from '../locales-inspector.ts'
import type { ControlBridgeClient } from '../bridge.ts'
import type { InstructionSender } from '../instructions.ts'

/**
 * The generated `workbenchInspector` Remote namespace the plugin entry mounts:
 * the official carrier, cookie session, cancellation, and result schemas all
 * live there, so the views only call typed methods.
 */
export type InspectorRemote = TypertRemoteNamespaceMap['workbenchInspector']

/** Business props every DeepSeekGUI view receives from the plugin entry. */
export interface ViewInjected {
  inspector: InspectorRemote
  /** Desktop control bridge; null outside the DeepSeekGUI window. */
  bridge: ControlBridgeClient | null
  submitInstruction: InstructionSender
}

/** Locale seat plus the injected business props. */
export type ViewProps = PropsLocale<typeof NS_INSPECTOR> & ViewInjected & { sessionId: SessionId | undefined }

/** Translate function type of the views. */
export type Translate = ViewProps['t']

export interface ReadState<T> { busy: boolean; value?: T; error?: string }

/** One request per opening, navigation, or explicit refresh; unmount cancels it. */
export function useRead<T>(
  key: string,
  run: (sessionId: SessionId, signal: AbortSignal) => Promise<RemoteResult<T>>,
  sessionId: SessionId | undefined,
): ReadState<T> & { refresh: () => void } {
  const [generation, setGeneration] = useState(0)
  const [stored, setState] = useState<ReadState<T> & { requestKey: string }>({ busy: true, requestKey: '' })
  const requestKey = JSON.stringify([key, sessionId, generation])
  const state: ReadState<T> = stored.requestKey === requestKey ? stored : { busy: true }
  // The caller rebuilds `run` every render; the request identity is requestKey.
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (sessionId === undefined) { setState({ busy: false, requestKey }); return }
    const controller = new AbortController()
    setState({ busy: true, requestKey })
    runRef.current(sessionId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setState(result.ok
          ? { busy: false, requestKey, value: result.value }
          : { busy: false, requestKey, error: result.error.message })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ busy: false, requestKey, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => { controller.abort() }
  }, [requestKey, sessionId])
  return { ...state, refresh: () => setGeneration(value => value + 1) }
}

export const button: React.CSSProperties = {
  font: 'inherit', fontSize: 12, lineHeight: '18px', padding: '3px 10px', cursor: 'pointer',
  color: 'var(--dsw-alias-label-secondary)', background: 'transparent',
  border: '1px solid var(--dsw-alias-label-caption)', borderRadius: 6,
}
export const caption: React.CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-caption)' }
export const sectionTitle: React.CSSProperties = { fontSize: 13, lineHeight: '20px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginTop: 8 }
export const mono: React.CSSProperties = { fontFamily: 'var(--ds-font-family-code)' }
/**
 * Every view sits in the same centered column the official Chat uses
 * (`--dsh-chat-content-width`): the official width handles then rest 24px
 * outside our content instead of over our buttons, and dragging them
 * resizes our views together with the chat (acceptance 2026-09-06).
 */
export const view: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0', boxSizing: 'border-box',
  width: '100%', maxWidth: 'var(--dsh-chat-content-width, 920px)', margin: '0 auto',
  fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)',
}

/** Short clock text for provenance rows; empty for a missing time. */
export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** Date plus clock for commit rows. */
export function dateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function TextView({ text }: { text: string }) {
  return <pre style={{ ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: '20px', maxHeight: '60vh', overflow: 'auto', margin: 0 }}>{text}</pre>
}

export function ReadStatus({ state, t }: { state: ReadState<unknown>; t: Translate }) {
  if (state.busy) return <div role="status" style={caption}>{t('common.loading')}</div>
  if (state.error !== undefined) return <div role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{t('common.failed')} {state.error}</div>
  return null
}

/**
 * Toolbar: refresh plus the one harmless desktop action (D7) — opening the
 * workspace in the file manager. A view that already offers a more specific
 * file-manager button (Memory) passes `workspace={false}` so there is one.
 */
export function Toolbar({ t, refresh, bridge, sessionId, children, workspace = true }: {
  t: Translate
  refresh: () => void
  bridge: ControlBridgeClient | null
  sessionId: SessionId | undefined
  children?: React.ReactNode
  workspace?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
      <button type="button" style={button} onClick={refresh}>{t('common.refresh')}</button>
      {workspace && bridge !== null && sessionId !== undefined && (
        <button
          type="button"
          style={button}
          title={t('common.openWorkspaceTitle')}
          onClick={() => { void bridge.run({ type: 'open-workspace', sessionId }).catch(() => undefined) }}
        >
          {t('common.openWorkspace')}
        </button>
      )}
    </div>
  )
}
