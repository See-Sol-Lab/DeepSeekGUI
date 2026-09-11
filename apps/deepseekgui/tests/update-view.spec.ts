/**
 * update-view 测试（B6-P8 从 main.ts 提取）：update 面板默认形态、更新通道
 * 配置读取、安装包流式摘要、装机时刻的读/补写与进程内缓存。
 * 全部使用合成临时目录，不发起任何网络请求。
 * @module @see-sol-lab/deepseekgui/tests/update-view
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_UPDATE_FEED_URL } from '../src/update-service.ts'
import {
  digestInstaller,
  readUpdateFeed,
  updateViewOf,
  INSTALL_STATE_FILENAME,
  UPDATE_FEED_FILENAME,
} from '../src/update-view.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时 userData 目录。 */
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-update-view-'))
  roots.push(dir)
  return dir
}

describe('updateViewOf', () => {
  it('默认形态：idle、无通道、自动下载开、八个字段全部归位', () => {
    expect(updateViewOf()).toEqual({
      channel: null,
      state: 'idle',
      result: null,
      latestVersion: null,
      releaseNotes: null,
      progressBytes: null,
      progressTotal: null,
      message: null,
      autoDownload: true,
    })
  })

  it('只覆盖传入字段，其余保持默认（不把上一态残留带进新状态）', () => {
    const view = updateViewOf({ state: 'downloading', progressBytes: 42, progressTotal: 100 })
    expect(view).toMatchObject({
      state: 'downloading', progressBytes: 42, progressTotal: 100,
      channel: null, result: null, latestVersion: null, message: null, autoDownload: true,
    })
  })
})

describe('readUpdateFeed', () => {
  it('没有配置文件时用内置公开通道', () => {
    expect(readUpdateFeed(temp())).toBe(DEFAULT_UPDATE_FEED_URL)
  })

  it('合法 https 配置覆盖内置通道', () => {
    const dir = temp()
    writeFileSync(join(dir, UPDATE_FEED_FILENAME), '{"feedUrl":"https://example.test/feed.json"}\n', 'utf8')
    expect(readUpdateFeed(dir)).toBe('https://example.test/feed.json')
  })

  it.each([
    ['损坏 JSON', '{ oops'],
    ['非 https', '{"feedUrl":"http://example.test/feed.json"}'],
    ['带凭据', '{"feedUrl":"https://user:pass@example.test/feed.json"}'],
    ['缺字段', '{}'],
  ])('配置存在却非法时明确 unconfigured（%s），绝不回落默认', (_label, text) => {
    const dir = temp()
    writeFileSync(join(dir, UPDATE_FEED_FILENAME), text, 'utf8')
    expect(readUpdateFeed(dir)).toBeNull()
  })
})

describe('digestInstaller', () => {
  it('按字节流算出 SHA-256', async () => {
    const file = join(temp(), 'DeepSeekGUI-Setup-1.1.0.exe')
    const content = Buffer.from('synthetic installer bytes', 'utf8')
    writeFileSync(file, content)
    expect(await digestInstaller(file)).toBe(createHash('sha256').update(content).digest('hex'))
  })

  it('文件不存在回 null（调用方按"与记录不符"处理，绝不放行）', async () => {
    expect(await digestInstaller(join(temp(), 'missing.exe'))).toBeNull()
  })
})

describe('readInstallStampText', () => {
  it('首次读取写入装机记录并返回可读文本；同一运行内重复读取走缓存', async () => {
    vi.resetModules()
    const mod = await import('../src/update-view.ts')
    const dir = temp()
    const first = mod.readInstallStampText(dir, '1.1.0')
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
    const stamp = JSON.parse(readFileSync(join(dir, INSTALL_STATE_FILENAME), 'utf8')) as { version: string; since: string }
    expect(stamp.version).toBe('1.1.0')
    expect(Number.isFinite(Date.parse(stamp.since))).toBe(true)
    expect(mod.readInstallStampText(dir, '1.1.0')).toBe(first)
  })

  it('版本变化时重写记录（把"上次更新"刷新到这一版）', async () => {
    vi.resetModules()
    const mod = await import('../src/update-view.ts')
    const dir = temp()
    mod.readInstallStampText(dir, '1.1.0')
    vi.resetModules()
    const next = await import('../src/update-view.ts')
    next.readInstallStampText(dir, '1.2.0')
    const stamp = JSON.parse(readFileSync(join(dir, INSTALL_STATE_FILENAME), 'utf8')) as { version: string }
    expect(stamp.version).toBe('1.2.0')
  })

  it('记录损坏时按"这一版刚到"重写，仍能显示文本', async () => {
    vi.resetModules()
    const mod = await import('../src/update-view.ts')
    const dir = temp()
    writeFileSync(join(dir, INSTALL_STATE_FILENAME), '{ broken', 'utf8')
    expect(mod.readInstallStampText(dir, '1.1.0')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u)
    expect(JSON.parse(readFileSync(join(dir, INSTALL_STATE_FILENAME), 'utf8'))).toMatchObject({ version: '1.1.0' })
  })
})
