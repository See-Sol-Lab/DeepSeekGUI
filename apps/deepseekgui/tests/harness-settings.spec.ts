/**
 * harness-settings 测试（B6-P8 从 main.ts 提取；dsh 0.1.7 起偏好搬进 profile）：
 * profile 设置文档（cordis.patch.yml 条目数组）与旧 settings.yaml 的标量字段
 * 读取——块式形状、引号、CRLF、缺字段、跨条目边界、优先级与读不到的降级。
 * 全部使用合成临时目录，不触碰任何真实用户数据。
 * @module @see-sol-lab/deepseekgui/tests/harness-settings
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  harnessSettingsField,
  parseHarnessLocalePreference,
  parseHarnessThemePreference,
  profileEntryField,
  readHarnessPreferenceTexts,
  readHarnessSettingsText,
} from '../src/harness-settings.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时 DSH_HOME；可选写入旧 settings.yaml 与 profile `web` 的设置文档。 */
function homeWith(files: { legacy?: string; profile?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-harness-settings-'))
  roots.push(dir)
  if (files.legacy !== undefined) writeFileSync(join(dir, 'settings.yaml'), files.legacy, 'utf8')
  if (files.profile !== undefined) {
    mkdirSync(join(dir, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(dir, 'profiles', 'web', 'cordis.patch.yml'), files.profile, 'utf8')
  }
  return dir
}

/** 两份正文的便捷构造：只给 profile 或只给旧 settings。 */
const profileOnly = (profile: string | null) => ({ profile, legacy: null })
const legacyOnly = (legacy: string | null) => ({ profile: null, legacy })

/** 0.1.7 设置表单实际写出的条目形状（实机抓取）。 */
const PROFILE_DOC = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '- id: permission',
  '  name: "@deepseek-ai/dsh-permission-presets"',
  '  config:',
  '    defaultPreset: workspace-write',
  '- id: ui-theme',
  '  name: "@deepseek-ai/dsh-client-ui-theme"',
  '  config:',
  '    preference: dark',
  '    fontSize: 14',
  '- id: locale',
  '  name: "@deepseek-ai/dsh-client-locale"',
  '  config:',
  '    preference: zh-CN',
  '',
].join('\n')

describe('readHarnessSettingsText', () => {
  it('读到 settings.yaml 正文；文件不存在回 null', () => {
    const home = homeWith({ legacy: 'ui-theme:\n  preference: dark\n' })
    expect(readHarnessSettingsText(home)).toBe('ui-theme:\n  preference: dark\n')
    expect(readHarnessSettingsText(homeWith({}))).toBeNull()
  })

  it('路径不存在（而不是文件缺失）也回 null，绝不抛错', () => {
    const root = homeWith({})
    expect(readHarnessSettingsText(join(root, 'not-a-dir', 'nested'))).toBeNull()
  })
})

describe('harnessSettingsField（旧 settings.yaml）', () => {
  it('取块式命名空间下的标量字段，带引号也认', () => {
    const text = 'model: deepseek\nui-theme:\n  preference: "light"\n'
    expect(harnessSettingsField(text, 'ui-theme', 'preference')).toBe('light')
  })

  it('CRLF 与前置字段都不影响定位', () => {
    const text = 'model: deepseek\r\nui-theme:\r\n  preference: dark\r\n'
    expect(harnessSettingsField(text, 'ui-theme', 'preference')).toBe('dark')
  })

  it('命名空间不存在、字段缺失、正文为 null 一律回 null', () => {
    expect(harnessSettingsField('locale:\n  preference: zh\n', 'ui-theme', 'preference')).toBeNull()
    expect(harnessSettingsField('ui-theme:\n  other: dark\n', 'ui-theme', 'preference')).toBeNull()
    expect(harnessSettingsField(null, 'ui-theme', 'preference')).toBeNull()
  })

  it('不跨越命名空间边界取值（下一个顶层键的字段不算）', () => {
    const text = 'ui-theme:\n  other: 1\nlocale:\n  preference: zh\n'
    expect(harnessSettingsField(text, 'ui-theme', 'preference')).toBeNull()
    expect(harnessSettingsField(text, 'locale', 'preference')).toBe('zh')
  })
})

describe('profileEntryField（profile cordis.patch.yml）', () => {
  it('取条目 config 下的标量字段', () => {
    expect(profileEntryField(PROFILE_DOC, 'ui-theme', 'preference')).toBe('dark')
    expect(profileEntryField(PROFILE_DOC, 'locale', 'preference')).toBe('zh-CN')
  })

  it('CRLF、引号、带引号的 id 都认', () => {
    const text = '- id: "ui-theme"\r\n  name: x\r\n  config:\r\n    preference: \'light\'\r\n'
    expect(profileEntryField(text, 'ui-theme', 'preference')).toBe('light')
  })

  it('不跨条目取值：条目自己没有该字段就回 null', () => {
    const text = '- id: ui-theme\n  name: x\n  config:\n    fontSize: 14\n- id: locale\n  config:\n    preference: en\n'
    expect(profileEntryField(text, 'ui-theme', 'preference')).toBeNull()
  })

  it('只认 config 之下：条目顶层同名键不算', () => {
    const text = '- id: ui-theme\n  preference: dark\n  config:\n    fontSize: 14\n'
    expect(profileEntryField(text, 'ui-theme', 'preference')).toBeNull()
  })

  it('条目不存在、只有 disabled、正文为 null 一律回 null', () => {
    expect(profileEntryField('- id: permission\n  config:\n    preference: dark\n', 'ui-theme', 'preference')).toBeNull()
    expect(profileEntryField('- id: ui-theme\n  disabled: true\n', 'ui-theme', 'preference')).toBeNull()
    expect(profileEntryField(null, 'ui-theme', 'preference')).toBeNull()
  })

  it('id 前缀相同的别的条目不算（ui-theme-extra ≠ ui-theme）', () => {
    const text = '- id: ui-theme-extra\n  config:\n    preference: dark\n'
    expect(profileEntryField(text, 'ui-theme', 'preference')).toBeNull()
  })
})

describe('parseHarnessThemePreference', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    ['"dark"', 'dark'],
  ])('解析 %s（profile 与旧 settings 两种来源）', (raw, expected) => {
    expect(parseHarnessThemePreference(profileOnly(`- id: ui-theme\n  config:\n    preference: ${raw}\n`))).toBe(expected)
    expect(parseHarnessThemePreference(legacyOnly(`ui-theme:\n  preference: ${raw}\n`))).toBe(expected)
  })

  it.each([
    ['未知值', profileOnly('- id: ui-theme\n  config:\n    preference: neon\n')],
    ['字段缺失', profileOnly('- id: ui-theme\n  config:\n    fontSize: 14\n')],
    ['两份都读不到', { profile: null, legacy: null }],
  ])('降级 system（%s），绝不抛错', (_label, texts) => {
    expect(parseHarnessThemePreference(texts)).toBe('system')
  })

  it('profile 优先于旧 settings；profile 没存时才用旧 settings（导入前的那一次启动）', () => {
    expect(parseHarnessThemePreference({
      profile: '- id: ui-theme\n  config:\n    preference: light\n',
      legacy: 'ui-theme:\n  preference: dark\n',
    })).toBe('light')
    expect(parseHarnessThemePreference({
      profile: '- id: permission\n  config:\n    defaultPreset: read-only\n',
      legacy: 'ui-theme:\n  preference: dark\n',
    })).toBe('dark')
  })
})

