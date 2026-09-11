/**
 * Archived-sessions settings section (B6-P11): the archive as a list you can
 * read, restore from, and clear out, in Settings rather than crowding the
 * sidebar.
 *
 * Archiving hides a session from the workspace tree; before this section the
 * only way back was a group pinned under the sidebar's workspace list, which
 * pushed the archive into everyone's field of view whether or not they used
 * it. Settings is where a rarely-used inventory belongs.
 *
 * Restoring is the same host write the sidebar used (`unarchiveSession` →
 * `IWorkspaces`), so there is exactly one restore path; opening waits for that
 * write so it never races the archive echo.
 *
 * Deleting is not a host write at all — upstream has no session-delete
 * anywhere, from persistence up to the RPC face — so it goes through the
 * desktop's control bridge (see `desktop-session-delete.ts`). Two consequences
 * are deliberate:
 *
 * - The trash button exists only in a DeepSeekGUI window. Open the same
 *   harness in a browser and the archive still reads and restores, with no
 *   delete affordance: erasing files is the desktop host's authority.
 * - The row disappears because the session leaves the session list, not
 *   because this component hides it. The desktop host has the harness
 *   announce the session as removed (`api-session/removed`, the same relay a
 *   disposed session uses) before it erases the files, so every client drops
 *   it at once. The first port kept a local "deleted" list instead — and a
 *   settings section is unmounted on every tab switch, so the list reset and
 *   the row came back as a ghost that "restore and open" would happily open
 *   onto a session with no log (2026-09-11 manual tests #20 and #21). The
 *   archive id stays behind as a tombstone (the registry validates workspace
 *   order and accounting, never archive membership); with the session gone
 *   from the list no row derives from it.
 */

import { useState, type ReactNode } from 'react'
import { IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveArchived } from './tree.ts'
import { readSessionDeleter, type SessionDeleter } from './desktop-session-delete.ts'
import css from './rows/WorkspaceBrowser.module.css'

/**
 * Registration-side business face for the archive section.
 *
 * The list and workspace projections are global standard props, so only the
 * two writes need injecting.
 */
export interface ArchivedSessionsSectionInjected {
  /** Restore one archived session; resolves after the host write. */
  restore: (sessionId: SessionId) => Promise<void>
  /** Open a session once it is restored. */
  open: (sessionId: SessionId) => void
  /**
   * Delete one archived session's data, when this page can. Injected for
   * tests; the default reads the desktop control bridge from the page URL.
   */
  deleteSession?: SessionDeleter | null
}

/** Full component props. */
export type ArchivedSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'workspace'>
  & InjectFace<ArchivedSessionsSectionInjected>

/**
 * The archive list. Empty state says so in one line rather than rendering an
 * empty frame.
 * @param props - runtime seat, locale seat, and the injected business face.
 * @returns the settings section body.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const { t, useSessions, useWorkspaces, restore, open } = props
  const deleter = props.deleteSession === undefined ? readSessionDeleter() : props.deleteSession
  const list = useSessions(state => state)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Deleting erases files, so it asks first; one row at a time is armed.
  const [armed, setArmed] = useState<SessionId | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SessionId | null>(null)
  const rows = deriveArchived(list, workspaces, archivedSessionIds)

  const restoreAndOpen = (sessionId: SessionId): void => {
    void restore(sessionId).then(() => { open(sessionId) }).catch((reason: unknown) => {
      console.warn('session restore rejected:', reason)
    })
  }
  const confirmDelete = (sessionId: SessionId): void => {
    if (deleter === null || deleting !== null) return
    setArmed(null)
    setFailure(null)
    setDeleting(sessionId)
    // On success the row leaves with the session list (see the header); the
    // component keeps no memory of it.
    void deleter(sessionId).catch((reason: unknown) => {
      // A delete that erased nothing must be visible: the row stays, and the
      // reason goes on screen rather than only into the console.
      console.warn('session delete rejected:', reason)
      setFailure(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => { setDeleting(null) })
  }

  if (rows.length === 0 && failure === null && deleting === null) return <div className={css.archivedHint}>{t('settings.archived.empty')}</div>
  return (
    <div>
      <div className={css.archivedHint}>{t('archived.hint')}</div>
      {deleting !== null && <div className={css.archivedHint} role="status">{t('archived.deleting')}</div>}
      {rows.map(row => (
        <div key={row.id} className={css.archivedRow}>
          <span className={css.archivedTitle} title={row.title}>{row.title}</span>
          <span className={css.archivedWorkspace}>
            {row.workspace === '' ? t('group.ungrouped') : row.workspace}
          </span>
          {armed === row.id
            ? (
              <>
                <span className={css.archivedWarning}>{t('archived.deleteWarning')}</span>
                <button
                  type="button"
                  className={css.archivedDeleteConfirm}
                  disabled={deleting !== null}
                  onClick={() => { confirmDelete(row.id) }}
                >
                  {t('archived.deleteConfirm')}
                </button>
                <button type="button" className={css.archivedRestore} onClick={() => { setArmed(null) }}>
                  {t('archived.deleteCancel')}
                </button>
              </>
            )
            : (
              <>
                <button className={css.archivedRestore} type="button" disabled={deleting === row.id} onClick={() => { restoreAndOpen(row.id) }}>
                  {t('archived.restoreOpen')}
                </button>
                {deleter !== null && (
                  <button
                    type="button"
                    className={css.archivedDelete}
                    disabled={deleting !== null}
                    title={t('archived.delete')}
                    aria-label={t('archived.delete')}
                    onClick={() => { setArmed(row.id); setFailure(null) }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                )}
              </>
            )}
        </div>
      ))}
      {failure !== null && (
        <div className={css.archivedHint} role="alert">{t('archived.deleteFailed')}{failure}</div>
      )}
    </div>
  )
}
