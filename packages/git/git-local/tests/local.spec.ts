/**
 * Local Git provider specs over REAL temporary repositories (B4-P2): repo
 * identity, head states, upstream, status surfaces (staged/unstaged/
 * untracked/conflict/rename/binary/submodule), work trees, and diffs —
 * every query read-only through the system git.
 * @module @deepseek-ai/dsh-git-local/tests/local
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitCapability from '../src/index.ts'
import { GitDiffTooLargeError, GitNotARepositoryError } from '@deepseek-ai/dsh-git'

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const disposables: (() => void)[] = []

/** Git reports paths with forward slashes even on Windows. */
const gitPath = (path: string): string => path.replace(/\\/gu, '/')

function stageRepo(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
  return dir
}

function git(dir: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      HOME: tmpdir(),
      ...env,
    },
  })
}

/** Commit every current change with a fixed identity. */
function commitAll(dir: string, message: string): void {
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', message])
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitCapability)
  return ctx.git
}

afterEach(() => {
  while (disposables.length > 0) disposables.pop()?.()
})

describe.skipIf(!gitAvailable)('LocalGitCapability over real repositories', () => {
  it('reports repo identity (root, git dir, non-bare)', async () => {
    const dir = stageRepo('identity')
    const gitCap = await harness()
    const identity = await gitCap.repoIdentity(dir)
    expect(identity.root).toBe(gitPath(dir))
    expect(identity.gitDir).toBe(gitPath(join(dir, '.git')))
    expect(identity.bare).toBe(false)
  })

  it('rejects a directory outside any repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-git-plain-'))
    disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const gitCap = await harness()
    // Discovery is capped at the temp root so an unrelated ancestor
    // repository (e.g. a stray `.git` in a home directory) cannot make this
    // machine-dependent; the ceiling env reaches the spawned git through the
    // inherited environment.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', realpathSync.native(tmpdir()))
    try {
      await expect(gitCap.repoIdentity(dir)).rejects.toBeInstanceOf(GitNotARepositoryError)
      await expect(gitCap.status(dir)).rejects.toBeInstanceOf(GitNotARepositoryError)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports branch, detached, and unborn heads', async () => {
    const dir = stageRepo('head')
    const gitCap = await harness()

    // Unborn: fresh repo has a branch name but no commit.
    const unborn = await gitCap.head(dir)
    expect(unborn.kind).toBe('unborn')

    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    const branch = await gitCap.head(dir)
    expect(branch).toMatchObject({ kind: 'branch', branch: 'main' })
    expect((branch as { oid: string }).oid).toMatch(/^[0-9a-f]{40}$/u)

    git(dir, ['checkout', '-q', '--detach'])
    const detached = await gitCap.head(dir)
    expect(detached.kind).toBe('detached')
    expect((detached as { oid: string }).oid).toMatch(/^[0-9a-f]{40}$/u)
  })

  it('reports upstream with ahead/behind counts and absent upstream', async () => {
    const dir = stageRepo('upstream')
    const remote = stageRepo('upstream-remote')
    git(remote, ['config', 'receive.denyCurrentBranch', 'ignore'])
    const gitCap = await harness()

    expect(await gitCap.upstream(dir)).toBeUndefined()

    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    git(dir, ['remote', 'add', 'origin', remote])
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'push', '-q', '-u', 'origin', 'main'])

    expect(await gitCap.upstream(dir)).toMatchObject({ ref: 'origin/main', ahead: 0, behind: 0 })

    writeFileSync(join(dir, 'more.txt'), 'more\n')
    commitAll(dir, 'second')
    expect(await gitCap.upstream(dir)).toMatchObject({ ref: 'origin/main', ahead: 1, behind: 0 })
  })

  it('classifies staged, unstaged, untracked, and rename entries', async () => {
    const dir = stageRepo('status')
    const gitCap = await harness()
    writeFileSync(join(dir, 'tracked.txt'), 'one\n')
    commitAll(dir, 'first')

    // Rename in the index first, then modify the moved file in the work tree
    // and add an untracked file — one staged rename, one unstaged modify.
    git(dir, ['mv', 'tracked.txt', 'renamed.txt'])
    writeFileSync(join(dir, 'renamed.txt'), 'two\n')
    writeFileSync(join(dir, 'fresh.txt'), 'new\n')

    const status = await gitCap.status(dir)
    expect(status.clean).toBe(false)
    // The rename-plus-modify case is ONE `2 RM` record: staged rename with a
    // work-tree modification in the Y column, plus the untracked file.
    const kinds = status.entries.map(entry => entry.kind).sort()
    expect(kinds).toEqual(['staged', 'untracked'])
    const rename = status.entries.find(entry => entry.path === 'renamed.txt')
    expect(rename).toMatchObject({ kind: 'staged', x: 'R', y: 'M', origPath: 'tracked.txt' })
  })

  it('reports a merge conflict', async () => {
    const dir = stageRepo('conflict')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'base')
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'checkout', '-q', '-b', 'other'])
    writeFileSync(join(dir, 'clash.txt'), 'other\n')
    commitAll(dir, 'other-side')
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'checkout', '-q', 'main'])
    writeFileSync(join(dir, 'clash.txt'), 'main\n')
    commitAll(dir, 'main-side')

    // Merge fails loudly; status then reports the conflict.
    try {
      git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'merge', 'other'])
    } catch {
      // expected: the merge conflicts
    }
    const status = await gitCap.status(dir)
    const conflict = status.entries.find(entry => entry.kind === 'conflict')
    expect(conflict?.path).toBe('clash.txt')
    // An add/add merge conflict carries 'A' in both columns.
    expect(conflict?.x).toBe('A')
    expect(conflict?.y).toBe('A')
  })

  it('reports binary files in status and diff', async () => {
    const dir = stageRepo('binary')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    // Minimal PNG header: bytes that are not valid UTF-8 text.
    writeFileSync(join(dir, 'blob.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
    git(dir, ['add', 'blob.png'])
    const status = await gitCap.status(dir)
    const entry = status.entries.find(e => e.path === 'blob.png')
    expect(entry?.kind).toBe('staged')

    const diff = await gitCap.diff(dir, 'staged')
    const binary = diff.files.find(file => file.path === 'blob.png')
    expect(binary).toMatchObject({ status: 'added', binary: true })
    expect(binary?.addedLines).toBeUndefined()
  })

  it('lists work trees including a second checkout', async () => {
    const dir = stageRepo('worktree')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    const second = join(dir, '..', 'dsh-git-wt-second')
    rmSync(second, { recursive: true, force: true })
    git(dir, ['worktree', 'add', '-q', '-b', 'feature', second])

    const worktrees = await gitCap.worktrees(dir)
    expect(worktrees).toHaveLength(2)
    const main = worktrees.find(wt => wt.path === gitPath(dir))
    expect(main).toMatchObject({ branch: 'main', detached: false })
    const feature = worktrees.find(wt => wt.path === gitPath(realpathSync.native(second)))
    expect(feature).toMatchObject({ branch: 'feature', detached: false })
    expect(feature?.head).toMatch(/^[0-9a-f]{40}$/u)
  })

  it('reads the newest commits and returns none for an unborn branch', async () => {
    const dir = stageRepo('log')
    const gitCap = await harness()
    expect(await gitCap.log(dir, 5)).toEqual([])
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'seed.txt'), 'seed two\n')
    commitAll(dir, 'second')
    const commits = await gitCap.log(dir, 1)
    expect(commits).toHaveLength(1)
    expect(commits[0]).toMatchObject({ subject: 'second' })
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/u)
    expect(commits[0]?.time).toBeGreaterThan(1_600_000_000_000)
    expect((await gitCap.log(dir, 10)).map(commit => commit.subject)).toEqual(['second', 'first'])
  })

  it('reads staged and unstaged diffs with line counts and patches', async () => {
    const dir = stageRepo('diff')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    git(dir, ['add', 'a.txt'])
    writeFileSync(join(dir, 'a.txt'), 'one\nthree\n')

    const staged = await gitCap.diff(dir, 'staged')
    expect(staged.files).toEqual([
      { path: 'a.txt', status: 'added', binary: false, addedLines: 3, deletedLines: 0 },
    ])

    const unstaged = await gitCap.diff(dir, 'unstaged')
    expect(unstaged.files).toEqual([
      { path: 'a.txt', status: 'modified', binary: false, addedLines: 0, deletedLines: 1 },
    ])

    const patch = await gitCap.diff(dir, 'unstaged', 'a.txt', true)
    expect(patch.patch).toContain('diff --git a/a.txt b/a.txt')
    expect(patch.patch).toContain('-two')
  })

  it('reports a staged rename with the destination path and line counts', async () => {
    // Real-bytes guard for the -z rename field order (source first): the
    // acceptance pass caught both -z parsers reading the pair reversed while
    // their unit mocks encoded the same wrong assumption — only a real
    // `git mv` can hold this line.
    const dir = stageRepo('renamediff')
    const gitCap = await harness()
    writeFileSync(join(dir, 'before.txt'), 'one\ntwo\nthree\nfour\n')
    commitAll(dir, 'first')
    git(dir, ['mv', 'before.txt', 'after.txt'])
    writeFileSync(join(dir, 'after.txt'), 'one\ntwo\nthree\nfour\nfive\n')
    git(dir, ['add', 'after.txt'])

    const diff = await gitCap.diff(dir, 'staged')
    const renamed = diff.files.find(file => file.status === 'renamed')
    expect(renamed).toMatchObject({
      path: 'after.txt',
      origPath: 'before.txt',
      binary: false,
      addedLines: 1,
      deletedLines: 0,
    })
    expect(renamed?.score).toBeGreaterThan(0)
  })

  it('refuses a patch that exceeds the size bound', async () => {
    const dir = stageRepo('toolarge')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(10_000) + '\n')
    git(dir, ['add', 'big.txt'])
    await expect(gitCap.diff(dir, 'staged', 'big.txt', true, 128))
      .rejects.toBeInstanceOf(GitDiffTooLargeError)
  })

  it('reports submodule changes with explicit entries', async () => {
    const dir = stageRepo('submodule')
    const subSource = stageRepo('submodule-source')
    const gitCap = await harness()
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    commitAll(dir, 'first')
    writeFileSync(join(subSource, 'inner.txt'), 'v1\n')
    commitAll(subSource, 'inner-first')

    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subSource, 'sub'])
    commitAll(dir, 'add-submodule')

    const clean = await gitCap.status(dir)
    expect(clean.clean).toBe(true)

    // Advance the submodule's own HEAD, fetch it into the submodule checkout,
    // then move that checkout forward — the parent now shows a modified
    // submodule gitlink.
    writeFileSync(join(subSource, 'inner.txt'), 'v2\n')
    commitAll(subSource, 'inner-second')
    const newHead = git(subSource, ['rev-parse', 'HEAD']).trim()
    git(join(dir, 'sub'), ['fetch', '-q'])
    git(join(dir, 'sub'), ['checkout', '-q', newHead])
    const status = await gitCap.status(dir)
    const sub = status.entries.find(entry => entry.path === 'sub')
    expect(sub).toBeDefined()
    expect(sub?.kind).toBe('unstaged')
  })
})
