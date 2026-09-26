/**
 * The entry list (B7-P9): search, kind filter, a detail per entry with its
 * source and history, editing, forgetting, undo of the latest change, the
 * forgotten entries with an explicit restore, and a small add form. One
 * data entry — the `workbenchMemory` Remote namespace — shared with the
 * session tools and the automatic records: every write quotes the version
 * the page read, a stale one is refused by the store and shown as a
 * conflict with a reload, and nothing shows as done before the store said
 * so. Reads and writes are keyed by the scope and a generation, so a
 * result that arrives after the target moved on (another session, another
 * search) never lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MemoryEntry, MemoryError, MemoryForgottenEntry, MemoryKind, MemoryScope, MemoryScopeFilter, MemorySource,
} from '@deepseek-ai/dsh-workbench-memory/types'
import { parseContinuation } from '@deepseek-ai/dsh-workbench-memory/continuation'
import type { MemoryKey } from '../locales-memory.ts'
import { errorMessage, formatTime, keywordsFrom, KINDS, oneLine, unwrap, type MemoryRemote } from './model.ts'
import { badge, button, BUTTON_CLASS, caption, card, column, dangerButton, errorText, heading, input, mono, pre, primaryButton, row, textarea, warnText } from './styles.ts'

/** Translate function of the memory namespace. */
export type Translate = (key: MemoryKey, params?: Record<string, unknown>) => string

/** Props of the list. */
export interface MemoryEntriesProps {
  memory: MemoryRemote
  /** The read scope. */
  scope: MemoryScopeFilter
  /** Where the add form writes; null hides the form. */
  writeScope: MemoryScope | null
  /** The session a page write is attributed to, when the page sits in one. */
  sessionId?: string
  /** Subscribe to store changes forwarded from the Host. */
  onChange: (listener: () => void) => () => void
  /** Whether a source session is still listed; undefined when unknown. */
  sessionPresent?: (sessionId: string) => boolean | undefined
  t: Translate
  title: string
}

/** Page size of one read; the search narrows beyond it. */
const PAGE = 100

/** Per-entry outcome of the last action. */
type Notice =
  | { kind: 'saved' | 'forgotten' | 'undone' | 'restored' | 'changed' }
  | { kind: 'conflict'; version: number }
  | { kind: 'failed'; message: string }

interface Draft {
  id: string
  expectedVersion: number
  content: string
  keywords: string
  kind: MemoryKind
}

interface Listing {
  key: string
  entries: MemoryEntry[]
  total: number
}

function sourceWho(source: MemorySource, t: Translate, sessionPresent?: (id: string) => boolean | undefined): string {
  const who = t(`entry.source.${source.kind}`)
  if (source.sessionId === undefined) return who
  const session = t('entry.sourceSession', { id: source.sessionId })
  if (source.sessionDeleted === true) return `${who} · ${session} ${t('entry.sourceSessionDeleted')}`
  if (sessionPresent?.(source.sessionId) === false) return `${who} · ${session} ${t('entry.sourceSessionMissing')}`
  return `${who} · ${session}`
}

/** A memory error carried by a Remote result value (the store's own refusal). */
function storeError(error: MemoryError): Notice {
  if (error.code === 'MEMORY_CONFLICT' && error.currentVersion !== undefined) return { kind: 'conflict', version: error.currentVersion }
  return { kind: 'failed', message: `${error.code}: ${error.message}` }
}

function ContinuationParts({ content, t }: { content: string; t: Translate }) {
  const note = parseContinuation(content)
  if (note === undefined) return <pre style={pre}>{content}</pre>
  const part = (label: MemoryKey, items: readonly string[]) => (
    <div>
      <span style={{ fontWeight: 600 }}>{t(label)}：</span>
      {items.length === 0 ? <span style={caption}>{t('cont.none')}</span> : items.join('；')}
    </div>
  )
  return (
    <div style={{ ...column, gap: 2 }} data-deepseekgui="memory-continuation">
      <div><span style={{ fontWeight: 600 }}>{t('cont.goal')}：</span>{note.goal}</div>
      {part('cont.decisions', note.decisions)}
      {part('cont.unfinished', note.unfinished)}
      {part('cont.leads', note.leads)}
      {part('cont.verified', note.verified)}
    </div>
  )
}

