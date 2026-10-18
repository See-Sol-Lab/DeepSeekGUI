/**
 * The global memory editor (B7-P9, moved here from the JS settings plugin):
 * the person edits `<home>/memory.md` here, and every new window reads it
 * once at its start. The text comes from the desktop control model
 * (a bounded read of the file), the save goes through the closed
 * `save-global-memory` command with the text the edit started from, so a
 * file changed underneath is refused rather than overwritten; an unreadable
 * file disables saving so the original is never replaced by a blank.
 *
 * Phase 2 (2026-10-05, after Sol's P2-03/P2-04): archive-notes suggestions are
 * listed above the editor. The suggestions file belongs to the harness-side
 * inspector alone; this page only reads it and asks the inspector to drop an
 * entry. Adding one is an ordinary global-memory save — same Home and
 * same "text the edit started from" check as the Save button — and is only
 * offered with no unsaved draft, with the editor locked while it runs, so a
 * suggestion action can never move the draft's base under it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemorySuggestion } from '@deepseek-ai/dsh-workbench-inspector/types'
import type { ControlBridgeClient, ControlModelSnapshot } from '../bridge.ts'
import type { InspectorRemote } from '../views/shared.tsx'
import { errorMessage, type Translate } from '../locales-memory.ts'
import { button, BUTTON_CLASS, caption, column, errorText, intro, mono, primaryButton, row, textarea } from './styles.ts'

/** Props of the editor. */
export interface LegacyGlobalEditorProps {
  bridge: ControlBridgeClient | null
  /** The harness inspector (archive-notes suggestions); null outside a mounted harness. */
  inspector: InspectorRemote | null
  t: Translate
}

interface Loaded {
  home: string
  /** The file text; null when unreadable (or absent from an older desktop). */
  text: string | null
}

function loadedOf(model: ControlModelSnapshot): Loaded {
  return { home: model.dshHome ?? '', text: model.globalMemory ?? null }
}

/** The line a suggestion becomes in memory.md. */
function suggestionLine(text: string): string {
  return `- ${text}`
}

function separatorOf(home: string): string {
  return home.includes('/') && !home.includes('\\') ? '/' : '\\'
}

