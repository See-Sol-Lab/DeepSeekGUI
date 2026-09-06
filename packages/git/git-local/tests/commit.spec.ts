/**
 * Commit operation specs (B4-P5) over REAL repositories: author identity
 * facts, the staged-tree snapshot, and the guarded commit — success, empty
 * index, unresolved conflicts, missing identity, hook refusal, staged-tree
 * drift, and the stdin-delivered message. Every fact comes from real git
 * output, never a hand-written mock.
 * @module @deepseek-ai/dsh-git-local/tests/commit
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitCapability from '@deepseek-ai/dsh-git-local'
import {
  GitCommandFailedError, GitStagedTreeDriftError,
} from '@deepseek-ai/dsh-git'

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const disposables: (() => void)[] = []

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir() }

function git(dir: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Stage a real repository with one seed commit and a configured identity. */
function stageRepo(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  git(dir, ['config', 'user.name', 'Test User'])
  git(dir, ['config', 'user.email', 't@example.com'])
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'])
  return dir
}

/** Stage one unstaged modification of a.txt (line03 → LINE03). */
function modifyA(dir: string): void {
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nLINE03\n')
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

describe.skipIf(!gitAvailable)('Git commit operations over real repositories (B4-P5)', () => {
  it('reports the configured author identity and undefined without one', async () => {
    const dir = stageRepo('identity')
    const gitCap = await harness()
    expect(await gitCap.authorIdentity(dir)).toEqual({ name: 'Test User', email: 't@example.com' })
    // An unconfigured repository reads no identity: the capability's spawned
    // git inherits the real HOME, whose global config could supply one, so
    // discovery is capped at an empty temp HOME for this assertion.
    const bare = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-git-noident-')))
    disposables.push(() => { rmSync(bare, { recursive: true, force: true }) })
    git(bare, ['-c', 'init.defaultBranch=main', 'init', '-q'])
    vi.stubEnv('HOME', tmpdir())
    try {
      expect(await gitCap.authorIdentity(bare)).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('commits the staged tree with the confirmed message and returns the SHA', async () => {
    const dir = stageRepo('commit-ok')
    modifyA(dir)
    git(dir, ['add', 'a.txt'])
    const gitCap = await harness()
    const tree = await gitCap.stagedTree(dir)
    // The message rides stdin: quotes, newlines, and non-ASCII are safe.
    const result = await gitCap.commit(dir, 'fix: 中文 "quoted" line\n\nbody line\n', tree)
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/u)
    // The post-commit tree comparison confirms the committed tree is exactly
    // the reviewed one (no check-to-commit window was used).
    expect(result.treeMatchesExpected).toBe(true)
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('fix: 中文 "quoted" line')
    expect(git(dir, ['log', '-1', '--format=%H']).trim()).toBe(result.sha)
    expect(git(dir, ['status', '--porcelain'])).toBe('')
  })

  it('refuses an empty index and unresolved conflicts before writing anything', async () => {
    const dir = stageRepo('commit-refuse')
    const gitCap = await harness()
    const tree = await gitCap.stagedTree(dir)
    await expect(gitCap.commit(dir, 'empty', tree))
      .rejects.toMatchObject({ name: 'GitCommitRefusedError', reason: 'empty-index' })

    // A real conflict: two branches edit the same line, then merge.
    git(dir, ['checkout', '-q', '-b', 'side'])
    writeFileSync(join(dir, 'a.txt'), 'one\nSIDE\nthree\n')
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'side'])
    git(dir, ['checkout', '-q', 'main'])
    writeFileSync(join(dir, 'a.txt'), 'one\nMAIN\nthree\n')
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'main'])
    try {
      git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'merge', 'side'])
    } catch {
      // Expected: the merge conflicts.
    }
    // The conflict check runs before any tree work, so the expected snapshot
    // is a placeholder here.
    await expect(gitCap.commit(dir, 'conflicted', '0'.repeat(40)))
      .rejects.toMatchObject({ name: 'GitCommitRefusedError', reason: 'conflict' })
    // Nothing was committed: HEAD still points at the main commit.
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('main')
  })

  it('refuses when no author identity is configured', async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-git-commit-noident-')))
    disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
    git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
    git(dir, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(dir, 'a.txt'), 'one\n')
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'])
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    git(dir, ['add', 'a.txt'])
    const gitCap = await harness()
    const tree = await gitCap.stagedTree(dir)
    // No identity anywhere: cap the global config away like the identity test.
    vi.stubEnv('HOME', tmpdir())
    try {
      await expect(gitCap.commit(dir, 'no ident', tree))
        .rejects.toMatchObject({ name: 'GitCommitRefusedError', reason: 'identity' })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('surfaces a hook refusal with the raw stderr', async () => {
    const dir = stageRepo('commit-hook')
    modifyA(dir)
    git(dir, ['add', 'a.txt'])
    const gitCap = await harness()
    const tree = await gitCap.stagedTree(dir)
    mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
    writeFileSync(join(dir, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\necho HOOK-REJECTED >&2\nexit 1\n')
    await expect(gitCap.commit(dir, 'rejected', tree))
      .rejects.toBeInstanceOf(GitCommandFailedError)
    const hookError = await gitCap.commit(dir, 'rejected', tree).catch((error: unknown) => error)
    expect(hookError).toBeInstanceOf(GitCommandFailedError)
    expect((hookError as GitCommandFailedError).message).toContain('HOOK-REJECTED')
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('first')
  })

  it('refuses a commit whose staged tree drifted from the confirmed snapshot', async () => {
    const dir = stageRepo('commit-drift')
    modifyA(dir)
    git(dir, ['add', 'a.txt'])
    const gitCap = await harness()
    const tree = await gitCap.stagedTree(dir)
    // The index changes externally after the user confirmed the snapshot:
    // another file gets staged, so the tree the user reviewed is no longer
    // the tree the commit would build.
    writeFileSync(join(dir, 'b.txt'), 'external\n')
    git(dir, ['add', 'b.txt'])
    await expect(gitCap.commit(dir, 'drifted', tree))
      .rejects.toBeInstanceOf(GitStagedTreeDriftError)
    // Nothing was committed and the drift names both trees.
    const drift = await gitCap.commit(dir, 'drifted', tree).catch((error: unknown) => error)
    expect(drift).toBeInstanceOf(GitStagedTreeDriftError)
    expect((drift as GitStagedTreeDriftError).expected).toBe(tree)
    expect((drift as GitStagedTreeDriftError).actual).toBe(await gitCap.stagedTree(dir))
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('first')
    // After re-review against the CURRENT tree, the commit succeeds and the
    // post-commit comparison confirms the committed tree.
    const freshTree = await gitCap.stagedTree(dir)
    const result = await gitCap.commit(dir, 're-reviewed', freshTree)
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/u)
    expect(result.treeMatchesExpected).toBe(true)
  })
})
