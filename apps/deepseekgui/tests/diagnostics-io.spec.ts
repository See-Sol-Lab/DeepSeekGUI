/**
 * 诊断包的两个 IO 函数：收集日志家族、把 bundle 落盘。
 *
 * 这两段此前在 main.ts 里各存在两份——headless 导出一份、GUI 导出一份，
 * 逐字相同。合并之后要保证的仍是原来那两条性质：单个日志读不动不能中断
 * 整个导出（诊断包的价值在于尽量多，不在于全），以及目录名在 Windows 上
 * 必须是合法的（时间戳里的冒号不行）。
 * @module @see-sol-lab/deepseekgui/tests/diagnostics-io
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectLogFamily, writeDiagnosticsBundle } from '../src/diagnostics-service.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 造一个带轮转历史的日志目录。 */
function logHome(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseekgui-logs-'))
  dirs.push(root)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return root
}

describe('collectLogFamily', () => {
  it('没有日志路径时返回空数组，而不是失败', () => {
    expect(collectLogFamily(undefined, text => text)).toEqual([])
  })

  it('收集 current 与轮转历史，逐份过脱敏', () => {
    const root = logHome({
      'dsh-service.log': 'current with sk-abcdefghijklmnopqrstuvwx',
      'dsh-service.log.1': 'older',
    })
    const entries = collectLogFamily(join(root, 'dsh-service.log'), text => text.replace(/sk-[a-z]+/gu, '<redacted>'))
    expect(entries.length).toBeGreaterThanOrEqual(2)
    const current = entries.find(entry => entry.name === 'dsh-service.log')
    expect(current?.content).toBe('current with <redacted>')
    expect(current?.source).toBe(join(root, 'dsh-service.log'))
    expect(entries.some(entry => entry.name === 'dsh-service.log.1')).toBe(true)
  })

  it('每读完一份就回调一次——headless 导出靠它检查总超时', () => {
    const root = logHome({ 'dsh-service.log': 'a', 'dsh-service.log.1': 'b' })
    const onEach = vi.fn()
    const entries = collectLogFamily(join(root, 'dsh-service.log'), text => text, onEach)
    expect(onEach).toHaveBeenCalledTimes(entries.length)
  })

  it('日志根本不存在时安静返回空，不抛', () => {
    const root = logHome({})
    expect(collectLogFamily(join(root, 'dsh-service.log'), text => text)).toEqual([])
  })

  it('一份读不动不中断其余——少一份好过一份都拿不到', () => {
    const root = logHome({ 'dsh-service.log': 'readable', 'dsh-service.log.1': 'also readable' })
    // 把 current 换成目录：readFileSync 会抛 EISDIR，而轮转那份仍应收上来。
    rmSync(join(root, 'dsh-service.log'))
    mkdirSync(join(root, 'dsh-service.log'))
    const entries = collectLogFamily(join(root, 'dsh-service.log'), text => text)
    expect(entries.some(entry => entry.name === 'dsh-service.log')).toBe(false)
    expect(entries.some(entry => entry.content === 'also readable')).toBe(true)
  })
})

describe('writeDiagnosticsBundle', () => {
  it('目录名用时间戳，且不含 Windows 不接受的冒号与点', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseekgui-bundle-'))
    dirs.push(root)
    const at = new Date('2026-09-10T07:42:13.456Z')
    const dir = writeDiagnosticsBundle(root, new Map([['manifest.txt', 'hello']]), at)
    expect(dir).toBe(join(root, 'diagnostics', 'diagnostics-2026-09-10T07-42-13-456Z'))
    expect(readFileSync(join(dir, 'manifest.txt'), 'utf8')).toBe('hello')
  })

  it('二进制内容照写——crash dump 不是文本', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseekgui-bundle-'))
    dirs.push(root)
    const dump = Buffer.from([0x4d, 0x44, 0x4d, 0x50, 0x00, 0xff])
    const dir = writeDiagnosticsBundle(root, new Map([['crash.dmp', dump]]), new Date('2026-01-01T00:00:00.000Z'))
    expect(readFileSync(join(dir, 'crash.dmp')).equals(dump)).toBe(true)
  })

  it('父目录不存在时建出来', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'deepseekgui-bundle-')), 'never', 'existed')
    dirs.push(root)
    const dir = writeDiagnosticsBundle(root, new Map([['a.txt', 'x']]), new Date('2026-01-01T00:00:00.000Z'))
    expect(existsSync(dir)).toBe(true)
  })

  it('空 bundle 也建目录——「导出了但什么都没有」本身就是一条证据', () => {
    const root = mkdtempSync(join(tmpdir(), 'deepseekgui-bundle-'))
    dirs.push(root)
    const dir = writeDiagnosticsBundle(root, new Map(), new Date('2026-01-01T00:00:00.000Z'))
    expect(existsSync(dir)).toBe(true)
  })
})
