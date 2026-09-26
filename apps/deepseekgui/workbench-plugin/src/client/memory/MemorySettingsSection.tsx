/**
 * Settings → Global memory (B7-P9): the memory mode with its explicit
 * switches, and per mode the global side of the store — the global entries
 * with search, detail, edit, forget, undo, restore and export in entries
 * mode; the legacy `memory.md` editor plus the reviewable import in
 * markdown mode; a plain statement in off mode. One id, `deepseekgui-memory`,
 * replaces the JS settings plugin's section of the same id.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MemoryStatus } from '@deepseek-ai/dsh-workbench-memory/types'
import type { ControlBridgeClient } from '../bridge.ts'
import type { NS_MEMORY } from '../locales-memory.ts'
import { ImportBlock } from './ImportBlock.tsx'
import { LegacyGlobalEditor } from './LegacyGlobalEditor.tsx'
import { MemoryEntries } from './MemoryEntries.tsx'
import { ExportBlock, ModePanel } from './ModePanel.tsx'
import { errorMessage, unwrap, type MemoryRemote } from './model.ts'
import { caption, column, errorText, intro } from './styles.ts'

/** Business props the plugin entry injects. */
export interface MemorySettingsInjected {
  memory: MemoryRemote
  /** Desktop control bridge; null outside the DeepSeekGUI window. */
  bridge: ControlBridgeClient | null
  /** Subscribe to store changes forwarded from the Host. */
  onChange: (listener: () => void) => () => void
  /** Whether a source session is still listed; undefined when unknown. */
  sessionPresent: (sessionId: string) => boolean | undefined
}

/** Locale seat, owner props, and the injected business props. */
export type MemorySettingsSectionProps = PropsLocale<typeof NS_MEMORY> & SettingsSectionOwnerProps & MemorySettingsInjected

const GLOBAL = { kind: 'global' } as const
const GLOBAL_FILE = { kind: 'global' } as const

export function MemorySettingsSection({ memory, bridge, onChange, sessionPresent, t }: MemorySettingsSectionProps) {
  const [status, setStatus] = useState<MemoryStatus>()
  const [error, setError] = useState<string>()
  const generation = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const mine = generation.current += 1
    try {
      const next = unwrap(await memory.status(new AbortController().signal))
      if (mine !== generation.current) return
      setStatus(next)
      setError(undefined)
    } catch (failure) {
      if (mine !== generation.current) return
      setError(errorMessage(failure))
    }
  }, [memory])

  useEffect(() => { void load() }, [load])
  useEffect(() => onChange(() => { void load() }), [onChange, load])

  return (
    <div style={{ ...column, gap: 14 }} data-deepseekgui="memory-settings">
      {error !== undefined && <div role="alert" style={errorText}>{t('common.failed', { message: error })}</div>}
      {status === undefined && error === undefined && <div role="status" style={caption}>{t('common.loading')}</div>}
      {status !== undefined && (
        <>
          <ModePanel memory={memory} status={status} onStatus={setStatus} t={t} />
          {status.injection === 'entries' && (
            <>
              <MemoryEntries memory={memory} scope={GLOBAL} writeScope={GLOBAL} onChange={onChange} sessionPresent={sessionPresent} t={t} title={t('list.title.global')} />
              <ImportBlock memory={memory} source={GLOBAL_FILE} t={t} />
              <ExportBlock memory={memory} scope={GLOBAL} t={t} />
            </>
          )}
          {status.injection === 'markdown' && (
            <>
              <LegacyGlobalEditor bridge={bridge} t={t} />
              <ImportBlock memory={memory} source={GLOBAL_FILE} t={t} />
            </>
          )}
          {status.injection === 'off' && <p style={intro} role="note">{t('mode.offHint')}</p>}
        </>
      )}
    </div>
  )
}
