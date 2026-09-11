/**
 * 官方 Harness settings 文档（`settings.yaml`）里标量偏好的读取（B6-P8 从
 * main.ts 提取）。
 *
 * DeepSeekGUI 不持有第二份主题或语言偏好：官方 settings provider 拥有它们、
 * 外部编辑会热发布，壳只读同一份事实。这里因此只有读路径，没有任何写路径。
 *
 * 主题与语言共用一条块式正则：同一份文档、同一个「命名空间 → 缩进字段」
 * 形状，两份拷贝会让其中一条路径悄悄错过另一条的修正。任何读不到或形状
 * 不符的情况一律回落到可用的默认值，绝不抛错、绝不挡启动。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/harness-settings
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThemePreference } from './ui-state.ts'


/**
 * 读取官方 settings 文档正文。文件不存在或读不到返回 null——降级永远
 * 是可读的界面，不是异常。
 * @param dshHome - 生效的 DSH_HOME 绝对路径。
 * @returns 文档正文，或 null。
 */
export function readHarnessSettingsText(dshHome: string): string | null {
  try {
    return readFileSync(join(dshHome, 'settings.yaml'), 'utf8')
  } catch {
    return null
  }
}

/**
 * 从官方 settings 文档正文里取一个块式命名空间下的标量字段。
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
 * 解析主题偏好。任何读不到/形状不符的情况一律退回 `system`，由 nativeTheme
 * 解算。
 * @param text - settings.yaml 正文。
 * @returns 官方主题偏好。
 */
export function parseHarnessThemePreference(text: string | null): ThemePreference {
  // 官方 settings 文档里主题偏好的位置：`ui-theme.preference`。
  const value = harnessSettingsField(text, 'ui-theme', 'preference')
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/**
 * 解析语言偏好。形状不符/读不到一律回 null（跟随系统），降级永远是可用的
 * 界面。
 * @param text - settings.yaml 正文。
 * @returns 'zh' | 'en'，或 null 表示未存偏好。
 */
export function parseHarnessLocalePreference(text: string | null): 'zh' | 'en' | null {
  // 官方 settings 文档里语言偏好的位置：`locale.preference`。
  const value = harnessSettingsField(text, 'locale', 'preference')?.toLowerCase()
  if (value === undefined) return null
  if (value.startsWith('zh')) return 'zh'
  if (value.startsWith('en')) return 'en'
  return null
}
