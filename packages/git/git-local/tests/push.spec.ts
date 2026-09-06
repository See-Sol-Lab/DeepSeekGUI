/**
 * Push operation specs (B4-P6) over REAL repositories and REAL bare remotes:
 * the preview facts (remote URL, refs, ahead commits, remote-ref existence,
 * credential helper), new-branch and fast-forward pushes, and every refusal
 * class — non-fast-forward, protected branch, missing remote repository,
 * unconfigured remote, unreachable remote (preview degradation), and
 * detached HEAD. Every fact comes from real git output, never a mock.
 * @module @deepseek-ai/dsh-git-local/tests/push
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitCapability, { classifyPushFailure } from '@deepseek-ai/dsh-git-local'
import {
  GitCommandFailedError, GitNoSuchRemoteError,
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

/** A bare remote repository (the test's stand-in for a hosted remote). */
function stageBareRemote(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-bare-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  git(join(dir, '..'), ['init', '--bare', '-q', dir])
  return dir
}

/** Stage a repository with one seed commit, an identity, and `remote` configured. */
function stageRepo(prefix: string, remote: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-push-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  git(dir, ['config', 'user.name', 'Test User'])
  git(dir, ['config', 'user.email', 't@example.com'])
  git(dir, ['remote', 'add', 'origin', remote])
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'first'])
  return dir
}

