/**
 * "Memory used in this session" (B7-P9): a collapsed block that names the
 * entries, versions and scopes of the newest recalled-memory list the model
 * was shown, read from the session log's own record (the injected message's
 * `source`), with each entry's current content beside it when it still
 * exists — so the person sees exactly what shaped the request, and whether
 * it has changed since.
 */
import { useEffect, useRef, useState } from 'react'
import type { MemoryEntry } from '@deepseek-ai/dsh-workbench-memory/types'
import type { Translate } from './MemoryEntries.tsx'
import { oneLine, unwrap, type MemoryRemote, type UsedMemory as UsedMemoryRecord } from './model.ts'
import { badge, caption, card, column, mono, row } from './styles.ts'

/** Props of the block. */
export interface UsedMemoryProps {
  memory: MemoryRemote
  used: UsedMemoryRecord | undefined
  /** Subscribe to store changes forwarded from the Host. */
  onChange: (listener: () => void) => () => void
  t: Translate
}

export function UsedMemory({ memory, used, onChange, t }: UsedMemoryProps) {
  const [open, setOpen] = useState(false)
  const [live, setLive] = useState<{ seq: number; entries: Record<string, MemoryEntry | null> }>()
  const generation = useRef(0)
  const seq = used?.seq
  const ids = used === undefined ? '' : used.entries.map(entry => entry.id).join(',')
  // The record object is rebuilt by every Chat snapshot; its identity is its seq and ids.
  const usedRef = useRef(used)
  usedRef.current = used

  useEffect(() => {
    if (!open || seq === undefined) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const record = usedRef.current
      if (record === undefined) return
      const mine = generation.current += 1
      const forSeq = record.seq
      const entries: Record<string, MemoryEntry | null> = {}
      for (const shown of record.entries) {
        try {
          entries[shown.id] = unwrap(await memory.get(shown.id, new AbortController().signal))
        } catch {
          entries[shown.id] = null
        }
        if (cancelled || mine !== generation.current) return
      }
      setLive({ seq: forSeq, entries })
    }
    void load()
    const unsubscribe = onChange(() => { void load() })
    return () => { cancelled = true; unsubscribe() }
  }, [open, seq, ids, memory, onChange])

  return (
    <details onToggle={(event) => { setOpen((event.target as HTMLDetailsElement).open) }} data-deepseekgui="memory-used">
      <summary style={{ cursor: 'pointer', ...caption }}>
        {t('used.title')}
        {used !== undefined && ` · ${t('used.summary', { count: used.entries.length, omitted: used.omitted > 0 ? t('used.omitted', { omitted: used.omitted }) : '' })}`}
      </summary>
      <div style={{ ...column, marginTop: 6 }}>
        {used === undefined && <div style={caption}>{t('used.none')}</div>}
        {used !== undefined && (
          <>
            <div style={caption}>{t('used.query', { query: oneLine(used.query, 200) })}{used.update && ` ${t('used.replaced')}`}</div>
            {used.entries.map((shown) => {
              const current = live?.seq === used.seq ? live.entries[shown.id] : undefined
              return (
                <div key={shown.id} style={card} data-deepseekgui="memory-used-entry" data-entry-id={shown.id}>
                  <div style={row}>
                    <span style={badge}>{t(`kind.${shown.kind}`)}</span>
                    <span style={badge}>{t(`scope.${shown.scope}`)}</span>
                    <span style={{ ...caption, ...mono }}>#{shown.id} {t('entry.version', { version: shown.version })}</span>
                    {current !== undefined && current !== null && current.version !== shown.version && (
                      <span style={caption}>{t('used.changed', { version: current.version })}</span>
                    )}
                  </div>
                  {current !== undefined && (current === null
                    ? <div style={caption}>{t('used.gone')}</div>
                    : <div>{oneLine(current.content)}</div>)}
                </div>
              )
            })}
          </>
        )}
      </div>
    </details>
  )
}