describe('parseHarnessLocalePreference', () => {
  it.each([
    ['zh', 'zh'],
    ['zh-CN', 'zh'],
    ['ZH-hans', 'zh'],
    ['en', 'en'],
    ['en-US', 'en'],
  ])('解析 %s', (raw, expected) => {
    expect(parseHarnessLocalePreference(profileOnly(`- id: locale\n  config:\n    preference: ${raw}\n`))).toBe(expected)
    expect(parseHarnessLocalePreference(legacyOnly(`locale:\n  preference: ${raw}\n`))).toBe(expected)
  })

  it.each([
    ['未存偏好', profileOnly('- id: ui-theme\n  config:\n    preference: dark\n')],
    ['未知语言', profileOnly('- id: locale\n  config:\n    preference: fr\n')],
    ['两份都读不到', { profile: null, legacy: null }],
  ])('回 null 跟随系统（%s）', (_label, texts) => {
    expect(parseHarnessLocalePreference(texts)).toBeNull()
  })
})

describe('一次读取同时承载主题与语言', () => {
  it('从当前 profile 的设置文档读出两个偏好，互不干扰', () => {
    const home = homeWith({ profile: PROFILE_DOC })
    const texts = readHarnessPreferenceTexts(home, 'web')
    expect(parseHarnessThemePreference(texts)).toBe('dark')
    expect(parseHarnessLocalePreference(texts)).toBe('zh')
  })

  it('别的 profile 的设置不算数', () => {
    const home = homeWith({ profile: PROFILE_DOC })
    const texts = readHarnessPreferenceTexts(home, 'other')
    expect(parseHarnessThemePreference(texts)).toBe('system')
    expect(parseHarnessLocalePreference(texts)).toBeNull()
  })

  it('老 Home 导入之前只有 settings.yaml，照样读得到', () => {
    const home = homeWith({ legacy: 'ui-theme:\n  preference: dark\nlocale:\n  preference: en-US\n' })
    const texts = readHarnessPreferenceTexts(home, 'web')
    expect(parseHarnessThemePreference(texts)).toBe('dark')
    expect(parseHarnessLocalePreference(texts)).toBe('en')
  })
})
