/**
 * 整体搬家的纯逻辑（Phase 1）：布局、目标判定、安装器参数、清单地址、搬家记录与启动时的结论。
 * 文件系统事实用替身注入；记录读写用真实临时目录。
 * @module @see-sol-lab/deepseekgui/tests/relocation
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkRelocationTarget,
  checkRetryTarget,
  clearRelocationRecord,
  launchRelocationHelper,
  layoutHomeOf,
  MAX_INSTALL_DIR_LENGTH,
  readHelperState,
  readRelocationRecord,
  relocationLayout,
  relocationManifestCandidates,
  relocationOutcome,
  writeRelocationRecord,
  RELOCATION_DIR_NAME,
  RELOCATION_HELPER_SCRIPT,
  RELOCATION_HELPER_STATE_NAME,
  RELOCATION_RECORD_FILENAME,
  type RelocationCheckInput,
  type RelocationFacts,
  type RelocationRecord,
} from '../src/relocation.ts'

const win = process.platform === 'win32'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** 一个临时根：判定只看结构，所有路径都在它下面，保持短。 */
function base(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsg-rel-'))
  dirs.push(dir)
  return dir
}

/** 文件系统替身：默认什么都不存在、可写、空间充足。 */
function facts(over: Partial<RelocationFacts> & { existing?: readonly string[] } = {}): RelocationFacts {
  const existing = new Set((over.existing ?? []).map(path => (win ? path.toLowerCase() : path)))
  const has = (path: string): boolean => existing.has(win ? path.toLowerCase() : path)
  return {
    exists: over.exists ?? has,
    names: over.names ?? (() => []),
    isLink: over.isLink ?? (() => false),
    isWritable: over.isWritable ?? (() => true),
    freeBytes: over.freeBytes ?? (() => Number.MAX_SAFE_INTEGER),
  }
}

function input(root: string, over: Partial<RelocationCheckInput> = {}): RelocationCheckInput {
  return {
    parent: join(root, 'target'),
    currentAppDir: join(root, 'old', 'Programs', 'DeepSeekGUI'),
    currentHome: join(root, 'roaming', 'DeepSeekGUI', 'dsh'),
    homeIsManaged: true,
    requiredBytes: 1000,
    protectedRoots: [],
    win,
    facts: facts(),
    ...over,
  }
}

describe('relocationLayout / layoutHomeOf', () => {
  it('父目录之下固定 DeepSeekGUI/app 与 DeepSeekGUI/dsh', () => {
    const root = base()
    const layout = relocationLayout(join(root, 'D'))
    expect(layout.root).toBe(join(root, 'D', 'DeepSeekGUI'))
    expect(layout.appDir).toBe(join(root, 'D', 'DeepSeekGUI', 'app'))
    expect(layout.home).toBe(join(root, 'D', 'DeepSeekGUI', 'dsh'))
  })

  it('exe 在 DeepSeekGUI/app 里才算搬家布局；默认安装位置不命中', () => {
    const root = base()
    expect(layoutHomeOf(join(root, 'DeepSeekGUI', 'app', 'DeepSeekGUI.exe'))).toBe(join(root, 'DeepSeekGUI', 'dsh'))
    expect(layoutHomeOf(join(root, 'Programs', 'DeepSeekGUI', 'DeepSeekGUI.exe'))).toBeNull()
    expect(layoutHomeOf(join(root, 'Other', 'app', 'DeepSeekGUI.exe'))).toBeNull()
  })
})

