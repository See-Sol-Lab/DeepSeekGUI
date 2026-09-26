/**
 * Memory view (D5-c / D20; B7-P9): the session's memory, whichever path is
 * live. In entries mode: what this session's model was shown (from the
 * session log's own record), the entries of this project plus the global
 * ones — search, detail, source, edit, forget, undo, restore — the reviewable
 * import of the project's legacy `<folder>.memory.md`, and that file itself
 * folded away. In markdown mode: the legacy file rendered as before, with a
 * pointer to the switch. Off: a plain statement. The view never writes a
 * file: entries go through the `workbenchMemory` store, the legacy file is
 * the assistant's and the person's to edit natively; the one desktop write
 * it can ask for is the project AGENTS.md template (never overwriting).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchMemory } from '@deepseek-ai/dsh-workbench-inspector/types'
import type { MemoryScope, MemoryScopeFilter, MemoryStatus } from '@deepseek-ai/dsh-workbench-memory/types'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { ImportBlock } from '../memory/ImportBlock.tsx'
import { MemoryEntries, type Translate as MemoryTranslate } from '../memory/MemoryEntries.tsx'
import { errorMessage, unwrap, usedMemoryOf, type MemoryRemote } from '../memory/model.ts'
import { UsedMemory } from '../memory/UsedMemory.tsx'
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
const GLOBAL: MemoryScopeFilter & MemoryScope = { kind: 'global' }

/** The memory store props the plugin entry injects beside the inspector ones. */
export interface MemoryViewInjected {
  memory: MemoryRemote
  /** Subscribe to store changes forwarded from the Host. */
  onMemoryChange: (listener: () => void) => () => void
  /** Whether a source session is still listed; undefined when unknown. */
  sessionPresent: (sessionId: string) => boolean | undefined
  /** The memory namespace's translate function (the view's own `t` is the inspector namespace). */
  tm: MemoryTranslate
}

