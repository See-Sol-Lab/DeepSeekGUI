/**
 * Real-output parity specs (B4-P2, per review discipline): the parsers'
 * input bytes MUST come from real `git` command captures, never hand-written
 * mock records — a hand-written mock and a wrong parser can hide each other.
 * Each case stages a real repository, captures the actual command stdout,
 * feeds those bytes to the pure parser, and asserts the classified facts.
 * @module @deepseek-ai/dsh-git-local/tests/parse-real
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  mergeDiffSummaries, parseGitVersion, parseNameStatusZ, parseNumstatZ,
  parsePorcelainV2, parseWorktreePorcelain,
} from '../src/parse.ts'

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const disposables: (() => void)[] = []

function stageRepo(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-parity-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q'], { cwd: dir, stdio: 'ignore' })
  return dir
}

/** Run a real git command and return its stdout bytes verbatim. */
function gitOut(dir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir() },
  })
}

function commitAll(dir: string, message: string): void {
  gitOut(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
  gitOut(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', message])
}

afterEach(() => {
  while (disposables.length > 0) disposables.pop()?.()
})

describe.skipIf(!gitAvailable)('parsers against REAL git stdout', () => {
  it('parses the real clean status (NUL-terminated headers)', () => {
    const dir = stageRepo('clean')
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    const bytes = gitOut(dir, ['status', '--porcelain=v2', '--branch', '-z'])
    const status = parsePorcelainV2(bytes)
    expect(status.clean).toBe(true)
    expect(status.head).toMatchObject({ kind: 'branch', name: 'main' })
    expect(status.entries).toEqual([])
  })

  it('parses real staged, unstaged, and untracked records', () => {
    const dir = stageRepo('mixed')
    writeFileSync(join(dir, 'tracked.txt'), 'one\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'tracked.txt'), 'two\n')
    writeFileSync(join(dir, 'staged.txt'), 'staged\n')
    writeFileSync(join(dir, 'fresh.txt'), 'untracked\n')
    gitOut(dir, ['add', 'staged.txt'])
    const bytes = gitOut(dir, ['status', '--porcelain=v2', '--branch', '-z'])
    const status = parsePorcelainV2(bytes)
    const kinds = status.entries.map(entry => entry.kind).sort()
    expect(kinds).toEqual(['staged', 'unstaged', 'untracked'])
    const staged = status.entries.find(entry => entry.kind === 'staged')
    expect(staged).toMatchObject({ path: 'staged.txt', x: 'A', y: '.' })
    const untracked = status.entries.find(entry => entry.kind === 'untracked')
    expect(untracked).toMatchObject({ path: 'fresh.txt' })
  })

  it('parses a real rename-plus-modify record (2 RM with second NUL field)', () => {
    const dir = stageRepo('rename')
    writeFileSync(join(dir, 'tracked.txt'), 'one\n')
    commitAll(dir, 'first')
    gitOut(dir, ['mv', 'tracked.txt', 'renamed.txt'])
    writeFileSync(join(dir, 'renamed.txt'), 'two\n')
    const bytes = gitOut(dir, ['status', '--porcelain=v2', '--branch', '-z'])
    const status = parsePorcelainV2(bytes)
    const rename = status.entries.find(entry => entry.path === 'renamed.txt')
    expect(rename).toMatchObject({
      kind: 'staged', x: 'R', y: 'M', origPath: 'tracked.txt', score: '100',
    })
  })

  it('parses a real add/add conflict record', () => {
    const dir = stageRepo('conflict')
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'base')
    gitOut(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'checkout', '-q', '-b', 'other'])
    writeFileSync(join(dir, 'clash.txt'), 'other\n')
    commitAll(dir, 'other-side')
    gitOut(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'checkout', '-q', 'main'])
    writeFileSync(join(dir, 'clash.txt'), 'main\n')
    commitAll(dir, 'main-side')
    try {
      gitOut(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'merge', 'other'])
    } catch {
      // expected: the merge conflicts
    }
    const bytes = gitOut(dir, ['status', '--porcelain=v2', '--branch', '-z'])
    const status = parsePorcelainV2(bytes)
    const conflict = status.entries.find(entry => entry.kind === 'conflict')
    expect(conflict?.path).toBe('clash.txt')
    expect(conflict?.x).toBe('A')
    expect(conflict?.y).toBe('A')
  })

  it('parses a real binary staged record', () => {
    const dir = stageRepo('binary')
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'blob.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
    gitOut(dir, ['add', 'blob.png'])
    const bytes = gitOut(dir, ['status', '--porcelain=v2', '--branch', '-z'])
    const status = parsePorcelainV2(bytes)
    expect(status.entries.find(entry => entry.path === 'blob.png'))
      .toMatchObject({ kind: 'staged', x: 'A' })
  })

  it('parses real worktree porcelain output', () => {
    const dir = stageRepo('worktree')
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    const second = join(dir, '..', `dsh-git-parity-wt-${process.pid}`)
    rmSync(second, { recursive: true, force: true })
    gitOut(dir, ['worktree', 'add', '-q', '-b', 'feature', second])
    const bytes = gitOut(dir, ['worktree', 'list', '--porcelain'])
    const worktrees = parseWorktreePorcelain(bytes)
    expect(worktrees).toHaveLength(2)
    expect(worktrees[0]).toMatchObject({ branch: 'main', detached: false })
    expect(worktrees[1]).toMatchObject({ branch: 'feature', detached: false })
  })

  it('parses real name-status and numstat diff bytes (including binary)', () => {
    const dir = stageRepo('diff')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0xff, 0xfe]))
    gitOut(dir, ['add', '-A'])

    const names = parseNameStatusZ(gitOut(dir, ['diff', '--cached', '--name-status', '-z']))
    const numstats = parseNumstatZ(gitOut(dir, ['diff', '--cached', '--numstat', '-z']))
    const files = mergeDiffSummaries(names, numstats)
    const text = files.find(file => file.path === 'a.txt')
    expect(text).toMatchObject({ status: 'modified', addedLines: 1 })
    const binary = files.find(file => file.path === 'blob.bin')
    expect(binary).toMatchObject({ status: 'added', binary: true })
    expect(binary?.addedLines).toBeUndefined()
  })

  it('parses the real git version line', () => {
    const output = gitOut(process.cwd(), ['--version'])
    const version = parseGitVersion(output)
    expect(version.major).toBeGreaterThanOrEqual(2)
    expect(version.minor).toBeGreaterThanOrEqual(0)
    expect(version.raw.startsWith('git version ')).toBe(true)
  })
})