describe('checkRelocationTarget', () => {
  it('结构没问题时给出布局', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root))
    expect(verdict).toEqual({ ok: true, layout: relocationLayout(join(root, 'target')) })
  })

  it('安装目录超过上限：拒绝（静默安装被拦时用户看不见）', () => {
    const root = base()
    const deep = join(root, 'x'.repeat(MAX_INSTALL_DIR_LENGTH))
    const verdict = checkRelocationTarget(input(root, { parent: deep }))
    expect(verdict).toMatchObject({ ok: false, reason: 'too-long' })
  })

  it('目标就是当前程序目录：拒绝', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root, { currentAppDir: join(root, 'target', 'DeepSeekGUI', 'app') }))
    expect(verdict).toMatchObject({ ok: false, reason: 'same-as-current' })
  })

  it('目标在当前程序目录里面：拒绝（旧卸载器会把它一起删掉）', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root, { currentAppDir: root, parent: join(root, 'sub') }))
    expect(verdict).toMatchObject({ ok: false, reason: 'inside-current-app' })
  })

  it('目标包含当前程序目录：拒绝', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root, { currentAppDir: join(root, 'target', 'DeepSeekGUI', 'old-app') }))
    expect(verdict).toMatchObject({ ok: false, reason: 'current-app-inside-target' })
  })

  it('Managed Home 互相嵌套：两个方向都拒绝；Existing Home 不参与', () => {
    const root = base()
    expect(checkRelocationTarget(input(root, { currentHome: root, parent: join(root, 'h') }))).toMatchObject({ ok: false, reason: 'inside-current-home' })
    expect(checkRelocationTarget(input(root, { currentHome: join(root, 'target', 'DeepSeekGUI', 'dsh-old') }))).toMatchObject({ ok: false, reason: 'current-home-inside-target' })
    expect(checkRelocationTarget(input(root, { currentHome: root, parent: join(root, 'h'), homeIsManaged: false }))).toMatchObject({ ok: true })
  })

  it('系统目录：拒绝', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root, { protectedRoots: [join(root, 'target')] }))
    expect(verdict).toMatchObject({ ok: false, reason: 'protected-location', detail: join(root, 'target') })
  })

  it('在某个 Git 项目里面：拒绝', () => {
    const root = base()
    const verdict = checkRelocationTarget(input(root, { facts: facts({ existing: [join(root, '.git')] }) }))
    expect(verdict).toMatchObject({ ok: false, reason: 'inside-project', detail: root })
  })

  it('根目录已存在：是链接、或不为空都拒绝；空的可以用', () => {
    const root = base()
    const target = join(root, 'target', 'DeepSeekGUI')
    expect(checkRelocationTarget(input(root, { facts: facts({ existing: [target], isLink: () => true }) }))).toMatchObject({ ok: false, reason: 'root-is-link' })
    expect(checkRelocationTarget(input(root, { facts: facts({ existing: [target], names: () => ['stuff'] }) }))).toMatchObject({ ok: false, reason: 'root-not-empty' })
    expect(checkRelocationTarget(input(root, { facts: facts({ existing: [target] }) }))).toMatchObject({ ok: true })
  })

  it('不可写、空间不够：拒绝', () => {
    const root = base()
    expect(checkRelocationTarget(input(root, { facts: facts({ isWritable: () => false }) }))).toMatchObject({ ok: false, reason: 'not-writable' })
    expect(checkRelocationTarget(input(root, { facts: facts({ freeBytes: () => 10 }) }))).toMatchObject({ ok: false, reason: 'not-enough-space' })
  })

  it('中文与空格路径照常通过', () => {
    const root = base()
    expect(checkRelocationTarget(input(root, { parent: join(root, '我的 程序') }))).toMatchObject({ ok: true })
  })
})

describe('checkRetryTarget', () => {
  const target = (root: string) => ({ root: join(root, 'DeepSeekGUI'), appDir: join(root, 'DeepSeekGUI', 'app') })
  it('自己的半成品（app、dsh）可以继续；陌生内容、链接、系统位置、不可写都拒绝', () => {
    const root = base()
    const { root: r, appDir } = target(root)
    const own = facts({ existing: [r], names: () => ['app', 'dsh'] })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [], win, facts: own })).toEqual({ ok: true })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [], win, facts: facts({ existing: [r], names: () => ['app', 'notes.txt'] }) }))
      .toMatchObject({ ok: false, reason: 'root-not-empty' })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [], win, facts: facts({ existing: [r], isLink: () => true }) }))
      .toMatchObject({ ok: false, reason: 'root-is-link' })
    const linked = facts({ existing: [r, appDir], isLink: path => path === appDir })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [], win, facts: linked }))
      .toMatchObject({ ok: false, reason: 'root-is-link', detail: appDir })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [root], win, facts: own })).toMatchObject({ ok: false, reason: 'protected-location' })
    expect(checkRetryTarget({ root: r, appDir, protectedRoots: [], win, facts: facts({ existing: [r], names: () => ['dsh'], isWritable: () => false }) }))
      .toMatchObject({ ok: false, reason: 'not-writable' })
  })
})