function commit(dir: string, message: string): void {
  writeFileSync(join(dir, 'a.txt'), `${git(dir, ['cat-file', '-p', 'HEAD:a.txt']).trim()}\n${message}\n`)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
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

describe.skipIf(!gitAvailable)('Git push operations over real bare remotes (B4-P6)', () => {
  it('rejects force and deletion refspecs without moving the remote', async () => {
    const bare = stageBareRemote('refspec')
    const repo = stageRepo('refspec', bare)
    git(repo, ['push', 'origin', 'main'])
    const before = git(bare, ['rev-parse', 'main']).trim()
    const gitCap = await harness()
    for (const branch of ['+main', '', 'main:other']) {
      await expect(gitCap.push(repo, 'origin', branch, 'main')).rejects.toThrow()
    }
    expect(git(bare, ['rev-parse', 'main']).trim()).toBe(before)
  })

  it('previews the selected branch and effective push URL, then rejects approval drift', async () => {
    const fetchBare = stageBareRemote('fetch')
    const pushBare = stageBareRemote('push')
    const repo = stageRepo('explicit-preview', fetchBare)
    git(repo, ['config', 'remote.origin.pushurl', pushBare])
    git(repo, ['branch', 'selected'])
    commit(repo, 'not selected')
    const gitCap = await harness()
    const preview = await gitCap.pushPreview(repo, 'origin', 'selected', 'release')
    expect(preview.remote.pushUrl).toBe(pushBare)
    expect(preview.localBranch).toBe('selected')
    expect(preview.remoteBranch).toBe('release')
    expect(preview.sourceOid).toBe(git(repo, ['rev-parse', 'selected']).trim())
    expect(preview.aheadCommits.some(line => line.includes('not selected'))).toBe(false)
    git(repo, ['branch', '-f', 'selected', 'main'])
    await expect(gitCap.push(repo, 'origin', 'selected', 'release', { sourceOid: preview.sourceOid, pushUrl: pushBare }))
      .rejects.toThrow('changed after approval')
    expect(git(pushBare, ['for-each-ref']).trim()).toBe('')
  })
  it('previews a new branch and pushes it to the bare remote', async () => {
    const bare = stageBareRemote('new-branch')
    const repo = stageRepo('new-branch', bare)
    commit(repo, 'second')
    git(repo, ['checkout', '-q', '-b', 'feature'])
    const gitCap = await harness()

    const preview = await gitCap.pushPreview(repo, 'origin')
    expect(preview.remote.name).toBe('origin')
    expect(preview.remote.fetchUrl).toBe(bare)
    expect(preview.localBranch).toBe('feature')
    expect(preview.remoteBranch).toBe('feature')
    // No upstream and no remote ref: the push would create the branch.
    expect(preview.upstream).toBeUndefined()
    expect(preview.remoteRefExists).toBe(false)
    expect(preview.aheadCommits).toHaveLength(2)
    expect(preview.aheadCommits[0]).toMatch(/second/u)

    const outcome = await gitCap.push(repo, 'origin', 'feature', 'feature')
    expect(outcome.remote).toBe('origin')
    expect(outcome.remoteBranch).toBe('feature')
    expect(outcome.pushedSha).toMatch(/^[0-9a-f]{40}$/u)
    // The remote really holds the branch at the pushed SHA.
    const remoteSha = git(bare, ['rev-parse', 'refs/heads/feature']).trim()
    expect(remoteSha).toBe(outcome.pushedSha)
    // The remote-tracking ref advances too: the push goes to the exact URL,
    // which git alone would not book against `refs/remotes/origin/*`, and
    // a stale tracking ref would keep `status` reporting the branch ahead.
    expect(git(repo, ['rev-parse', 'refs/remotes/origin/feature']).trim()).toBe(outcome.pushedSha)
    // The upstream configuration is never touched by the push itself: the
    // branch still has no upstream afterwards (setting one stays a separate
    // explicit operation).
    expect(() => git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))
      .toThrow()
  })

  it('reports the credential helper as the authentication source when configured', async () => {
    const bare = stageBareRemote('helper')
    const repo = stageRepo('helper', bare)
    git(repo, ['config', 'credential.helper', 'test-helper'])
    const gitCap = await harness()
    const preview = await gitCap.pushPreview(repo, 'origin')
    expect(preview.credentialHelper).toBe('test-helper')
  })

  it('pushes a fast-forward when an upstream exists and shows the ahead range', async () => {
    const bare = stageBareRemote('fast-forward')
    const repo = stageRepo('fast-forward', bare)
    git(repo, ['push', '-q', 'origin', 'main:main'])
    git(repo, ['branch', '--set-upstream-to', 'origin/main', 'main'])
    commit(repo, 'one-ahead')
    const gitCap = await harness()

    const preview = await gitCap.pushPreview(repo, 'origin')
    expect(preview.upstream).toBe('origin/main')
    expect(preview.remoteRefExists).toBe(true)
    expect(preview.aheadCommits).toHaveLength(1)
    expect(preview.aheadCommits[0]).toMatch(/one-ahead/u)

    const outcome = await gitCap.push(repo, 'origin', 'main', 'main')
    expect(git(bare, ['rev-parse', 'refs/heads/main']).trim()).toBe(outcome.pushedSha)
    // After the push nothing is ahead anymore.
    const after = await gitCap.pushPreview(repo, 'origin')
    expect(after.aheadCommits).toEqual([])
  })

  it('refuses a non-fast-forward push with the classified reason', async () => {
    const bare = stageBareRemote('non-ff')
    const first = stageRepo('non-ff-a', bare)
    git(first, ['push', '-q', 'origin', 'main:main'])
    // A second clone of the same remote: same history base, then both sides
    // diverge — the second side's push is a non-fast-forward.
    const second = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-git-push-non-ff-b-')))
    disposables.push(() => { rmSync(second, { recursive: true, force: true }) })
    git(join(second, '..'), ['clone', '-q', '--branch', 'main', bare, second])
    git(second, ['config', 'user.name', 'Test User'])
    git(second, ['config', 'user.email', 't@example.com'])
    commit(first, 'ahead-a')
    git(first, ['push', '-q', 'origin', 'main:main'])
    commit(second, 'ahead-b')
    const gitCap = await harness()
    await expect(gitCap.push(second, 'origin', 'main', 'main'))
      .rejects.toMatchObject({ name: 'GitPushRefusedError', reason: 'non-fast-forward' })
    // Nothing changed on the remote.
    const remoteSha = git(bare, ['rev-parse', 'refs/heads/main']).trim()
    expect(remoteSha).toBe(git(first, ['rev-parse', 'HEAD']).trim())
  })

  it('reports a protected-branch refusal from a pre-receive hook', async () => {
    const bare = stageBareRemote('protected')
    mkdirSync(join(bare, 'hooks'), { recursive: true })
    writeFileSync(
      join(bare, 'hooks', 'pre-receive'),
      '#!/bin/sh\necho "protected branch hook declined: main"\nexit 1\n',
    )
    const repo = stageRepo('protected', bare)
    const gitCap = await harness()
    await expect(gitCap.push(repo, 'origin', 'main', 'main'))
      .rejects.toMatchObject({ name: 'GitPushRefusedError', reason: 'protected' })
  })

  it('reports a missing remote repository as not-found', async () => {
    const missing = join(realpathSync.native(tmpdir()), `dsh-git-push-missing-${process.pid}`)
    const repo = stageRepo('not-found', missing)
    const gitCap = await harness()
    await expect(gitCap.push(repo, 'origin', 'main', 'main'))
      .rejects.toMatchObject({ name: 'GitPushRefusedError', reason: 'not-found' })
  })

  it('refuses an unconfigured remote before any network write', async () => {
    const repo = stageRepo('no-remote', stageBareRemote('no-remote'))
    const gitCap = await harness()
    await expect(gitCap.pushPreview(repo, 'nonexistent')).rejects.toBeInstanceOf(GitNoSuchRemoteError)
    await expect(gitCap.push(repo, 'nonexistent', 'main', 'main'))
      .rejects.toBeInstanceOf(GitNoSuchRemoteError)
  })

  it('degrades the preview to local facts when the remote is unreachable', async () => {
    const missing = join(realpathSync.native(tmpdir()), `dsh-git-push-gone-${process.pid}`)
    const repo = stageRepo('gone', missing)
    commit(repo, 'offline-commit')
    const gitCap = await harness()
    const preview = await gitCap.pushPreview(repo, 'origin')
    // The remote could not be queried: local facts still arrive, the remote
    // ref existence is honestly unknown (never guessed).
    expect(preview.localBranch).toBe('main')
    expect(preview.aheadCommits).toHaveLength(2)
    expect(preview.remoteRefExists).toBeUndefined()
    expect(preview.defaultBranch).toBeUndefined()
  })

  it('refuses a push preview without a checked-out branch', async () => {
    const bare = stageBareRemote('detached')
    const repo = stageRepo('detached', bare)
    git(repo, ['push', '-q', 'origin', 'main:main'])
    const detachedSha = git(repo, ['rev-parse', 'HEAD']).trim()
    git(repo, ['checkout', '-q', detachedSha])
    const gitCap = await harness()
    await expect(gitCap.pushPreview(repo, 'origin'))
      .rejects.toBeInstanceOf(GitCommandFailedError)
  })

  it('classifies refusal stderr into the stable reason vocabulary', () => {
    expect(classifyPushFailure('! [rejected] main -> main (non-fast-forward)')).toBe('non-fast-forward')
    expect(classifyPushFailure('! [remote rejected] main -> main (protected branch hook declined)'))
      .toBe('protected')
    expect(classifyPushFailure('fatal: Authentication failed for https://github.com/')).toBe('auth')
    expect(classifyPushFailure("fatal: could not read Username for 'https://github.com': terminal prompts disabled"))
      .toBe('auth')
    expect(classifyPushFailure("fatal: repository 'https://x/y.git/' not found")).toBe('not-found')
    expect(classifyPushFailure('fatal: unable to access https://127.0.0.1/: Failed to connect')).toBe('network')
    expect(classifyPushFailure('fatal: Could not resolve host: github.com')).toBe('network')
    expect(classifyPushFailure('some unknown refusal text')).toBe('rejected')
  })
})
