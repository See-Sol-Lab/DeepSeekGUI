/**
 * Git view (D5-e/D10, 2026-09-06): repository-level facts for a person who
 * needs to know where things stand without asking the model — branch,
 * remote sync, recent commits, and what this session committed, pushed, or
 * opened as a PR. Display only; refresh is the sole control.
 */
import { useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchOverview } from '@deepseek-ai/dsh-workbench-inspector/types'
import { historyOf, reviewHistory } from '../inspector/history-model.ts'
import { caption, clock, dateTime, mono, ReadStatus, sectionTitle, Toolbar, useRead, view, type ViewProps } from './shared.tsx'

export function GitView({ inspector, bridge, sessionId, t, useConversation }: ViewProps & Pick<ConvViewProps, 'useConversation'>) {
  const read = useRead<WorkbenchOverview>('overview', async (id, signal) => await inspector.overview(id, signal), sessionId)
  const overview = read.value
  // This session's commit/push/PR outcomes come from the tool cards the
  // official Chat already holds in its window; no second log is kept.
  const chat = useConversation(snapshot => snapshot.views.get('chat'))
  const rows = useMemo(() => reviewHistory(historyOf(chat?.nodes.values() ?? [])), [chat])
  const upstream = overview?.status.upstream
  return (
    <section style={view} aria-label={t('view.git')}>
      <Toolbar t={t} refresh={read.refresh} bridge={bridge} sessionId={sessionId} />
      <ReadStatus state={read} t={t} />
      {overview !== undefined && (
        <>
          <div style={caption}>{overview.root}</div>
          <div>
            {t('git.head')} · <span style={mono}>{overview.status.head.name}</span>
            {overview.status.head.kind === 'detached' && ` ${t('git.detached')}`}
            {overview.status.head.kind === 'unborn' && ` ${t('git.unborn')}`}
          </div>
          <div>
            {t('git.upstream')} · {upstream === undefined
              ? t('git.noUpstream')
              : <>
                <span style={mono}>{upstream.ref}</span>
                {' · '}
                {upstream.ahead === 0 && upstream.behind === 0
                  ? t('git.inSync')
                  : [
                    upstream.ahead > 0 ? t('git.ahead', { count: upstream.ahead }) : null,
                    upstream.behind > 0 ? t('git.behind', { count: upstream.behind }) : null,
                  ].filter(Boolean).join(' · ')}
              </>}
          </div>
          <div>
            {t('git.remotes')} · {overview.remotes.length === 0
              ? t('git.noRemotes')
              : overview.remotes.map(remote => (
                <span key={remote.name} style={{ marginRight: 12 }}>
                  <span style={mono}>{remote.name}</span> <span style={caption}>{remote.fetchUrl}</span>
                </span>
              ))}
          </div>
          <div style={sectionTitle}>{t('git.commits')}</div>
          {overview.commits.length === 0
            ? <div style={caption}>{t('git.noCommits')}</div>
            : overview.commits.map(commit => (
              <div key={commit.sha} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span style={{ ...caption, ...mono, flex: 'none' }}>{commit.sha.slice(0, 7)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={commit.subject}>{commit.subject}</span>
                <span style={{ ...caption, flex: 'none' }}>{commit.author} · {dateTime(commit.time)}</span>
              </div>
            ))}
        </>
      )}
      <div style={sectionTitle}>{t('git.history')}</div>
      {rows.length === 0
        ? <div style={caption}>{t('git.historyEmpty')}</div>
        : rows.map(row => (
          <div key={`${row.toolName}:${row.seq}`}>
            <div style={{ ...caption, ...mono, lineHeight: '14px' }}>{t('row.atTime', { tool: row.toolName, time: clock(row.time), seq: row.seq })}</div>
            <div style={{
              fontSize: 13, lineHeight: '18px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: row.error ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-primary)',
            }}>
              {row.summary}
            </div>
          </div>
        ))}
      <p style={{ ...caption, margin: 0 }}>{t('git.scope')}</p>
    </section>
  )
}
