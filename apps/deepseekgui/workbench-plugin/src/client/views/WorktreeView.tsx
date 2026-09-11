/**
 * Parallel work trees (D9/D10, 2026-09-06): which trees exist for this
 * repository, which branch each is on, what changed there, and where two
 * trees touched the same file. Display only. Creating, merging, and removing
 * work trees are conversation requests.
 *
 * Since 2026-09-11 (manual test #5) this is a section at the top of the Git
 * view rather than a tab of its own: one fewer tab, and the two things a
 * person checks before merging sit on one page.
 */
import type { WorkbenchOverview } from '@deepseek-ai/dsh-workbench-inspector/types'
import { caption, mono, type Translate } from './shared.tsx'

/** Paths changed in more than one work tree (the merge collision preview). */
export function overlappingPaths(trees: readonly { changedPaths: readonly string[] }[]): string[] {
  const seen = new Map<string, number>()
  for (const tree of trees) for (const path of new Set(tree.changedPaths)) seen.set(path, (seen.get(path) ?? 0) + 1)
  return [...seen.entries()].filter(([, count]) => count > 1).map(([path]) => path).sort()
}

export function WorktreeSection({ worktrees, t }: { worktrees: WorkbenchOverview['worktrees']; t: Translate }) {
  const trees = worktrees.filter(tree => !tree.bare)
  const overlap = overlappingPaths(trees)
  return (
    <>
      {trees.length <= 1 && (
        <>
          <p style={{ margin: 0 }}>{t('worktree.only')}</p>
          <p style={{ ...caption, margin: 0 }}>{t('worktree.hint')}</p>
        </>
      )}
      {trees.length > 1 && overlap.map(path => (
        <div key={path} role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{t('worktree.overlap', { path })}</div>
      ))}
      {trees.length > 1 && trees.map(tree => (
        <div key={tree.path} style={{ border: '1px solid var(--dsw-alias-label-caption)', borderRadius: 8, padding: '6px 10px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={mono}>{tree.path}</span>
            {tree.current && <span style={{ ...caption, color: 'var(--dsw-alias-state-info-primary)' }}>{t('worktree.current')}</span>}
          </div>
          <div style={caption}>
            {t('worktree.branch')} · <span style={mono}>{tree.branch ?? tree.head.slice(0, 7)}</span>
            {' · '}
            {tree.statusError !== undefined ? `${t('common.failed')} ${tree.statusError}`
              : tree.changedPaths.length === 0 ? t('worktree.clean') : t('worktree.changed', { count: tree.changedPaths.length })}
          </div>
          {tree.changedPaths.length > 0 && (
            <div style={{ ...caption, ...mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{tree.changedPaths.join('\n')}</div>
          )}
        </div>
      ))}
      <p style={{ ...caption, margin: 0 }}>{t('worktree.scope')}</p>
    </>
  )
}
