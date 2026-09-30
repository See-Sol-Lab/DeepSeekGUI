/**
 * Settings → Global memory (B7-P9; 2026-09-29): the `<home>/memory.md` editor.
 * The entry-based enhanced memory, its mode switch, import and export are
 * gone; the file is the global memory again, read at the start of every new
 * window. One id, `deepseekgui-memory`, replaces the JS settings plugin's
 * section of the same id.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ControlBridgeClient } from '../bridge.ts'
import type { NS_MEMORY } from '../locales-memory.ts'
import { LegacyGlobalEditor } from './LegacyGlobalEditor.tsx'
import { column } from './styles.ts'

/** Business props the plugin entry injects. */
export interface MemorySettingsInjected {
  /** Desktop control bridge; null outside the DeepSeekGUI window. */
  bridge: ControlBridgeClient | null
}

/** Locale seat, owner props, and the injected business props. */
export type MemorySettingsSectionProps = PropsLocale<typeof NS_MEMORY> & SettingsSectionOwnerProps & MemorySettingsInjected

export function MemorySettingsSection({ bridge, t }: MemorySettingsSectionProps) {
  return (
    <div style={{ ...column, gap: 14 }} data-deepseekgui="memory-settings">
      <LegacyGlobalEditor bridge={bridge} t={t} />
    </div>
  )
}
