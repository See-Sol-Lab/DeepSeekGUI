/**
 * 记忆视图里的两块事实（Phase 2，2026-10-05；Sol 审查后返工）：
 * - 这段会话每次加载时带入了哪些记忆（记录里的快照，不是今天的文件）；
 * - 归档整理：首次说明与开关、这段会话的整理结果、手动「整理这段会话」。
 *
 * 判定、调用模型、写文件全在宿主（workbench-inspector 的 archive-memory），这里只读事实、发请求。
 * 整理在后台进行时每两秒重读一次状态，结束就停——只在有在途整理时才读，不常驻轮询。
 */
import { useEffect, useState } from 'react'
import type { ArchiveMemoryRecord, MemoryInjection, MemoryInjectionFile, WorkbenchArchiveMemory } from '@deepseek-ai/dsh-workbench-inspector/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { button, BUTTON_CLASS, caption, sectionTitle, useRead, type InspectorRemote, type Translate } from './shared.tsx'

const box: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l1)',
  background: 'var(--dsw-alias-bg-layer-2)', display: 'flex', flexDirection: 'column', gap: 6,
  fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)',
}
const danger: React.CSSProperties = { ...caption, color: 'var(--dsw-alias-label-danger, #d33)' }

/** 在途整理时重读状态的间隔。 */
const RUNNING_POLL_MS = 2_000

/** 一个文件的带入情况：状态 + 字符数 / 字节数 + 自动整理区。 */
function fileLine(t: Translate, label: string, file: MemoryInjectionFile, capBytes: number): string {
  const line = t('archive.injected.file', {
    label,
    status: t(`archive.injected.status.${file.status}` as const, { cap: String(Math.round(capBytes / 1024)) }),
    chars: file.chars.toLocaleString(),
    bytes: file.bytes.toLocaleString(),
  })
  return file.autoArea === 'included' ? `${line}${t('archive.injected.autoArea')}` : line
}

/** 记录的一句话结论。 */
function recordLine(t: Translate, record: ArchiveMemoryRecord): string {
  const when = record.finishedAt ?? record.startedAt
  return t(`archive.status.${record.status}` as const, {
    when: new Date(when).toLocaleString(),
    count: String(record.added?.length ?? 0),
    turns: String(record.input?.wholeUserTurns ?? record.input?.userTurns ?? 0),
    chars: (record.input?.wholeChars ?? record.input?.chars ?? 0).toLocaleString(),
    error: record.error ?? '',
  })
}

export function ArchiveNotes({ inspector, sessionId, t }: { inspector: InspectorRemote; sessionId: SessionId | undefined; t: Translate }) {
  const injection = useRead<MemoryInjection | null>('memory-injection', async (id, signal) => await inspector.memoryInjection(id, signal), sessionId)
  const state = useRead<WorkbenchArchiveMemory>('archive-memory', async (id, signal) => await inspector.archiveMemoryState(id, signal), sessionId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const settings = state.value?.settings
  const record = state.value?.record ?? null
  const running = busy || state.value?.running === true || record?.status === 'running'

  // 后台整理（归档触发的自动整理）进行中：隔一会儿重读一次，结束就不再读。
  const backgroundRunning = !busy && state.value?.running === true
  const { refresh } = state
  useEffect(() => {
    if (!backgroundRunning) return undefined
    const timer = setTimeout(() => { refresh() }, RUNNING_POLL_MS)
    return () => { clearTimeout(timer) }
  }, [backgroundRunning, refresh, state.value])

  const summarize = async (): Promise<void> => {
    if (sessionId === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await inspector.summarizeSession(sessionId, new AbortController().signal)
      if (!result.ok) setError(result.error.message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
      refresh()
    }
  }
  /** 改设置：失败要让人看见，不能吞掉（Sol P2-07）。 */
  const setSettings = async (auto: boolean | null, noticeSeen: boolean | null): Promise<void> => {
    setError(undefined)
    try {
      const result = await inspector.setArchiveMemorySettings(auto, noticeSeen, new AbortController().signal)
      if (!result.ok) setError(t('archive.settingsFailed', { error: result.error.message }))
    } catch (failure) {
      setError(t('archive.settingsFailed', { error: failure instanceof Error ? failure.message : String(failure) }))
    } finally {
      refresh()
    }
  }

  const entries = injection.value?.entries ?? []
  const latest = entries.at(-1)
  return (
    <>
      <div style={sectionTitle}>{t('archive.injected.title')}</div>
      <div style={box} data-deepseekgui="memory-injection">
        {latest === undefined
          ? <span style={caption}>{t('archive.injected.none')}</span>
          : (
            <>
              <span>{fileLine(t, t('archive.injected.global'), latest.global, latest.capBytes)}</span>
              <span>{fileLine(t, t('archive.injected.project'), latest.project, latest.capBytes)}</span>
              <span style={caption}>{t('archive.injected.note', { at: new Date(latest.at).toLocaleString() })}</span>
              {entries.length > 1 && <span style={caption}>{t('archive.injected.history', { count: String(entries.length) })}</span>}
            </>
          )}
      </div>

      <div style={sectionTitle}>{t('archive.title')}</div>
      <div style={box} data-deepseekgui="archive-notes">
        {settings !== undefined && !settings.noticeSeen && (
          <div role="note">
            <div>{t('archive.notice')}</div>
            <button type="button" className={BUTTON_CLASS} style={{ ...button, marginTop: 6 }} onClick={() => { void setSettings(null, true) }}>{t('archive.noticeOk')}</button>
          </div>
        )}
        {settings !== undefined && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={settings.auto} onChange={(event) => { void setSettings(event.target.checked, null) }} />
            <span>{t('archive.auto')}</span>
          </label>
        )}
        {record !== null && <div role="status">{recordLine(t, record)}</div>}
        {record?.added !== undefined && record.added.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18 }}>{record.added.map(line => <li key={line}>{line}</li>)}</ul>
        )}
        {record?.superseded !== undefined && record.superseded.length > 0 && (
          <span style={caption}>{t('archive.superseded', { count: String(record.superseded.length) })}</span>
        )}
        {record?.pending !== undefined && record.pending.length > 0 && (
          <>
            <span style={caption}>{t('archive.pending')}</span>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{record.pending.map(line => <li key={line}>{line}</li>)}</ul>
          </>
        )}
        {record?.coverage !== undefined && !record.coverage.complete && <span style={caption}>{t('archive.partial')}</span>}
        {record?.suggestions !== undefined && record.suggestions.length > 0 && <span style={caption}>{t('archive.suggested', { count: String(record.suggestions.length) })}</span>}
        {record?.suggestionsDropped !== undefined && <span style={caption}>{t('archive.suggestionsDropped', { count: String(record.suggestionsDropped) })}</span>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className={BUTTON_CLASS} style={button} disabled={running || sessionId === undefined} title={t('archive.manualTitle')} onClick={() => { void summarize() }}>
            {running ? t('archive.running') : t('archive.manual')}
          </button>
          {error !== undefined && <span role="alert" style={danger}>{error}</span>}
        </div>
      </div>
    </>
  )
}
