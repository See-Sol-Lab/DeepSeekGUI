/**
 * headless 诊断导出的组装。
 *
 * 这段此前住在 main.ts 里、和 app.exit 缠在一起，只有打包态 e2e 能碰它。
 * 要钉的是两条：**绝不上传任何东西**（它只写本地目录），以及读不到的东西
 * 一律如实说 unknown 而不是省略——诊断包的价值在于它说的话可信。
 * @module @see-sol-lab/deepseekgui/tests/diagnostics-export
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { exportHeadlessDiagnostics, type HeadlessExportFacts } from '../src/diagnostics-export.ts'
import { ACTIVE_RUN_FILENAME } from '../src/crash-evidence.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const VERSION = {
  appVersion: '1.1.1',
  embeddedDshVersion: '0.1.2-rc.1',
  sourceCommit: null,
  electronVersion: '43.0.0',
  platform: 'win32' as const,
  arch: 'x64',
}

/** 一个 userData 目录，可选地带一份服务日志与一个 active-run marker。 */
function userData(options: { log?: string; marker?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'deepseekgui-headless-'))
  dirs.push(dir)
  if (options.log !== undefined) writeFileSync(join(dir, 'dsh-service.log'), options.log)
  if (options.marker !== undefined) writeFileSync(join(dir, ACTIVE_RUN_FILENAME), options.marker)
  return dir
}

function facts(userDataDir: string, over: Partial<HeadlessExportFacts> = {}): HeadlessExportFacts {
  return {
    userDataDir,
    home: 'C:\\Users\\someone',
    homeAliases: [],
    version: VERSION,
    homeKind: 'managed',
    profile: 'web',
    at: new Date('2026-09-10T09:30:00.000Z'),
    timeoutMs: 60_000,
    ...over,
  }
}

/** 把导出目录里的所有文本拼起来，方便断言内容去向。 */
function bundleText(dir: string): string {
  return readdirSync(dir).map((name) => {
    try { return readFileSync(join(dir, name), 'utf8') } catch { return '' }
  }).join('\n')
}

describe('exportHeadlessDiagnostics', () => {
  it('只写本地目录，并把路径交回调用方', () => {
    const home = userData({ log: 'boot ok' })
    const dir = exportHeadlessDiagnostics(facts(home))
    expect(dir).toBe(join(home, 'diagnostics', 'diagnostics-2026-09-10T09-30-00-000Z'))
    expect(existsSync(dir)).toBe(true)
    expect(readdirSync(dir).length).toBeGreaterThan(0)
  })

  it('日志进包之前先脱敏', () => {
    const home = userData({ log: 'token sk-abcdefghijklmnopqrstuvwx in the log' })
    const text = bundleText(exportHeadlessDiagnostics(facts(home)))
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwx')
  })

  it('没有日志时照常产出——空日志本身就是一条证据', () => {
    const home = userData()
    const dir = exportHeadlessDiagnostics(facts(home))
    expect(readdirSync(dir).length).toBeGreaterThan(0)
  })

  it('有 active-run marker 时报 unclean，并带上 pid', () => {
    // marker 是严格 schema：四个字段少一个就整条作废（损坏的 marker 只是
    // 失去一条证据，绝不猜测）。
    const home = userData({ marker: JSON.stringify({
      schemaVersion: 1, pid: 4321, startedAt: '2026-09-10T08:00:00.000Z', appVersion: '1.1.0',
    }) })
    const text = bundleText(exportHeadlessDiagnostics(facts(home)))
    expect(text).toContain('unclean')
    expect(text).toContain('4321')
  })

  it('没有 marker 时说 unknown，不猜成 clean', () => {
    // 「上次是否正常退出」查不到就说查不到；猜一个 clean 会让真崩溃看起来正常。
    const text = bundleText(exportHeadlessDiagnostics(facts(userData())))
    expect(text).toContain('unknown')
  })

  it('marker 内容损坏时降级为 unknown，而不是让整个导出失败', () => {
    const home = userData({ marker: 'not json at all' })
    expect(() => exportHeadlessDiagnostics(facts(home))).not.toThrow()
  })

  it('build info 里写明 Harness 没在跑——这份包不是从运行中的实例取的', () => {
    const text = bundleText(exportHeadlessDiagnostics(facts(userData({ log: 'x' }))))
    expect(text).toContain('not running (headless export)')
  })

  it('超时明确失败，不无限期挂着', () => {
    const home = userData({ log: 'x' })
    // 截止时刻从现在起算：0ms 的预算在第一次检查就越界。曾经给 1ms，快机器
    // 上整份导出有时 1ms 内就跑完了，用例随机红。
    expect(() => exportHeadlessDiagnostics(facts(home, { timeoutMs: 0 })))
      .toThrow(/headless/u)
  })

  it('导出目录之外一个字节都不写', () => {
    const home = userData({ log: 'x' })
    const before = readdirSync(home).sort()
    exportHeadlessDiagnostics(facts(home))
    const after = readdirSync(home).sort()
    // 只多出 diagnostics 这一个顶层条目。
    expect(after.filter(name => !before.includes(name))).toEqual(['diagnostics'])
  })

  it('目标目录不存在时建出来', () => {
    const home = userData()
    rmSync(join(home, 'diagnostics'), { recursive: true, force: true })
    mkdirSync(join(home, 'nested'), { recursive: true })
    expect(existsSync(exportHeadlessDiagnostics(facts(home)))).toBe(true)
  })

  it('超时从现在起算，标称时刻落在过去也照常导出', () => {
    // `at` 是这份诊断包标称的时刻，由调用方给，并不保证等于此刻。deadline 曾
    // 经从 `at` 起算，于是任何一个过去的 `at` 都让第一次超时检查立刻抛、导出
    // 永远做不完——本文件其余用例的固定时刻跨过那一天之后就正是这个形态。
    const home = userData({ log: 'x' })
    const dir = exportHeadlessDiagnostics(facts(home, { at: new Date('2020-01-01T00:00:00.000Z') }))
    expect(existsSync(dir)).toBe(true)
    expect(bundleText(dir)).toContain('x')
  })
})
