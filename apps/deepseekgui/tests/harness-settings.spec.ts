/**
 * harness-settings 测试（B6-P8 从 main.ts 提取）：官方 settings.yaml 的
 * 标量字段读取——块式形状、引号、CRLF、缺字段与读不到的降级。
 * 全部使用合成临时目录，不触碰任何真实用户数据。
 * @module @see-sol-lab/deepseekgui/tests/harness-settings
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  harnessSettingsField,
  parseHarnessLocalePreference,
  parseHarnessThemePreference,
  readHarnessSettingsText,
} from '../src/harness-settings.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时 DSH_HOME（含 settings.yaml 正文）。 */
function homeWith(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-harness-settings-'))
  roots.push(dir)
  writeFileSync(join(dir, 'settings.yaml'), text, 'utf8')
  return dir
}

describe('readHarnessSettingsText', () => {
  it('读到 settings.yaml 正文；文件不存在回 null', () => {
    const home = homeWith('ui-theme:\n  preference: dark\n')
    expect(readHarnessSettingsText(home)).toBe('ui-theme:\n  preference: dark\n')
    const empty = mkdtempSync(join(tmpdir(), 'dsgui-harness-settings-'))
    roots.push(empty)
    expect(readHarnessSettingsText(empty)).toBeNull()
  })

  it('路径不存在（而不是文件缺失）也回 null，绝不抛错', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsgui-harness-settings-'))
    roots.push(root)
    expect(readHarnessSettingsText(join(root, 'not-a-dir', 'nested'))).toBeNull()
  })
})

describe('harnessSettingsField', () => {
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

describe('parseHarnessThemePreference', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
    ['system', 'system'],
    ['"dark"', 'dark'],
  ])('解析 %s', (raw, expected) => {
    expect(parseHarnessThemePreference(`ui-theme:\n  preference: ${raw}\n`)).toBe(expected)
  })

  it.each([
    ['未知值', 'ui-theme:\n  preference: neon\n'],
    ['字段缺失', 'ui-theme:\n  other: dark\n'],
    ['正文为 null', null],
  ])('降级 system（%s），绝不抛错', (_label, text) => {
    expect(parseHarnessThemePreference(text)).toBe('system')
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
    expect(parseHarnessLocalePreference(`locale:\n  preference: ${raw}\n`)).toBe(expected)
  })

  it.each([
    ['未存偏好', 'ui-theme:\n  preference: dark\n'],
    ['未知语言', 'locale:\n  preference: fr\n'],
    ['正文为 null', null],
  ])('回 null 跟随系统（%s）', (_label, text) => {
    expect(parseHarnessLocalePreference(text)).toBeNull()
  })
})

describe('同一份文档同时承载主题与语言', () => {
  it('两个偏好从一份正文各解析一次，互不干扰', () => {
    const home = homeWith('ui-theme:\n  preference: dark\nlocale:\n  preference: zh-CN\n')
    const text = readHarnessSettingsText(home)
    expect(parseHarnessThemePreference(text)).toBe('dark')
    expect(parseHarnessLocalePreference(text)).toBe('zh')
  })
})
