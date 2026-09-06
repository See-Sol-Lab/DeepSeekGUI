/**
 * Machine-format parser specs (B4-P2): porcelain v2 status, worktree
 * porcelain, name-status -z, and numstat -z against hand-built records.
 * @module @deepseek-ai/dsh-git-local/tests/parse
 */

import { describe, expect, it } from 'vitest'
import {
  mergeDiffSummaries, parseGitVersion, parseLogRecords, parseNameStatusZ, parseNumstatZ,
  parsePorcelainV2, parseWorktreePorcelain,
} from '../src/parse.ts'

describe('parseGitVersion', () => {
  it('parses the canonical version line', () => {
    expect(parseGitVersion('git version 2.39.2.windows.1\n')).toEqual({
      major: 2, minor: 39, raw: 'git version 2.39.2.windows.1',
    })
  })

  it('rejects unparseable output', () => {
    expect(() => parseGitVersion('not git at all')).toThrow(/cannot parse git version/)
  })
})

describe('parsePorcelainV2', () => {
  it('reports clean on branch headers only', () => {
    const status = parsePorcelainV2(
      '# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0',
    )
    expect(status.clean).toBe(true)
    expect(status.head).toEqual({ kind: 'branch', name: 'main', oid: 'abc123' })
    expect(status.upstream).toEqual({ ref: 'origin/main', ahead: 2, behind: 1 })
    expect(status.entries).toEqual([])
  })

  it('classifies staged, unstaged, and untracked records', () => {
    const status = parsePorcelainV2(
      '# branch.oid abc123\0# branch.head main\0'
      + '1 M. N... 100644 100644 100644 abc def staged.txt\0'
      + '1 .M N... 100644 100644 100644 abc def unstaged.txt\0'
      + '? new-file.txt\0',
    )
    expect(status.clean).toBe(false)
    expect(status.entries).toEqual([
      { kind: 'staged', path: 'staged.txt', x: 'M', y: '.' },
      { kind: 'unstaged', path: 'unstaged.txt', x: '.', y: 'M' },
      { kind: 'untracked', path: 'new-file.txt', x: '?', y: '?' },
    ])
  })

  it('parses rename records with their original path field', () => {
    const status = parsePorcelainV2(
      '# branch.oid abc123\u0000# branch.head main\u00002 R. N... 100644 100644 100644 abc def R100 new-name.txt\u0000old-name.txt\u0000',
    )
    expect(status.entries).toEqual([
      { kind: 'staged', path: 'new-name.txt', origPath: 'old-name.txt', x: 'R', y: '.', score: '100' },
    ])
  })

  it('parses conflict records', () => {
    const status = parsePorcelainV2(
      '# branch.oid abc123\0# branch.head main\0u UU N... 100644 100644 100644 100644 abc def ghi clash.txt\0',
    )
    expect(status.entries).toEqual([
      { kind: 'conflict', path: 'clash.txt', x: 'U', y: 'U' },
    ])
  })

  it('reports detached and unborn heads', () => {
    expect(parsePorcelainV2('# branch.oid abc123\0# branch.head \0').head)
      .toEqual({ kind: 'detached', name: '', oid: 'abc123' })
    expect(parsePorcelainV2('# branch.oid \0# branch.head main\0').head)
      .toEqual({ kind: 'branch', name: 'main', oid: undefined })
  })
})

describe('parseWorktreePorcelain', () => {
  it('parses blocks with branch, detached, and bare facts', () => {
    const output = [
      'worktree /proj',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /proj-feature',
      'HEAD def456',
      'branch refs/heads/feature',
      '',
      'worktree /proj-old',
      'HEAD 000000',
      'detached',
      '',
    ].join('\n')
    expect(parseWorktreePorcelain(output)).toEqual([
      { path: '/proj', head: 'abc123', branch: 'main', detached: false, bare: false },
      { path: '/proj-feature', head: 'def456', branch: 'feature', detached: false, bare: false },
      { path: '/proj-old', head: '000000', detached: true, bare: false },
    ])
  })

  it('marks bare repositories', () => {
    expect(parseWorktreePorcelain('worktree /proj.git\nHEAD abc\nbare\n')).toEqual([
      { path: '/proj.git', head: 'abc', detached: false, bare: true },
    ])
  })
})

describe('parseNameStatusZ', () => {
  it('parses plain and rename records', () => {
    expect(parseNameStatusZ('A\0added.txt\0M\0mod.txt\0R100\0old.txt\0new.txt\0')).toEqual([
      { status: 'added', path: 'added.txt' },
      { status: 'modified', path: 'mod.txt' },
      { status: 'renamed', path: 'new.txt', origPath: 'old.txt', score: 100 },
    ])
  })
})

describe('parseNumstatZ', () => {
  it('parses line counts, binary files, and rename pairs', () => {
    expect(parseNumstatZ('3\t1\tmod.txt\0-\t-\tblob.bin\0')).toEqual([
      { path: 'mod.txt', binary: false, addedLines: 3, deletedLines: 1 },
      { path: 'blob.bin', binary: true },
    ])
    // A rename row's in-record path is empty; both paths follow as NUL
    // fields, source first (real git bytes).
    expect(parseNumstatZ('1\t0\t\0old.txt\0new.txt\0')).toEqual([
      { path: 'new.txt', origPath: 'old.txt', binary: false, addedLines: 1, deletedLines: 0 },
    ])
  })
})

describe('mergeDiffSummaries', () => {
  it('joins name-status and numstat facts per path', () => {
    const names = parseNameStatusZ('A\0a.txt\0M\0b.txt\0')
    const numstats = parseNumstatZ('10\t0\ta.txt\0-\t-\tb.txt\0')
    expect(mergeDiffSummaries(names, numstats)).toEqual([
      { path: 'a.txt', status: 'added', binary: false, addedLines: 10, deletedLines: 0 },
      { path: 'b.txt', status: 'modified', binary: true },
    ])
  })
})

describe('parseLogRecords', () => {
  it('parses unit-separated log lines newest first and skips malformed lines', () => {
    const output = [
      'a'.repeat(40) + '\x1ffeat: one\x1f开发者\x1f1757000000',
      'b'.repeat(40) + '\x1ffix: two\x1fDev\x1f1756000000',
      'garbage line',
      '',
    ].join('\n')
    expect(parseLogRecords(output)).toEqual([
      { sha: 'a'.repeat(40), subject: 'feat: one', author: '开发者', time: 1757000000000 },
      { sha: 'b'.repeat(40), subject: 'fix: two', author: 'Dev', time: 1756000000000 },
    ])
    expect(parseLogRecords('')).toEqual([])
  })
})