describe('交接助手脚本', () => {
  it('只用 ASCII（中文走配置文件）', () => {
    expect(/^[\x00-\x7F]*$/u.test(RELOCATION_HELPER_SCRIPT)).toBe(true)
  })
  it('先等主进程与旧程序目录里的进程全部退出，再核摘要，最后才运行安装器', () => {
    const order = ['Get-Process -Id $cfg.parentPid', 'StartsWith($prefix)', 'Get-FileHash', 'Invoke-Installer $cfg.toAppDir']
      .map(marker => RELOCATION_HELPER_SCRIPT.indexOf(marker))
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('静默、/D 是最后一个参数；不让安装器自己拉起（由助手确认装成后再开）；装不成先开旧的、再装回原位置', () => {
    expect(RELOCATION_HELPER_SCRIPT).toContain("@('/S', ('/D=' + $Dir))")
    expect(RELOCATION_HELPER_SCRIPT).not.toContain('--force-run')
    expect(RELOCATION_HELPER_SCRIPT.indexOf("Start-App $cfg.fromAppDir) { Set-State 'install-failed-old-kept'"))
      .toBeLessThan(RELOCATION_HELPER_SCRIPT.indexOf('Invoke-Installer $cfg.fromAppDir'))
  })
  it('状态只认已知阶段', () => {
    const root = base()
    mkdirSync(join(root, RELOCATION_DIR_NAME))
    const path = join(root, RELOCATION_DIR_NAME, RELOCATION_HELPER_STATE_NAME)
    writeFileSync(path, '\uFEFF{"phase":"restored","detail":"install exit 2"}')
    expect(readHelperState(root)).toEqual({ phase: 'restored', detail: 'install exit 2' })
    writeFileSync(path, '{"phase":"made-up"}')
    expect(readHelperState(root)).toBeNull()
  })
})

describe('relocationManifestCandidates', () => {
  it('先找这个版本自己的发布附件，再找通道；去重、跳过空值', () => {
    const own = 'https://github.com/See-Sol-Lab/DeepSeekGUI/releases/download/v1.2.1/update-manifest.json'
    expect(relocationManifestCandidates('1.2.1', [null, 'https://example.test/feed.json', own, '']))
      .toEqual([own, 'https://example.test/feed.json'])
  })
})

describe('搬家记录', () => {
  const record = (root: string): RelocationRecord => ({
    schemaVersion: 1,
    startedAt: '2026-10-05T00:00:00.000Z',
    fromAppDir: join(root, 'old'),
    toAppDir: join(root, 'new', 'DeepSeekGUI', 'app'),
    root: join(root, 'new', 'DeepSeekGUI'),
    version: '1.2.1',
    dataMoved: true,
    fromHome: join(root, 'home'),
    installerPath: join(root, 'relocation', 'DeepSeekGUI-Setup-1.2.1.exe'),
    installerSha256: 'a'.repeat(64),
  })

  it('写、读、清', () => {
    const root = base()
    expect(readRelocationRecord(root)).toEqual({ record: null, error: null })
    writeRelocationRecord(root, record(root))
    expect(readRelocationRecord(root)).toEqual({ record: record(root), error: null })
    clearRelocationRecord(root)
    expect(readRelocationRecord(root)).toEqual({ record: null, error: null })
  })

  it('坏记录 fail closed：给出错误，不当成没有', () => {
    const root = base()
    writeFileSync(join(root, RELOCATION_RECORD_FILENAME), '{"schemaVersion":1}')
    expect(readRelocationRecord(root).record).toBeNull()
    expect(readRelocationRecord(root).error).not.toBeNull()
    writeFileSync(join(root, RELOCATION_RECORD_FILENAME), 'not json')
    expect(readRelocationRecord(root).error).not.toBeNull()
  })

  it('启动时只看 exe 在哪：新目录 = moved，旧目录 = not-moved，别处 = elsewhere', () => {
    const root = base()
    const r = record(root)
    expect(relocationOutcome(r, join(r.toAppDir, 'DeepSeekGUI.exe'), win)).toBe('moved')
    expect(relocationOutcome(r, join(r.fromAppDir, 'DeepSeekGUI.exe'), win)).toBe('not-moved')
    expect(relocationOutcome(r, join(root, 'third', 'DeepSeekGUI.exe'), win)).toBe('elsewhere')
    if (win) expect(relocationOutcome(r, join(r.toAppDir.toUpperCase(), 'DeepSeekGUI.exe'), win)).toBe('moved')
  })
})

// 真起进程：经 WMI 创建，父进程不是本进程；只在 Windows 上跑。
describe.runIf(process.platform === 'win32')('launchRelocationHelper', () => {
  const made: string[] = []
  afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })
  const fixture = (body: string): { script: string; config: string; state: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'dsg-launch-'))
    made.push(dir)
    const script = join(dir, 'helper.ps1')
    writeFileSync(script, body, 'utf8')
    return { script, config: join(dir, 'relocate-helper.json'), state: join(dir, RELOCATION_HELPER_STATE_NAME) }
  }

  it('returns once the helper has written its first state', async () => {
    const f = fixture("param([string]$C)\n$s = Join-Path (Split-Path $C) 'relocate-state.json'\nSet-Content -LiteralPath $s -Value '{}'\n")
    await launchRelocationHelper(f.script, f.config)
    expect(existsSync(f.state)).toBe(true)
  }, 30_000)

  it('rejects when the helper writes no state in time', async () => {
    const f = fixture('Start-Sleep -Seconds 20\n')
    await expect(launchRelocationHelper(f.script, f.config, 1_500)).rejects.toThrow(/wrote no state/u)
  }, 30_000)
})
