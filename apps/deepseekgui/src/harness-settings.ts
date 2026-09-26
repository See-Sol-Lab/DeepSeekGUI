/**
 * 官方 Harness 里主题与语言偏好的读取（B6-P8 从 main.ts 提取）。
 *
 * DeepSeekGUI 不持有第二份主题或语言偏好：官方拥有它们、外部编辑会热发布，
 * 壳只读同一份事实。这里因此只有读路径，没有任何写路径。
 *
 * 事实在哪（dsh 0.1.7 起换了位置）：设置表单写进当前 profile 的
 * `profiles/<profile>/cordis.patch.yml`——`ui-theme` 与 `locale` 两个条目的
 * `config.preference`。旧的 `$DSH_HOME/settings.yaml` 在 Harness 启动时被一次性
 * 导入该 profile 并改名为 `settings.yaml.imported`；导入发生之前（老 Home 升级
 * 后的第一次启动、Harness 还没起来）它仍是唯一的来源，所以 profile 读不到时
 * 退回它。
 *
 * 两种文档都用正则读，不引入 YAML 解析：profile 文档里有 `!!js` 表达式，普通
 * 解析器会整份拒绝；壳也一直保持零运行时依赖。任何读不到或形状不符的情况
 * 一律回落到可用的默认值，绝不抛错、绝不挡启动。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/harness-settings
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemePreference } from './ui-state.ts'

/** profile 设置文档的文件名（监听器按它过滤目录事件）。 */
export const PROFILE_PATCH_FILE = 'cordis.patch.yml'
/** 0.1.7 之前的全局设置文档（导入后改名，不再更新）。 */
export const LEGACY_SETTINGS_FILE = 'settings.yaml'

/** 读一个文本文件；不存在或读不到回 null。 */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * 读取旧的全局 settings 文档正文。文件不存在或读不到返回 null——降级永远
 * 是可读的界面，不是异常。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 * @returns 文档正文，或 null。
 */
export function readHarnessSettingsText(dshHome: string): string | null {
  return readText(join(dshHome, LEGACY_SETTINGS_FILE))
}

/**
 * profile 设置文档所在目录。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 * @param profile - 当前 profile 名。
 * @returns `profiles/<profile>` 的绝对路径。
 */
export function profileDir(dshHome: string, profile: string): string {
  return join(dshHome, 'profiles', profile)
}

/**
 * 读取当前 profile 的设置文档正文；读不到回 null。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 * @param profile - 当前 profile 名。
 * @returns 文档正文，或 null。
 */
export function readProfilePatchText(dshHome: string, profile: string): string | null {
  return readText(join(profileDir(dshHome, profile), PROFILE_PATCH_FILE))
}

/**
 * 从旧 settings 文档正文里取一个块式命名空间下的标量字段。
 * @param text - settings.yaml 正文（null = 读不到）。
 * @param namespace - 命名空间名（如 `ui-theme`）。
 * @param field - 字段名（如 `preference`）。
 * @returns 字段原文，或 null。
 */
export function harnessSettingsField(text: string | null, namespace: string, field: string): string | null {
  if (text === null) return null
  const section = new RegExp(
    `^${namespace}:[ \t]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+${field}:[ \t]*["']?([A-Za-z-]+)["']?`,
    'm',
  )
  return section.exec(text)?.[1] ?? null
}

/**
 * 从 profile 设置文档（顶层是条目数组）里取某个条目 `config` 下的标量字段。
 * 条目从 `- id: <entry>` 那行起、到下一个顶层 `- ` 为止；字段必须在该条目的
 * `config:` 之下，不跨条目取值。
 * @param text - cordis.patch.yml 正文（null = 读不到）。
 * @param entryId - 条目 id（如 `ui-theme`）。
 * @param field - config 下的字段名（如 `preference`）。
 * @returns 字段原文，或 null。
 */
export function profileEntryField(text: string | null, entryId: string, field: string): string | null {
  if (text === null) return null
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => new RegExp(`^-[ \t]+id:[ \t]*["']?${entryId}["']?[ \t]*$`).test(line))
  if (start === -1) return null
  let inConfig = false
  let configIndent = 0
  for (const line of lines.slice(start + 1)) {
    if (/^-[ \t]/.test(line) || /^\S/.test(line)) break
    const indent = /^[ \t]*/.exec(line)?.[0].length ?? 0
    if (/^[ \t]+config:[ \t]*$/.test(line)) {
      inConfig = true
      configIndent = indent
      continue
    }
    if (!inConfig || line.trim() === '') continue
    if (indent <= configIndent) {
      inConfig = false
      continue
    }
    const match = new RegExp(`^[ \t]+${field}:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*$`).exec(line)
    if (match !== null) return match[1] ?? null
  }
  return null
}

/** 两份文档的正文：profile（当前）与旧全局 settings（导入前的回退）。 */
export interface HarnessPreferenceTexts {
  profile: string | null
  legacy: string | null
}

/**
 * 一次读齐两份文档，主题与语言从同一次读取里解析，避免两个偏好来自文件的
 * 两个版本。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 * @param profile - 当前 profile 名。
 * @returns 两份正文。
 */
export function readHarnessPreferenceTexts(dshHome: string, profile: string): HarnessPreferenceTexts {
  return { profile: readProfilePatchText(dshHome, profile), legacy: readHarnessSettingsText(dshHome) }
}

/** profile 里的值优先，没有才看旧 settings。 */
function preferenceField(texts: HarnessPreferenceTexts, entryId: string): string | null {
  return profileEntryField(texts.profile, entryId, 'preference')
    ?? harnessSettingsField(texts.legacy, entryId, 'preference')
}

/**
 * 解析主题偏好。任何读不到/形状不符的情况一律退回 `system`，由 nativeTheme
 * 解算。
 * @param texts - 两份文档正文。
 * @returns 官方主题偏好。
 */
export function parseHarnessThemePreference(texts: HarnessPreferenceTexts): ThemePreference {
  const value = preferenceField(texts, 'ui-theme')
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/**
 * 解析语言偏好。形状不符/读不到一律回 null（跟随系统），降级永远是可用的
 * 界面。
 * @param texts - 两份文档正文。
 * @returns 'zh' | 'en'，或 null 表示未存偏好。
 */
export function parseHarnessLocalePreference(texts: HarnessPreferenceTexts): 'zh' | 'en' | null {
  const value = preferenceField(texts, 'locale')?.toLowerCase()
  if (value === undefined) return null
  if (value.startsWith('zh')) return 'zh'
  if (value.startsWith('en')) return 'en'
  return null
}
