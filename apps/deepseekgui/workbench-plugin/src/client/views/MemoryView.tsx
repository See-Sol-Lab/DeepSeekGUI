/**
 * Memory view (D5-c / D20; B7-P9; 2026-09-29): the session's project memory,
 * `<folder>.memory.md` in its working directory, which every new window reads
 * once at its start beside the global `<home>/memory.md`. Inside the
 * DeepSeekGUI window the file is edited in place (the desktop writes it,
 * refusing a file that changed underneath); elsewhere it is rendered
 * read-only. The entry-based enhanced memory is gone. The one other desktop
 * write the view can ask for is the project AGENTS.md template (never
 * overwriting).
 */
import { useState } from 'react'
import type { WorkbenchMemory } from '@deepseek-ai/dsh-workbench-inspector/types'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate as MemoryTranslate } from '../locales-memory.ts'
import { ProjectMemoryEditor } from '../memory/ProjectMemoryEditor.tsx'
import { button, BUTTON_CLASS, caption, ReadStatus, Toolbar, useRead, view, type ViewProps } from './shared.tsx'

const reader: React.CSSProperties = {
  padding: '14px 18px', borderRadius: 10,
  border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)',
  color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: '22px',
  // A fixed reading window: the memory grows over time and must scroll inside
  // its own box instead of stretching the page (莉莉丝 2026-09-06).
  height: 420, overflow: 'auto', boxSizing: 'border-box',
}

/**
 * How much of the file the panel renders. Beyond this the panel shows the
 * head and points the person at the file itself; the same figure is the
 * size the shipped guide asks the model to keep the project memory under.
 */
const MEMORY_VIEW_MAX_CHARS = 20_000
const guide: React.CSSProperties = { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', margin: 0 }
const heading: React.CSSProperties = { fontSize: 15, lineHeight: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginTop: 10 }
const emptyBox: React.CSSProperties = { ...reader, color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '28px 18px' }
/** The memory namespace props the plugin entry injects beside the inspector ones. */
export interface MemoryViewInjected {
  /** The memory namespace's translate function (the view's own `t` is the inspector namespace). */
  tm: MemoryTranslate
}

/** Props of the view. */
export type MemoryViewProps = ViewProps & MemoryViewInjected

/** Join cwd and file name with the separator the cwd itself uses. */
function pathOf(memory: WorkbenchMemory): string {
  const posix = memory.cwd.includes('/') && !memory.cwd.includes('\\')
  return `${memory.cwd}${posix ? '/' : '\\'}${memory.fileName}`
}

/** The legacy file, rendered as Markdown in its reading window (unchanged from D5-c). */
function LegacyReader({ memory, fileName, t }: { memory: WorkbenchMemory; fileName: string; t: ViewProps['t'] }) {
  if (memory.text === null || memory.text.trim() === '') {
    return (
      <div style={emptyBox}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{t('memory.empty')}</div>
        <div style={{ ...caption, marginTop: 6 }}>{t('memory.emptyHint', { file: fileName })}</div>
      </div>
    )
  }
  return (
    <div style={reader} data-deepseekgui="memory-reader">
      <MarkdownText
        text={memory.text.slice(0, MEMORY_VIEW_MAX_CHARS)}
        labels={{
          code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
          footnotes: t('markdown.footnotes'),
        }}
      />
      {memory.text.length > MEMORY_VIEW_MAX_CHARS && (
        <p role="note" style={{ ...caption, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
          {t('memory.truncated', { max: MEMORY_VIEW_MAX_CHARS.toLocaleString() })}
        </p>
      )}
    </div>
  )
}

export function MemoryView(props: MemoryViewProps) {
  const { inspector, bridge, sessionId, t, submitInstruction, tm } = props
  const read = useRead<WorkbenchMemory>('memory', async (id, signal) => await inspector.memory(id, signal), sessionId)
  const [agentsCreatedFor, setAgentsCreatedFor] = useState<string>()
  const legacy = read.value
  const fileName = legacy?.fileName ?? 'memory.md'
  const hasAgents = (sessionId !== undefined && agentsCreatedFor === sessionId) || legacy?.agents === true
  const desktop = bridge !== null && sessionId !== undefined

  const about = (
    <details style={{ fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' }}>
      <summary style={{ cursor: 'pointer' }}>{t('memory.aboutTitle')}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
        {legacy !== undefined && <div style={{ overflowWrap: 'anywhere' }}>{t('memory.aboutLocation', { path: pathOf(legacy) })}</div>}
        <div>{t('memory.aboutRoles')}</div>
        <div>{t('memory.aboutGit')}</div>
        {desktop && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
            {hasAgents
              ? (
                <>
                  <span>{t('memory.agentsExists')}</span>
                  <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void bridge.run({ type: 'open-memory', which: 'project-agents', sessionId }).catch(() => undefined) }}>
                    {t('memory.openAgents')}
                  </button>
                </>
              )
              : (
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  style={button}
                  title={t('memory.createAgentsTitle')}
                  onClick={() => { void bridge.run({ type: 'create-project-agents', sessionId }).then(() => setAgentsCreatedFor(sessionId)).catch(() => undefined) }}
                >
                  {t('memory.createAgents')}
                </button>
              )}
          </div>
        )}
      </div>
    </details>
  )

  return (
    <section style={view} aria-label={t('view.memory')} data-deepseekgui="memory-view">
      <Toolbar t={t} refresh={() => { read.refresh() }}>
        {desktop && (
          <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void bridge.run({ type: 'open-memory', which: 'project', sessionId }).catch(() => undefined) }}>
            {t('memory.open')}
          </button>
        )}
        <button type="button" className={BUTTON_CLASS} style={button} title={t('memory.askTitle')} onClick={() => { void submitInstruction(t('memory.prompt', { file: fileName })) }}>
          {t('memory.ask')}
        </button>
      </Toolbar>
      <div style={{ ...heading, marginTop: 6 }}>{t('memory.title')}</div>
      <p style={guide}>{t('memory.guide1')}</p>
      <p style={guide}>{t('memory.guide2')}</p>
      <ReadStatus state={read} t={t} />
      {read.error !== undefined && /does not exist/u.test(read.error) && (
        <p role="note" style={{ ...caption, marginTop: 4 }}>{t('memory.missingHint')}</p>
      )}
      {legacy !== undefined && (desktop
        ? <ProjectMemoryEditor key={`${sessionId}:${legacy.text ?? ''}`} sessionId={sessionId} memory={legacy} bridge={bridge} onSaved={() => { read.refresh() }} t={tm} />
        : <LegacyReader memory={legacy} fileName={fileName} t={t} />)}
      <p style={{ ...guide, marginTop: 8 }}>{t('memory.globalNav')}</p>
      {about}
      {bridge === null && <div style={caption}>{t('common.noDesktop')}</div>}
    </section>
  )
}
