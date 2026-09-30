/**
 * The project memory editor (住户 2026-09-29): the session's
 * `<folder>.memory.md`, edited in place in the Memory view. The text comes
 * from the inspector's read; the save goes through the desktop's closed
 * `save-project-memory` command with the text the edit started from, so a
 * file the assistant (or another editor) changed meanwhile is refused rather
 * than overwritten. Every new window reads the file once at its start.
 */
import { useEffect, useRef, useState } from 'react'
import type { WorkbenchMemory } from '@deepseek-ai/dsh-workbench-inspector/types'
import type { ControlBridgeClient } from '../bridge.ts'
import { errorMessage, type Translate } from '../locales-memory.ts'
import { BUTTON_CLASS, caption, column, errorText, intro, primaryButton, row, textarea } from './styles.ts'

/** The longest file the editor holds; a longer one is edited outside. */
export const PROJECT_MEMORY_EDIT_MAX = 200_000

/** Props of the editor. */
export interface ProjectMemoryEditorProps {
  /** The session whose folder the file lives in. */
  sessionId: string
  /** The inspector's read of the file (text null = not created yet). */
  memory: WorkbenchMemory
  bridge: ControlBridgeClient
  /** Called after a save, so the view re-reads the file. */
  onSaved: () => void
  t: Translate
}

export function ProjectMemoryEditor({ sessionId, memory, bridge, onSaved, t }: ProjectMemoryEditorProps) {
  const original = memory.text ?? ''
  const [draft, setDraft] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ ok: true } | { ok: false; message: string }>()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const tooLong = original.length > PROJECT_MEMORY_EDIT_MAX
  const value = draft ?? original
  const dirty = draft !== undefined && draft !== original

  const save = async (): Promise<void> => {
    if (draft === undefined) return
    const submitted = draft
    setSaving(true)
    setNotice(undefined)
    try {
      await bridge.run({ type: 'save-project-memory', sessionId, content: submitted, expected: original })
      if (!alive.current) return
      setDraft(undefined)
      setNotice({ ok: true })
      onSaved()
    } catch (error) {
      if (alive.current) setNotice({ ok: false, message: errorMessage(error) })
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  if (tooLong) return <p role="note" style={intro}>{t('project.tooLong', { max: PROJECT_MEMORY_EDIT_MAX.toLocaleString() })}</p>
  return (
    <div style={column} data-deepseekgui="memory-project-editor">
      <textarea
        rows={16}
        style={textarea}
        value={value}
        placeholder={t('project.placeholder')}
        aria-label={t('project.label')}
        onChange={(event) => { setDraft(event.target.value); setNotice(undefined) }}
      />
      <p style={intro}>{t('project.note')}</p>
      <div style={row}>
        <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={!dirty || saving} onClick={() => { void save() }} data-deepseekgui="memory-project-save">
          {saving ? t('project.saving') : t('project.save')}
        </button>
        {notice?.ok === true && <span role="status" style={caption}>{t('project.saved')}</span>}
        {notice?.ok === false && <span role="alert" style={errorText}>{t('project.failed', { message: notice.message })}</span>}
      </div>
    </div>
  )
}
