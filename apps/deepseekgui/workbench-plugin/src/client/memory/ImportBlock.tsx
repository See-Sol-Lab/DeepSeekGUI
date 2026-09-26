/**
 * Import of one legacy Markdown memory file (B7-P9): a reviewable preview
 * — the file cut into segments under their headings, duplicates of live
 * entries marked and unticked — then an explicit apply of the ticked
 * segments. The preview writes nothing; the apply writes in order and
 * reports where it stopped; the file itself is never modified.
 */
import { useRef, useState } from 'react'
import type { MemoryImportOutcome, MemoryImportPreview, MemoryImportSource } from '@deepseek-ai/dsh-workbench-memory/types'
import type { Translate } from './MemoryEntries.tsx'
import { errorMessage, unwrap, type MemoryRemote } from './model.ts'
import { button, BUTTON_CLASS, caption, card, column, errorText, heading, intro, mono, primaryButton, row } from './styles.ts'

/** Props of the block. */
export interface ImportBlockProps {
  memory: MemoryRemote
  source: MemoryImportSource
  /** The session an import from a session page is attributed to. */
  sessionId?: string
  t: Translate
}

interface Preview {
  key: string
  preview: MemoryImportPreview
  ticked: Set<string>
}

export function ImportBlock({ memory, source, sessionId, t }: ImportBlockProps) {
  const [state, setState] = useState<Preview>()
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string>()
  const [outcome, setOutcome] = useState<MemoryImportOutcome>()
  const sourceKey = JSON.stringify(source)
  const sourceRef = useRef(sourceKey)
  sourceRef.current = sourceKey
  const generation = useRef(0)

  const preview = async (keepOutcome = false): Promise<void> => {
    const mine = generation.current += 1
    const forSource = sourceKey
    setLoading(true)
    setError(undefined)
    if (!keepOutcome) setOutcome(undefined)
    try {
      const result = unwrap(await memory.previewImport(source, new AbortController().signal))
      if (mine !== generation.current || sourceRef.current !== forSource) return
      setState({
        key: forSource,
        preview: result,
        ticked: new Set(result.candidates.filter(candidate => candidate.duplicateOf === null).map(candidate => candidate.key)),
      })
    } catch (failure) {
      if (mine !== generation.current || sourceRef.current !== forSource) return
      setError(errorMessage(failure))
    } finally {
      if (mine === generation.current && sourceRef.current === forSource) setLoading(false)
    }
  }

  const current = state !== undefined && state.key === sourceKey ? state : undefined

  const apply = async (): Promise<void> => {
    if (current === undefined || current.ticked.size === 0) return
    const forSource = sourceKey
    const selections = current.preview.candidates
      .filter(candidate => current.ticked.has(candidate.key))
      .map(candidate => ({ key: candidate.key }))
    setApplying(true)
    setError(undefined)
    try {
      const request = { source, selections, ...sessionId === undefined ? {} : { sessionId } }
      const result = unwrap(await memory.applyImport(request, new AbortController().signal))
      if (sourceRef.current !== forSource) return
      setOutcome(result)
      // Re-read so what landed shows as already stored and stays unticked; the outcome stays on screen.
      await preview(true)
    } catch (failure) {
      if (sourceRef.current !== forSource) return
      setError(errorMessage(failure))
    } finally {
      if (sourceRef.current === forSource) setApplying(false)
    }
  }

  const tick = (key: string, next: boolean): void => {
    setState((previous) => {
      if (previous === undefined) return previous
      const ticked = new Set(previous.ticked)
      if (next) ticked.add(key)
      else ticked.delete(key)
      return { ...previous, ticked }
    })
  }
  const tickAll = (next: boolean): void => {
    setState((previous) => {
      if (previous === undefined) return previous
      const fresh = previous.preview.candidates.filter(candidate => candidate.duplicateOf === null).map(candidate => candidate.key)
      const ticked = next ? new Set(fresh) : new Set<string>()
      return { ...previous, ticked }
    })
  }

  const problem = current?.preview.problem
  const candidates = current?.preview.candidates ?? []
  const stopped = outcome?.failedAt
  const stoppedLine = stopped === undefined ? undefined : current?.preview.candidates.find(candidate => candidate.key === stopped.key)?.line
  return (
    <div style={column} data-deepseekgui="memory-import">
      <div style={row}>
        <span style={heading}>{t('import.title')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} disabled={loading || applying} onClick={() => { void preview() }} data-deepseekgui="memory-import-preview">
          {loading ? t('import.previewing') : t('import.preview')}
        </button>
        {current !== undefined && <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { setState(undefined); setOutcome(undefined) }}>{t('import.close')}</button>}
      </div>
      <p style={intro}>{t('import.intro')}</p>
      {error !== undefined && <div role="alert" style={errorText}>{t('import.failed', { message: error })}</div>}
      {outcome !== undefined && (
        <div role="status" style={stopped === undefined ? caption : { ...caption, ...errorText }}>
          {stopped === undefined
            ? t('import.done', { written: outcome.written.length, skipped: outcome.skipped.length })
            : t('import.stopped', { line: stoppedLine === undefined ? stopped.key : t('import.line', { line: stoppedLine }), message: `${stopped.error.code}: ${stopped.error.message}`, written: outcome.written.length })}
        </div>
      )}
      {current !== undefined && (
        <>
          <div style={{ ...caption, ...mono }}>{t('import.file', { path: current.preview.path })}</div>
          {problem !== undefined && <div role="note" style={caption}>{t(`import.problem.${problem}`)}</div>}
          {problem === undefined && candidates.length > 0 && (
            <>
              <div style={row}>
                <span style={caption}>{t('import.candidates', { count: candidates.length })}</span>
                <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { tickAll(true) }}>{t('import.selectAll')}</button>
                <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { tickAll(false) }}>{t('import.selectNone')}</button>
              </div>
              {candidates.map(candidate => (
                <label key={candidate.key} style={{ ...card, cursor: 'pointer' }} data-deepseekgui="memory-import-candidate">
                  <div style={row}>
                    <input
                      type="checkbox"
                      checked={current.ticked.has(candidate.key)}
                      disabled={applying}
                      aria-label={t('import.line', { line: candidate.line })}
                      onChange={(event) => { tick(candidate.key, event.target.checked) }}
                    />
                    <span style={caption}>{t('import.line', { line: candidate.line })}</span>
                    {candidate.headings.length > 0 && <span style={caption}>{candidate.headings.join(' › ')}</span>}
                    <span style={caption}>{t(`kind.${candidate.kind}`)}</span>
                    {candidate.duplicateOf !== null && <span style={{ ...caption, ...mono }}>{t('import.duplicate', { id: candidate.duplicateOf })}</span>}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{candidate.text}</div>
                </label>
              ))}
              <div style={row}>
                <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={applying || current.ticked.size === 0} onClick={() => { void apply() }} data-deepseekgui="memory-import-apply">
                  {applying ? t('import.applying') : t('import.apply', { count: current.ticked.size })}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
