/**
 * The memory mode (B7-P9): which path sessions use — the legacy Markdown
 * files, the entries, or nothing — with the explicit switch between them.
 * Every switch is confirmed in place, says what changes and what stays,
 * and shows as done only when the store answered; the two paths never
 * apply together and nothing falls back on its own. Beside it, the export:
 * the entries as Markdown text for the person to copy — never a write over
 * the legacy file.
 */
import { useRef, useState } from 'react'
import type { MemoryInjectionMode, MemoryScopeFilter, MemoryStatus } from '@deepseek-ai/dsh-workbench-memory/types'
import type { Translate } from './MemoryEntries.tsx'
import { errorMessage, exportMarkdown, unwrap, type MemoryRemote } from './model.ts'
import { button, BUTTON_CLASS, caption, card, column, errorText, heading, intro, primaryButton, row, textarea } from './styles.ts'

/** Props of the mode panel. */
export interface ModePanelProps {
  memory: MemoryRemote
  status: MemoryStatus
  /** The status after a switch the store confirmed. */
  onStatus: (status: MemoryStatus) => void
  t: Translate
}

/**
 * R15（2026-09-14 第二轮人工验收）：面板只有两个可达状态——旧版 Markdown 与
 * 增强条目——一键互切；「关闭」不再有界面入口（第三种途径让人费解）。off
 * 只可能来自历史配置，那时给两条回程。标题即当前模式，不再有「当前：…」
 * 与条数小字。
 */
const SWITCH_TARGETS: Record<MemoryInjectionMode, readonly ('entries' | 'markdown')[]> = {
  markdown: ['entries'],
  entries: ['markdown'],
  off: ['markdown', 'entries'],
}

const SWITCH_LABEL: Record<'entries' | 'markdown', 'mode.switchEntries' | 'mode.switchMarkdown'> = {
  entries: 'mode.switchEntries',
  markdown: 'mode.switchMarkdown',
}

const CONFIRM_TEXT: Record<'entries' | 'markdown', 'mode.confirmEntries' | 'mode.confirmMarkdown'> = {
  entries: 'mode.confirmEntries',
  markdown: 'mode.confirmMarkdown',
}

export function ModePanel({ memory, status, onStatus, t }: ModePanelProps) {
  const [pending, setPending] = useState<'entries' | 'markdown'>()
  const [switching, setSwitching] = useState(false)
  const [notice, setNotice] = useState<{ ok: true } | { ok: false; message: string }>()
  const generation = useRef(0)

  const confirm = async (): Promise<void> => {
    if (pending === undefined) return
    const mine = generation.current += 1
    const target = pending
    setSwitching(true)
    setNotice(undefined)
    try {
      const next = unwrap(await memory.setInjection(target, new AbortController().signal))
      if (mine !== generation.current) return
      onStatus(next)
      setPending(undefined)
      setNotice({ ok: true })
    } catch (error) {
      if (mine !== generation.current) return
      setNotice({ ok: false, message: errorMessage(error) })
    } finally {
      if (mine === generation.current) setSwitching(false)
    }
  }

  return (
    <div style={card} data-deepseekgui="memory-mode" data-mode={status.injection}>
      <div style={row}>
        <span style={heading}>{t(`mode.title.${status.injection}`)}</span>
        {status.injection === 'markdown' && <span style={caption}>{t('mode.upgradeNote')}</span>}
      </div>
      <p style={intro}>{t(`mode.${status.injection}Hint`)}</p>
      <div style={row}>
        {SWITCH_TARGETS[status.injection].map(mode => (
          <button
            key={mode}
            type="button"
            style={mode === 'entries' ? primaryButton : button}
            disabled={switching}
            aria-pressed={pending === mode}
            onClick={() => { setPending(pending === mode ? undefined : mode); setNotice(undefined) }}
            data-deepseekgui={`memory-mode-${mode}`}
          >
            {t(SWITCH_LABEL[mode])}
          </button>
        ))}
        {notice?.ok === true && <span role="status" style={caption}>{t('mode.switched')}</span>}
        {notice?.ok === false && <span role="alert" style={errorText}>{t('mode.switchFailed', { message: notice.message })}</span>}
      </div>
      {pending !== undefined && (
        <div style={{ ...column, gap: 6 }} role="group" aria-label={t(SWITCH_LABEL[pending])} data-deepseekgui="memory-mode-confirm">
          <p style={intro}>{t(CONFIRM_TEXT[pending])}</p>
          <div style={row}>
            <button type="button" className={BUTTON_CLASS} style={primaryButton} disabled={switching} onClick={() => { void confirm() }} data-deepseekgui="memory-mode-confirm-button">
              {switching ? t('mode.switching') : t('mode.confirm')}
            </button>
            <button type="button" className={BUTTON_CLASS} style={button} disabled={switching} onClick={() => { setPending(undefined) }}>{t('mode.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Props of the export block. */
export interface ExportBlockProps {
  memory: MemoryRemote
  scope: MemoryScopeFilter
  t: Translate
}

export function ExportBlock({ memory, scope, t }: ExportBlockProps) {
  const [text, setText] = useState<string>()
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const scopeKey = JSON.stringify(scope)
  const scopeRef = useRef(scopeKey)
  scopeRef.current = scopeKey

  const run = async (): Promise<void> => {
    const forScope = scopeKey
    setError(undefined)
    setCopied(false)
    try {
      const page = unwrap(await memory.list({ scope, limit: 10_000 }, new AbortController().signal))
      if (scopeRef.current !== forScope) return
      if (page.entries.length === 0) {
        setEmpty(true)
        setText(undefined)
        return
      }
      setEmpty(false)
      setText(exportMarkdown(page.entries, {
        title: t('export.title'),
        kind: kind => t(`kind.${kind}`),
        scope: where => t(`scope.${where}`),
      }))
    } catch (failure) {
      if (scopeRef.current === forScope) setError(errorMessage(failure))
    }
  }

  const copy = async (): Promise<void> => {
    if (text === undefined) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  return (
    <div style={column} data-deepseekgui="memory-export">
      <div style={row}>
        <span style={heading}>{t('export.title')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void run() }} data-deepseekgui="memory-export-run">{t('export.run')}</button>
        {text !== undefined && <button type="button" className={BUTTON_CLASS} style={button} onClick={() => { void copy() }}>{t('export.copy')}</button>}
        {copied && <span role="status" style={caption}>{t('export.copied')}</span>}
      </div>
      <p style={intro}>{t('export.intro')}</p>
      {error !== undefined && <div role="alert" style={errorText}>{t('common.failed', { message: error })}</div>}
      {empty && <div style={caption}>{t('export.empty')}</div>}
      {text !== undefined && <textarea readOnly rows={10} style={textarea} value={text} aria-label={t('export.title')} data-deepseekgui="memory-export-text" />}
    </div>
  )
}