export function MemoryEntries({ memory, scope, writeScope, sessionId, onChange, sessionPresent, t, title }: MemoryEntriesProps) {
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<MemoryKind | ''>('')
  const [listing, setListing] = useState<Listing>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [open, setOpen] = useState<string>()
  const [draft, setDraft] = useState<Draft>()
  const [busy, setBusy] = useState<string>()
  const [notices, setNotices] = useState<Record<string, Notice>>({})
  const [forgotten, setForgotten] = useState<{ key: string; entries: MemoryForgottenEntry[] }>()
  const [showForgotten, setShowForgotten] = useState(false)
  const [addText, setAddText] = useState('')
  const [addKind, setAddKind] = useState<MemoryKind>('fact')
  const [adding, setAdding] = useState(false)
  const [addNotice, setAddNotice] = useState<{ ok: true; id: string } | { ok: false; message: string }>()
  const generation = useRef(0)
  const scopeKey = JSON.stringify(scope)
  const key = JSON.stringify([scopeKey, text, kind])
  // The current targets: a result lands only while the read key (list) or the scope (writes) it was issued for is still shown.
  const keyRef = useRef(key)
  keyRef.current = key
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey
  // The scope object itself, read through a ref so a parent re-render never restarts the reads.
  const scopeValue = useRef(scope)
  scopeValue.current = scope
  const draftRef = useRef(draft)
  draftRef.current = draft

  // The search field settles for a moment before it becomes a read.
  useEffect(() => {
    const timer = setTimeout(() => { setText(query.trim()) }, 150)
    return () => { clearTimeout(timer) }
  }, [query])

  const load = useCallback(async (): Promise<void> => {
    const mine = generation.current += 1
    const forKey = keyRef.current
    setLoading(true)
    setLoadError(undefined)
    try {
      const page = unwrap(await memory.list({
        scope: scopeValue.current,
        ...text === '' ? {} : { text },
        ...kind === '' ? {} : { kinds: [kind] },
        limit: PAGE,
      }, new AbortController().signal))
      if (mine !== generation.current || keyRef.current !== forKey) return
      setListing({ key: forKey, entries: page.entries, total: page.total })
      // An open draft whose entry moved on elsewhere: keep the text, say so.
      const editing = draftRef.current
      if (editing !== undefined) {
        const live = page.entries.find(entry => entry.id === editing.id)
        if (live !== undefined && live.version !== editing.expectedVersion) {
          setNotices(previous => ({ ...previous, [editing.id]: { kind: 'changed' } }))
        }
      }
    } catch (error) {
      if (mine !== generation.current || keyRef.current !== forKey) return
      setLoadError(errorMessage(error))
    } finally {
      if (mine === generation.current && keyRef.current === forKey) setLoading(false)
    }
  }, [memory, scopeKey, text, kind])

  const loadForgotten = useCallback(async (): Promise<void> => {
    const forScope = scopeKey
    try {
      const entries = unwrap(await memory.listForgotten(scopeValue.current, new AbortController().signal))
      if (scopeRef.current === forScope) setForgotten({ key: forScope, entries })
    } catch (error) {
      if (scopeRef.current === forScope) setLoadError(errorMessage(error))
    }
  }, [memory, scopeKey])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (showForgotten) void loadForgotten() }, [showForgotten, loadForgotten])
  useEffect(() => onChange(() => {
    void load()
    if (showForgotten) void loadForgotten()
  }), [onChange, load, loadForgotten, showForgotten])

  const current = listing !== undefined && listing.key === key ? listing : undefined
  const source: Omit<MemorySource, 'at'> = { kind: 'user', ...sessionId === undefined ? {} : { sessionId } }

  const note = (id: string, notice: Notice | undefined): void => {
    setNotices((previous) => {
      const next = { ...previous }
      if (notice === undefined) delete next[id]
      else next[id] = notice
      return next
    })
  }

  /** Run one write for an entry; the outcome lands only while the same scope is shown. */
  const act = async (id: string, run: () => Promise<{ ok: true; entry: MemoryEntry } | { ok: false; error: MemoryError }>, done: Notice['kind'], apply: (entry: MemoryEntry) => void): Promise<void> => {
    const forScope = scopeKey
    setBusy(id)
    note(id, undefined)
    try {
      const result = await run()
      if (scopeRef.current !== forScope) return
      if (result.ok) {
        apply(result.entry)
        note(id, { kind: done } as Notice)
      } else {
        note(id, storeError(result.error))
      }
    } catch (error) {
      note(id, { kind: 'failed', message: errorMessage(error) })
    } finally {
      setBusy(previous => (previous === id ? undefined : previous))
    }
  }

  const replaceEntry = (entry: MemoryEntry): void => {
    setListing(previous => (previous === undefined
      ? previous
      : { ...previous, entries: previous.entries.map(item => (item.id === entry.id ? entry : item)) }))
  }
  const dropEntry = (id: string): void => {
    setListing(previous => (previous === undefined
      ? previous
      : { ...previous, entries: previous.entries.filter(item => item.id !== id), total: previous.total - 1 }))
  }

  const beginEdit = (entry: MemoryEntry): void => {
    setDraft({ id: entry.id, expectedVersion: entry.version, content: entry.content, keywords: (entry.keywords ?? []).join(', '), kind: entry.kind })
    setOpen(entry.id)
    note(entry.id, undefined)
  }

  const saveEdit = async (): Promise<void> => {
    if (draft === undefined) return
    if (draft.content.trim() === '') {
      note(draft.id, { kind: 'failed', message: t('edit.empty') })
      return
    }
    const mine = draft
    await act(mine.id, async () => unwrap(await memory.correct({
      id: mine.id,
      expectedVersion: mine.expectedVersion,
      content: mine.content,
      keywords: keywordsFrom(mine.keywords),
      kind: mine.kind,
      source,
    })), 'saved', (entry) => {
      replaceEntry(entry)
      setDraft(previous => (previous?.id === mine.id ? undefined : previous))
    })
  }

  const reload = (id: string): void => {
    setDraft(previous => (previous?.id === id ? undefined : previous))
    note(id, undefined)
    void load()
  }

  const forget = async (entry: MemoryEntry): Promise<void> => {
    await act(entry.id, async () => unwrap(await memory.forget({ id: entry.id, expectedVersion: entry.version, source })), 'forgotten', () => {
      dropEntry(entry.id)
      setDraft(previous => (previous?.id === entry.id ? undefined : previous))
      if (showForgotten) void loadForgotten()
    })
  }

  const undo = async (entry: MemoryEntry): Promise<void> => {
    await act(entry.id, async () => unwrap(await memory.undo({ id: entry.id, expectedVersion: entry.version, source })), 'undone', replaceEntry)
  }

  const restore = async (record: MemoryForgottenEntry): Promise<void> => {
    const id = record.entry.id
    await act(id, async () => unwrap(await memory.restore({ id, source })), 'restored', () => {
      setForgotten(previous => (previous === undefined
        ? previous
        : { ...previous, entries: previous.entries.filter(item => item.entry.id !== id) }))
      void load()
    })
  }

  const add = async (): Promise<void> => {
    if (writeScope === null || addText.trim() === '') return
    const forScope = scopeKey
    setAdding(true)
    setAddNotice(undefined)
    try {
      const result = unwrap(await memory.remember({ scope: writeScope, kind: addKind, content: addText.trim(), source }))
      if (scopeRef.current !== forScope) return
      if (result.ok) {
        setAddNotice({ ok: true, id: result.entry.id })
        setAddText('')
        void load()
      } else {
        setAddNotice({ ok: false, message: `${result.error.code}: ${result.error.message}` })
      }
    } catch (error) {
      setAddNotice({ ok: false, message: errorMessage(error) })
    } finally {
      setAdding(false)
    }
  }

  const noticeOf = (id: string): React.ReactNode => {
    const notice = notices[id]
    if (notice === undefined) return null
    switch (notice.kind) {
      case 'saved': return <span role="status" style={caption}>{t('entry.saved')}</span>
      case 'forgotten': return <span role="status" style={caption}>{t('entry.forgotten')}</span>
      case 'undone': return <span role="status" style={caption}>{t('entry.undone')}</span>
      case 'restored': return <span role="status" style={caption}>{t('forgotten.restored')}</span>
      case 'changed': return <span role="alert" style={warnText}>{t('entry.changedElsewhere')} <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { reload(id) }}>{t('entry.reload')}</button></span>
      case 'conflict': return <span role="alert" style={warnText}>{t('entry.conflict', { version: notice.version })} <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { reload(id) }}>{t('entry.reload')}</button></span>
      case 'failed': return <span role="alert" style={errorText}>{t('entry.failed', { message: notice.message })}</span>
    }
  }

  const renderEntry = (entry: MemoryEntry): React.ReactNode => {
    const expanded = open === entry.id
    const editing = draft?.id === entry.id
    const disabled = busy === entry.id
    return (
      <div key={entry.id} style={card} data-deepseekgui="memory-entry" data-entry-id={entry.id}>
        <div style={row}>
          <span style={badge}>{t(`kind.${entry.kind}`)}</span>
          <span style={badge}>{t(`scope.${entry.scope.kind}`)}</span>
          <button
            type="button"
            style={{ ...button, border: 'none', padding: 0, flex: 1, textAlign: 'left', color: 'var(--dsw-alias-label-primary)', fontSize: 14, lineHeight: '22px' }}
            aria-expanded={expanded}
            onClick={() => { setOpen(expanded ? undefined : entry.id) }}
          >
            {oneLine(entry.content)}
          </button>
          <span style={{ ...caption, ...mono }}>#{entry.id} {t('entry.version', { version: entry.version })}</span>
        </div>
        {expanded && !editing && (
          <div style={{ ...column, gap: 4 }} data-deepseekgui="memory-entry-detail">
            {entry.kind === 'continuation' ? <ContinuationParts content={entry.content} t={t} /> : <pre style={pre}>{entry.content}</pre>}
            {entry.keywords !== undefined && entry.keywords.length > 0 && <div style={caption}>{t('entry.keywords', { keywords: entry.keywords.join(', ') })}</div>}
            <div style={caption}>{t('entry.source', { who: sourceWho(entry.source, t, sessionPresent) })} · {t('entry.created', { time: formatTime(entry.createdAt) })}</div>
            {entry.source.evidence !== undefined && <div style={caption}>{t('entry.evidence', { text: entry.source.evidence })}</div>}
            {entry.source.detail !== undefined && <div style={caption}>{t('entry.detail', { text: entry.source.detail })}</div>}
            {entry.revised !== undefined && (
              <div style={caption}>
                {t('entry.revised', { action: t(`action.${entry.revised.action}`), time: formatTime(entry.revised.at), who: sourceWho(entry.revised.source, t, sessionPresent) })}
                {entry.previous !== undefined && ` · ${t('entry.previous', { version: entry.previous.version })}`}
              </div>
            )}
            <div style={row}>
              <button type="button" className={BUTTON_CLASS} style={button} disabled={disabled} onClick={() => { beginEdit(entry) }}>{t('entry.edit')}</button>
              {entry.previous !== undefined && (
                <button type="button" className={BUTTON_CLASS} style={button} disabled={disabled} onClick={() => { void undo(entry) }}>{t('entry.undo')}</button>
              )}
              <button type="button" className={BUTTON_CLASS} style={dangerButton} disabled={disabled} title={t('entry.forgetTitle')} onClick={() => { void forget(entry) }}>{t('entry.forget')}</button>
              {noticeOf(entry.id)}
            </div>
          </div>
        )}
        {expanded && editing && draft !== undefined && (
          <div style={{ ...column, gap: 6 }} data-deepseekgui="memory-entry-edit">
            <label style={column}>
              <span style={caption}>{t('edit.content')}</span>
              <textarea
                rows={4}
                style={textarea}
                value={draft.content}
                onChange={(event) => { setDraft({ ...draft, content: event.target.value }) }}
              />
            </label>
            <label style={column}>
              <span style={caption}>{t('edit.keywords')}</span>
              <input style={input} value={draft.keywords} onChange={(event) => { setDraft({ ...draft, keywords: event.target.value }) }} />
            </label>
            <label style={row}>
              <span style={caption}>{t('edit.kind')}</span>
              <select style={{ ...input, width: 'auto' }} value={draft.kind} onChange={(event) => { setDraft({ ...draft, kind: event.target.value as MemoryKind }) }}>
                {KINDS.map(option => <option key={option} value={option}>{t(`kind.${option}`)}</option>)}
              </select>
            </label>
            <div style={row}>
              <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={disabled} onClick={() => { void saveEdit() }} data-deepseekgui="memory-entry-save">
                {disabled ? t('entry.saving') : t('entry.save')}
              </button>
              <button type="button" className={BUTTON_CLASS} style={button} disabled={disabled} onClick={() => { setDraft(undefined); note(entry.id, undefined) }}>{t('entry.cancel')}</button>
              {noticeOf(entry.id)}
            </div>
          </div>
        )}
        {!expanded && noticeOf(entry.id)}
      </div>
    )
  }

  const shownForgotten = forgotten !== undefined && forgotten.key === scopeKey ? forgotten.entries : undefined
  return (
    <div style={column} data-deepseekgui="memory-entries">
      <div style={row}>
        <span style={heading}>{title}</span>
        {current !== undefined && <span style={caption}>{t('list.count', { total: current.total })}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} disabled={loading} onClick={() => { void load() }}>{t('common.refresh')}</button>
      </div>
      <div style={row}>
        <input
          style={{ ...input, flex: 1, width: 'auto', minWidth: 160 }}
          value={query}
          placeholder={t('list.searchHint')}
          aria-label={t('list.search')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
        <select style={{ ...input, width: 'auto' }} value={kind} aria-label={t('edit.kind')} onChange={(event) => { setKind(event.target.value as MemoryKind | '') }}>
          <option value="">{t('list.kind.all')}</option>
          {KINDS.map(option => <option key={option} value={option}>{t(`kind.${option}`)}</option>)}
        </select>
      </div>
      {loading && current === undefined && <div role="status" style={caption}>{t('common.loading')}</div>}
      {loadError !== undefined && <div role="alert" style={errorText}>{t('common.failed', { message: loadError })}</div>}
      {current !== undefined && current.entries.length === 0 && (
        <div style={caption}>{text === '' && kind === '' ? t('list.empty') : t('list.noMatch')}</div>
      )}
      {current?.entries.map(renderEntry)}
      {current !== undefined && current.total > current.entries.length && <div style={caption}>{t('list.more', { shown: current.entries.length })}</div>}
      {writeScope !== null && (
        <div style={card} data-deepseekgui="memory-add">
          <span style={{ fontWeight: 600 }}>{t('add.title')}</span>
          <textarea rows={2} style={textarea} value={addText} placeholder={t('add.placeholder')} aria-label={t('add.title')} onChange={(event) => { setAddText(event.target.value) }} />
          <div style={row}>
            <select style={{ ...input, width: 'auto' }} value={addKind} onChange={(event) => { setAddKind(event.target.value as MemoryKind) }}>
              {KINDS.filter(option => option !== 'continuation').map(option => <option key={option} value={option}>{t(`kind.${option}`)}</option>)}
            </select>
            <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={adding || addText.trim() === ''} onClick={() => { void add() }} data-deepseekgui="memory-add-submit">
              {adding ? t('add.adding') : t('add.submit')}
            </button>
            {addNotice?.ok === true && <span role="status" style={caption}>{t('add.added', { id: addNotice.id })}</span>}
            {addNotice?.ok === false && <span role="alert" style={errorText}>{t('entry.failed', { message: addNotice.message })}</span>}
          </div>
        </div>
      )}
      <details onToggle={(event) => { setShowForgotten((event.target as HTMLDetailsElement).open) }} data-deepseekgui="memory-forgotten">
        <summary style={{ cursor: 'pointer', ...caption }}>{t('forgotten.title')}</summary>
        <div style={{ ...column, marginTop: 6 }}>
          {showForgotten && shownForgotten === undefined && <div role="status" style={caption}>{t('common.loading')}</div>}
          {shownForgotten !== undefined && shownForgotten.length === 0 && <div style={caption}>{t('forgotten.empty')}</div>}
          {shownForgotten?.map(record => (
            <div key={record.entry.id} style={card} data-deepseekgui="memory-forgotten-entry" data-entry-id={record.entry.id}>
              <div style={row}>
                <span style={badge}>{t(`kind.${record.entry.kind}`)}</span>
                <span style={badge}>{t(`scope.${record.entry.scope.kind}`)}</span>
                <span style={{ flex: 1 }}>{oneLine(record.entry.content)}</span>
                <span style={{ ...caption, ...mono }}>#{record.entry.id}</span>
              </div>
              <div style={row}>
                <span style={caption}>{t('forgotten.at', { time: formatTime(record.forgottenAt) })} · {sourceWho(record.forgottenBy, t, sessionPresent)}</span>
                <button type="button" className={BUTTON_CLASS} style={button} disabled={busy === record.entry.id} onClick={() => { void restore(record) }}>
                  {busy === record.entry.id ? t('forgotten.restoring') : t('forgotten.restore')}
                </button>
                {noticeOf(record.entry.id)}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