export function LegacyGlobalEditor({ bridge, inspector, t }: LegacyGlobalEditorProps) {
  const [loaded, setLoaded] = useState<Loaded>()
  const [loadError, setLoadError] = useState<string>()
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: true } | { ok: false; message: string }>()
  // The text the current edit started from: the save quotes it, the desktop refuses a file that moved on.
  const expected = useRef<string | null>(null)
  const alive = useRef(true)
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([])
  const [acting, setActing] = useState(false)

  const loadSuggestions = useCallback(async (): Promise<void> => {
    if (inspector === null) return
    const result = await inspector.memorySuggestions(new AbortController().signal).catch(() => null)
    if (alive.current && result !== null && result.ok) setSuggestions(result.value)
  }, [inspector])
  useEffect(() => { void loadSuggestions() }, [loadSuggestions])

  useEffect(() => {
    alive.current = true
    if (bridge === null) return () => { alive.current = false }
    bridge.model(null).then(
      (envelope) => {
        if (!alive.current || !envelope.changed) return
        const next = loadedOf(envelope.model)
        setLoaded(next)
        expected.current = next.text
      },
      (error: unknown) => { if (alive.current) setLoadError(errorMessage(error)) },
    )
    return () => { alive.current = false }
  }, [bridge])

  if (bridge === null) return <div style={caption}>{t('common.noDesktop')}</div>
  const unreadable = loaded !== undefined && loaded.text === null
  const value = draft ?? loaded?.text ?? ''
  const dirty = draft !== undefined && draft !== loaded?.text
  const home = loaded?.home ?? ''
  const sep = separatorOf(home)

  const save = async (): Promise<void> => {
    if (loaded === undefined || draft === undefined) return
    const submitted = draft
    setSaving(true)
    setNotice(undefined)
    try {
      await bridge.run({ type: 'save-global-memory', content: submitted, home: loaded.home, expected: expected.current })
      if (!alive.current) return
      expected.current = submitted
      setLoaded({ home: loaded.home, text: submitted })
      setDraft(current => current === submitted ? undefined : current)
      setNotice({ ok: true })
    } catch (error) {
      if (alive.current) setNotice({ ok: false, message: errorMessage(error) })
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  /**
   * Add one suggestion: an ordinary protected save of the current file plus one
   * line, then ask the inspector to drop the entry. A line already present
   * (an earlier add whose drop did not land) is not written twice.
   */
  const accept = async (entry: MemorySuggestion): Promise<void> => {
    if (loaded === undefined || loaded.text === null || dirty || inspector === null) return
    setActing(true)
    setNotice(undefined)
    try {
      const line = suggestionLine(entry.text)
      if (!loaded.text.split(/\r?\n/u).some(existing => existing.trim() === line)) {
        const base = loaded.text.replace(/\s+$/u, '')
        const content = `${base}${base === '' ? '' : '\n'}${line}\n`
        await bridge.run({ type: 'save-global-memory', content, home: loaded.home, expected: expected.current })
        if (!alive.current) return
        expected.current = content
        setLoaded({ home: loaded.home, text: content })
      }
      const dropped = await inspector.resolveMemorySuggestion(entry.id, new AbortController().signal)
      if (!dropped.ok) throw new Error(dropped.error.message)
      await loadSuggestions()
      if (alive.current) setNotice({ ok: true })
    } catch (error) {
      if (alive.current) setNotice({ ok: false, message: errorMessage(error) })
    } finally {
      if (alive.current) setActing(false)
    }
  }

  /** Dismiss one suggestion: only the suggestions list changes; the file and the draft's base stay as they are. */
  const dismiss = async (entry: MemorySuggestion): Promise<void> => {
    if (inspector === null) return
    setActing(true)
    try {
      const dropped = await inspector.resolveMemorySuggestion(entry.id, new AbortController().signal)
      if (!dropped.ok) throw new Error(dropped.error.message)
      await loadSuggestions()
    } catch (error) {
      if (alive.current) setNotice({ ok: false, message: errorMessage(error) })
    } finally {
      if (alive.current) setActing(false)
    }
  }

  return (
    <div style={column} data-deepseekgui="memory-legacy-global">
      <p style={intro}>{t('legacy.intro')}</p>
      {suggestions.length > 0 && (
        <div style={column} data-deepseekgui="memory-suggestions">
          <p style={intro}>{t('suggest.intro')}</p>
          {suggestions.map(entry => (
            <div key={entry.id} style={row}>
              <span style={{ flex: 1 }}>{entry.text}</span>
              <button type="button" className={BUTTON_CLASS} style={button} disabled={unreadable || dirty || acting || loaded === undefined} title={dirty ? t('suggest.saveFirst') : undefined} onClick={() => { void accept(entry) }}>{t('suggest.accept')}</button>
              <button type="button" className={BUTTON_CLASS} style={button} disabled={acting} onClick={() => { void dismiss(entry) }}>{t('suggest.dismiss')}</button>
            </div>
          ))}
        </div>
      )}
      {loadError !== undefined && <div role="alert" style={errorText}>{t('common.failed', { message: loadError })}</div>}
      {unreadable && <div role="alert" style={errorText}>{t('legacy.unreadable')}</div>}
      <textarea
        rows={10}
        style={textarea}
        value={value}
        disabled={loaded === undefined || unreadable || acting}
        placeholder={t('legacy.placeholder')}
        aria-label={t('nav.memory')}
        onChange={(event) => { setDraft(event.target.value); setNotice(undefined) }}
      />
      <p style={intro}>{t('legacy.note')}</p>
      <div style={row}>
        <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={unreadable || !dirty || saving} onClick={() => { void save() }} data-deepseekgui="memory-legacy-save">
          {saving ? t('legacy.saving') : t('legacy.save')}
        </button>
        {notice?.ok === true && <span role="status" style={caption}>{t('legacy.saved')}</span>}
        {notice?.ok === false && <span role="alert" style={errorText}>{t('legacy.failed', { message: notice.message })}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void bridge.run({ type: 'open-memory', which: 'global' }).catch(() => undefined) }}>{t('legacy.open')}</button>
      </div>
      <p style={intro}>{t('legacy.kept')}</p>
      <p style={intro}>{t('legacy.projectNote')}</p>
      {home !== '' && <div style={{ ...caption, ...mono }}>{t('legacy.location', { path: `${home}${sep}memory.md` })}</div>}
      <p style={intro}>{t('legacy.agentsNote')}</p>
      <div style={row}>
        <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void bridge.run({ type: 'open-memory', which: 'global-agents' }).catch(() => undefined) }}>{t('legacy.agentsOpen')}</button>
        {home !== '' && <span style={{ ...caption, ...mono }}>{`${home}${sep}AGENTS.md`}</span>}
      </div>
    </div>
  )
}
