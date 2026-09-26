/**
 * Settings → Archived sessions (住户 2026-09-23: bring the B6-P11 page back).
 *
 * dsh 0.1.7 dropped its settings archive list and moved the archive behind
 * the sidebar's "View options → Show archived", which is hard to find and
 * mixes archived rows into the tree. This page lists the archive on its own,
 * with restore and delete per row; the sidebar entry keeps working too.
 *
 * It lives in our plugin rather than in the official ui-workspace package so
 * an upstream change there can no longer collide with it (the B6-P11 page sat
 * inside that package and was retired with the 0.1.7 merge).
 *
 * Restoring is the official host write (`uiWorkspace.unarchiveSession`), so
 * there is one restore path; opening waits for it so it never races the
 * archive echo. Deleting goes through the desktop control bridge
 * (session-delete.tsx): the trash button exists only in a DeepSeekGUI window,
 * and a deleted row leaves because the session leaves the session list —
 * this component keeps no "deleted" memory (2026-09-11 manual tests #20/#21:
 * a local list reset on every tab switch and brought ghost rows back).
 */
import { useState, type ReactNode } from 'react'
import { IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionDeleter } from './session-delete.tsx'
import { button, caption, card, column, dangerButton, errorText, intro, row } from './memory/styles.ts'

/** Business face the plugin entry injects. */
export interface ArchivedSessionsInjected {
  /** Restore one archived session; resolves after the host write. */
  restore: (sessionId: SessionId) => Promise<void>
  /** Open a session once it is restored. */
  open: (sessionId: SessionId) => void
  /** Delete one session's data; null outside a DeepSeekGUI window. */
  deleteSession: SessionDeleter | null
}

/** Full component props. */
export type ArchivedSessionsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'deepseekgui.workbench'>
  & ArchivedSessionsInjected

/** One archived row: title plus the workspace it restores into. */
export interface ArchivedRow {
  id: SessionId
  /** Display title; falls back to the directory name when the session has none. */
  title: string
  /** Workspace display title; empty for a session outside every workspace. */
  workspace: string
}

/** The last path segment, for sessions that never got a title. */
function directoryName(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return ''
  const parts = cwd.split(/[\\/]+/).filter(part => part !== '')
  return parts.at(-1) ?? cwd
}

/**
 * Project the archive set into rows. Host archive order is kept; ids the
 * session list no longer holds (deleted, or not loaded) drop out, and every
 * id yields at most one row.
 * @param byId - session list summaries by id.
 * @param workspaces - workspace membership and display titles.
 * @param archivedSessionIds - archive set in Host order.
 * @returns one row per resolvable archived id.
 */
export function archivedRows(
  byId: Readonly<Record<string, { readonly displayTitle: string; readonly cwd?: string | undefined } | undefined>>,
  workspaces: readonly { readonly title: string; readonly sessionIds: readonly SessionId[] }[],
  archivedSessionIds: readonly SessionId[],
): ArchivedRow[] {
  const workspaceOf = new Map<SessionId, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, workspace.title)
    }
  }
  const rows: ArchivedRow[] = []
  const seen = new Set<SessionId>()
  for (const id of archivedSessionIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const summary = byId[id]
    if (summary === undefined) continue
    // A renamed session shows its name even if it never had a turn.
    rows.push({ id, title: summary.displayTitle !== '' ? summary.displayTitle : directoryName(summary.cwd), workspace: workspaceOf.get(id) ?? '' })
  }
  return rows
}

const listRow: React.CSSProperties = { ...row, flexWrap: 'nowrap' }
const titleCell: React.CSSProperties = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const workspaceCell: React.CSSProperties = { ...caption, flex: '0 1 auto', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/**
 * The archive list; the empty state says so in one line.
 * @param props - runtime seat, locale seat, and the injected business face.
 * @returns the settings section body.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const { t, useSessions, useWorkspaces, restore, open, deleteSession } = props
  const byId = useSessions(state => state.byId)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Deleting erases files, so it asks first; one row at a time is armed.
  const [armed, setArmed] = useState<SessionId | null>(null)
  const [deleting, setDeleting] = useState<SessionId | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const rows = archivedRows(byId, workspaces, archivedSessionIds)

  const restoreAndOpen = (sessionId: SessionId): void => {
    setFailure(null)
    void restore(sessionId).then(() => { open(sessionId) }).catch((reason: unknown) => {
      setFailure(reason instanceof Error ? reason.message : String(reason))
    })
  }
  const confirmDelete = (sessionId: SessionId): void => {
    if (deleteSession === null || deleting !== null) return
    setArmed(null)
    setFailure(null)
    setDeleting(sessionId)
    // On success the row leaves with the session list (see the header).
    void deleteSession(sessionId).catch((reason: unknown) => {
      // A delete that erased nothing must be visible: the row stays and the
      // reason goes on screen.
      setFailure(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setDeleting(null) })
  }

  return (
    <div style={column} data-deepseekgui="archived-sessions">
      <p style={intro}>{rows.length === 0 ? t('archived.empty') : t('archived.hint')}</p>
      {deleting !== null && <div style={caption} role="status">{t('archived.deleting')}</div>}
      {failure !== null && <div style={errorText} role="alert">{t('archived.failed')}{failure}</div>}
      {rows.map(item => (
        <div key={item.id} style={card} data-deepseekgui="archived-row">
          <div style={listRow}>
            <span style={titleCell} title={item.title}>{item.title}</span>
            <span style={workspaceCell} title={item.workspace}>
              {item.workspace === '' ? t('archived.ungrouped') : item.workspace}
            </span>
            {armed === item.id
              ? (
                <>
                  <span style={{ ...caption, ...errorText, whiteSpace: 'nowrap' }}>{t('sessionDelete.warning')}</span>
                  <button type="button" style={dangerButton} disabled={deleting !== null} onClick={() => { confirmDelete(item.id) }}>
                    {t('sessionDelete.action')}
                  </button>
                  <button type="button" style={button} onClick={() => { setArmed(null) }}>{t('sessionDelete.cancel')}</button>
                </>
              )
              : (
                <>
                  <button type="button" style={button} disabled={deleting === item.id} onClick={() => { restoreAndOpen(item.id) }}>
                    {t('archived.restoreOpen')}
                  </button>
                  {deleteSession !== null && (
                    <button
                      type="button"
                      style={{ ...button, padding: '4px 8px' }}
                      disabled={deleting !== null}
                      title={t('sessionDelete.menu')}
                      aria-label={t('sessionDelete.menu')}
                      onClick={() => { setArmed(item.id); setFailure(null) }}
                    >
                      <IconTrashOutlineRegular size={14} />
                    </button>
                  )}
                </>
              )}
          </div>
        </div>
      ))}
    </div>
  )
}
