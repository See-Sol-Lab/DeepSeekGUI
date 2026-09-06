/**
 * Changes view (D5-d/D5-f, 2026-09-06): what the assistant changed in this
 * workspace, file by file, read straight from Git without a model call. The
 * only actions are harmless: reveal a file in the file manager, copy its
 * path, open the workspace. Commit, discard, and revert stay in the
 * conversation (D10).
 */
import { useState } from 'react'
import type { DiffResult, StatusEntry } from '@deepseek-ai/dsh-git/types'
import type { WorkbenchFileText, WorkbenchRepository } from '@deepseek-ai/dsh-workbench-inspector/types'
import { button, caption, mono, ReadStatus, TextView, Toolbar, useRead, view, type ViewProps } from './shared.tsx'

const GROUPS = ['staged', 'unstaged', 'untracked', 'conflict'] as const

/** Repository-relative path joined onto the Git root for the clipboard. */
function absolutePath(root: string, path: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/u, '')}${separator}${path.replace(/\//gu, separator)}`
}

export function ChangesView({ inspector, bridge, sessionId, t }: ViewProps) {
  const [selected, setSelected] = useState<StatusEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const read = useRead<WorkbenchRepository | WorkbenchFileText | DiffResult>(
    selected === null ? 'status' : `${selected.kind}:${selected.path}`,
    async (id, signal) => selected === null
      ? await inspector.status(id, signal)
      : selected.kind === 'untracked'
        ? await inspector.text(id, selected.path, true, signal)
        : await inspector.diff(id, selected.kind === 'staged' ? 'staged' : 'unstaged', selected.path, signal),
    sessionId,
  )
  const repository = read.value !== undefined && 'status' in read.value ? read.value : undefined
  const text = read.value !== undefined && 'text' in read.value ? read.value.text
    : read.value !== undefined && 'files' in read.value ? read.value.patch ?? '' : undefined
  const [root, setRoot] = useState('')
  if (repository !== undefined && repository.root !== root) setRoot(repository.root)

  const copy = (path: string): void => {
    void navigator.clipboard?.writeText(absolutePath(root, path)).then(() => {
      setCopied(path)
      setTimeout(() => setCopied(current => (current === path ? null : current)), 1500)
    }).catch(() => undefined)
  }
  const reveal = (path: string): void => {
    if (bridge === null || sessionId === undefined) return
    void bridge.run({ type: 'reveal-path', sessionId, path }).catch(() => undefined)
  }

  return (
    <section style={view} aria-label={t('view.changes')}>
      <Toolbar t={t} refresh={read.refresh} bridge={bridge} sessionId={sessionId}>
        {selected !== null && <button type="button" style={button} onClick={() => setSelected(null)}>{t('changes.back')}</button>}
      </Toolbar>
      <ReadStatus state={read} t={t} />
      {repository !== undefined && (
        <>
          <div style={caption}>{repository.root} · {t('changes.branch')} {repository.status.head.name || repository.status.head.kind}</div>
          {repository.status.clean && <p style={{ margin: 0 }}>{t('changes.clean')}</p>}
          {GROUPS.map((kind) => {
            const entries = repository.status.entries.filter(entry => entry.kind === kind)
            if (entries.length === 0) return null
            return (
              <div key={kind}>
                <div style={{ ...caption, marginTop: 6 }}>{t(`changes.group.${kind}`)} · {entries.length}</div>
                {entries.map((entry, index) => (
                  <div key={`${entry.kind}/${entry.path}/${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      style={{ ...button, ...mono, flex: 1, textAlign: 'left', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => setSelected(entry)}
                    >
                      {entry.path}{entry.origPath !== undefined ? ` ← ${entry.origPath}` : ''}
                    </button>
                    {bridge !== null && (
                      <button type="button" style={button} title={t('changes.revealTitle')} onClick={() => reveal(entry.path)}>{t('changes.reveal')}</button>
                    )}
                    <button type="button" style={button} onClick={() => copy(entry.path)}>
                      {copied === entry.path ? t('changes.copied') : t('changes.copyPath')}
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </>
      )}
      {selected !== null && <p style={{ ...mono, margin: 0 }}>{t(`changes.group.${selected.kind}`)} · {selected.path}</p>}
      {text !== undefined && <TextView text={text === '' ? t('changes.noPatch') : text} />}
      <p style={{ ...caption, margin: 0 }}>{t('changes.scope')}</p>
    </section>
  )
}