/** Props of the view. */
export type MemoryViewProps = ViewProps & MemoryViewInjected & Partial<Pick<ConvViewProps, 'useConversation'>>

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
  const { inspector, bridge, sessionId, t, submitInstruction, memory, onMemoryChange, sessionPresent, tm, useConversation } = props
  const read = useRead<WorkbenchMemory>('memory', async (id, signal) => await inspector.memory(id, signal), sessionId)
  const [agentsCreatedFor, setAgentsCreatedFor] = useState<string>()
  const [status, setStatus] = useState<MemoryStatus>()
  const [statusError, setStatusError] = useState<string>()
  const [project, setProject] = useState<{ cwd: string; scope: MemoryScope | null }>()
  const generation = useRef(0)
  const legacy = read.value
  const fileName = legacy?.fileName ?? 'memory.md'
  const cwd = legacy?.cwd
  const hasAgents = (sessionId !== undefined && agentsCreatedFor === sessionId) || legacy?.agents === true
  const desktop = bridge !== null && sessionId !== undefined
  // The Chat window's context rows carry the recall records; a bare render (tests, diagnostics) has no window.
  const chat = useConversation?.(snapshot => snapshot.views.get('chat'))
  const used = useMemo(() => usedMemoryOf(chat?.nodes.values() ?? []), [chat])

  const loadStatus = useCallback(async (): Promise<void> => {
    const mine = generation.current += 1
    try {
      const next = unwrap(await memory.status(new AbortController().signal))
      if (mine !== generation.current) return
      setStatus(next)
      setStatusError(undefined)
    } catch (failure) {
      if (mine !== generation.current) return
      setStatusError(errorMessage(failure))
    }
  }, [memory])
  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => onMemoryChange(() => { void loadStatus() }), [onMemoryChange, loadStatus])

  // The project scope follows the session's folder; a late answer for a folder no longer shown is dropped.
  useEffect(() => {
    if (cwd === undefined) { setProject(undefined); return }
    let alive = true
    memory.projectScope(cwd, new AbortController().signal).then(
      (result) => { if (alive) setProject({ cwd, scope: result.ok ? result.value : null }) },
      () => { if (alive) setProject({ cwd, scope: null }) },
    )
    return () => { alive = false }
  }, [memory, cwd])

  const projectScope = project !== undefined && project.cwd === cwd && project.scope?.kind === 'project' ? project.scope : null
  const scope = useMemo<MemoryScopeFilter>(
    () => (projectScope === null ? GLOBAL : { kind: 'session', projectKey: projectScope.projectKey }),
    [projectScope],
  )
  const importSource = useMemo(() => (cwd === undefined ? undefined : { kind: 'project' as const, cwd }), [cwd])
  const mode = status?.injection

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
    <section style={view} aria-label={t('view.memory')} data-deepseekgui="memory-view" data-mode={mode ?? ''}>
      <Toolbar t={t} refresh={() => { read.refresh(); void loadStatus() }}>
        {desktop && (
          <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void bridge.run({ type: 'open-memory', which: 'project', sessionId }).catch(() => undefined) }}>
            {t('memory.open')}
          </button>
        )}
        {mode === 'markdown' && (
          <button type="button" className={BUTTON_CLASS} style={button} title={t('memory.askTitle')} onClick={() => { void submitInstruction(t('memory.prompt', { file: fileName })) }}>
            {t('memory.ask')}
          </button>
        )}
      </Toolbar>
      {statusError !== undefined && (
        <div role="alert" style={{ color: 'var(--dsw-alias-state-error-primary)' }}>{tm('common.failed', { message: statusError })}</div>
      )}
      {mode === 'entries' && (
        <>
          <p style={guide} role="note">{tm('view.entriesNote')}</p>
          {legacy !== undefined && projectScope === null && <p style={guide} role="note">{tm('view.noProject')}</p>}
          <UsedMemory key={sessionId} memory={memory} used={used} onChange={onMemoryChange} t={tm} />
          <MemoryEntries
            key={JSON.stringify([sessionId, scope])}
            memory={memory}
            scope={scope}
            writeScope={legacy === undefined || (cwd !== undefined && project?.cwd !== cwd) ? null : projectScope ?? GLOBAL}
            {...sessionId === undefined ? {} : { sessionId }}
            onChange={onMemoryChange}
            sessionPresent={sessionPresent}
            t={tm}
            title={projectScope === null ? tm('list.title.global') : tm('list.title.session')}
          />
          {importSource !== undefined && (
            <ImportBlock
              key={JSON.stringify([sessionId, importSource])}
              memory={memory} source={importSource} {...sessionId === undefined ? {} : { sessionId }} t={tm}
            />
          )}
          <p style={{ ...guide, marginTop: 8 }}>{tm('view.globalNav')}</p>
          <details data-deepseekgui="memory-legacy-file">
            <summary style={{ cursor: 'pointer', ...caption }}>{tm('view.legacyFile')}</summary>
            <div style={{ marginTop: 6 }}>
              <ReadStatus state={read} t={t} />
              {legacy !== undefined && <LegacyReader memory={legacy} fileName={fileName} t={t} />}
            </div>
          </details>
        </>
      )}
      {mode === 'markdown' && (
        <>
          <p style={guide} role="note">{tm('view.markdownNote')}</p>
          <div style={{ ...heading, marginTop: 6 }}>{t('memory.title')}</div>
          <p style={guide}>{t('memory.guide1')}</p>
          <p style={guide}>{t('memory.guide2')}</p>
          <ReadStatus state={read} t={t} />
          {read.error !== undefined && /does not exist/u.test(read.error) && (
            <p role="note" style={{ ...caption, marginTop: 4 }}>{t('memory.missingHint')}</p>
          )}
          {legacy !== undefined && <LegacyReader memory={legacy} fileName={fileName} t={t} />}
          <p style={{ ...guide, marginTop: 8 }}>{t('memory.globalNav')}</p>
        </>
      )}
      {mode === 'off' && <p style={guide} role="note">{tm('view.offNote')}</p>}
      {mode === undefined && statusError === undefined && <div role="status" style={caption}>{tm('common.loading')}</div>}
      {about}
      {bridge === null && <div style={caption}>{t('common.noDesktop')}</div>}
    </section>
  )
}
