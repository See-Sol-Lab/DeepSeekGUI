/**
 * GitHub CLI pull-request provider specs (B4-P6) against a driven fake
 * subprocess: availability (logged in / not authenticated / gh missing), the
 * duplicate-creation guard, creation with exact argv (title, body, base,
 * head, draft), and every failure class. The fake never touches the network
 * and never carries a token; argv assertions prove nothing is
 * shell-interpreted and no credential is passed.
 * @module @deepseek-ai/dsh-pull-request-gh/tests/gh
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import GhPullRequestProvider, { classifyGhCreateFailure } from '@deepseek-ai/dsh-pull-request-gh'
import { PullRequestFailedError } from '@deepseek-ai/dsh-pull-request'

/** A fake subprocess handle: settled facts plus collected text, never a process. */
function fakeHandle(stdout: string, stderr: string, exitCode: number | null) {
  return {
    done: Promise.resolve({ exitCode, signal: null }),
    collected: {
      stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
    },
    terminate: () => {},
    waitForExit: () => Promise.resolve(true),
  }
}

/**
 * Compose the provider over a fake subprocess whose gh behaves per script.
 * @param script - 'logged-in' | 'logged-out' | 'missing' | 'existing-pr' |
 * 'create-ok' | 'create-duplicate' | 'create-auth-fail'.
 * @returns the provider plus the recorded argv of every spawn.
 */
async function harness(script: string) {
  const ctx = new Context()
  const calls: string[][] = []
  const stdins: unknown[] = []
  const spawn = (spec: { argv: readonly string[]; stdio?: { stdin?: unknown } }) => {
    calls.push([...spec.argv])
    stdins.push(spec.stdio?.stdin)
    const args = [...spec.argv]
    if (args[1] === 'auth') {
      if (script === 'logged-out') {
        return fakeHandle('', 'not logged in', 1)
      }
      return fakeHandle(
        'github.com\n  \u2713 Logged in to github.com account FakeUser (keyring)\n',
        '',
        0,
      )
    }
    if (args[2] === 'list') {
      if (script === 'existing-pr') {
        return fakeHandle(
          '[{"number": 3, "url": "https://github.com/o/r/pull/3"}]',
          '',
          0,
        )
      }
      return fakeHandle('[]', '', 0)
    }
    if (args[2] === 'create') {
      if (script === 'create-duplicate') {
        return fakeHandle(
          '',
          "a pull request for branch 'feature' into branch 'main' already exists:\nhttps://github.com/o/r/pull/3\n",
          1,
        )
      }
      if (script === 'create-auth-fail') {
        return fakeHandle('', 'Please run gh auth login first.', 1)
      }
      // `gh pr create` prints the new PR's URL on stdout (no --json flag).
      return fakeHandle('https://github.com/o/r/pull/7\n', '', 0)
    }
    return fakeHandle('', `unexpected gh argv: ${args.join(' ')}`, 1)
  }
  ctx.provide('subprocess', {
    resolveExecutable: async (command: string) => {
      if (script === 'missing') throw new Error(`subprocess-local: command "${command}" was not found on PATH`)
      return 'C:\\fake\\gh.exe'
    },
    spawn,
  } as never)
  await ctx.plugin(GhPullRequestProvider)
  return { provider: ctx.pullRequest as unknown as GhPullRequestProvider, calls, stdins }
}

describe('GitHub CLI pull-request provider (B4-P6)', () => {
  it('reports availability with the login facts, never a token', async () => {
    const { provider } = await harness('logged-in')
    const availability = await provider.availability('C:\\repo')
    expect(availability).toEqual({ available: true, auth: { host: 'github.com', account: 'FakeUser' } })
  })

  it('reports not-authenticated when gh is installed but not logged in', async () => {
    const { provider } = await harness('logged-out')
    expect(await provider.availability('C:\\repo')).toEqual({
      available: false,
      reason: 'not-authenticated',
    })
  })

  it('reports missing-gh when the executable cannot be resolved', async () => {
    const { provider } = await harness('missing')
    expect(await provider.availability('C:\\repo')).toEqual({
      available: false,
      reason: 'missing-gh',
    })
  })

  it('finds no existing PR when the head branch is clean', async () => {
    const { provider, calls } = await harness('create-ok')
    expect(await provider.existing('C:\\repo', 'feature')).toBeUndefined()
    expect(calls[0]).toEqual(['C:\\fake\\gh.exe', 'pr', 'list', '--head', 'feature', '--state', 'open', '--json', 'number,url'])
  })

  it('returns the existing PR as the duplicate-creation guard', async () => {
    const { provider } = await harness('existing-pr')
    expect(await provider.existing('C:\\repo', 'feature')).toEqual({
      number: 3,
      url: 'https://github.com/o/r/pull/3',
    })
  })

  it('creates a draft PR with exact argv: title, body, base, head, draft flag', async () => {
    const { provider, calls, stdins } = await harness('create-ok')
    const created = await provider.create('C:\\repo', {
      title: 'feat: 中文 "quoted" title',
      body: 'line one\nline two',
      base: 'main',
      head: 'feature',
      draft: true,
    })
    expect(created).toEqual({ number: 7, url: 'https://github.com/o/r/pull/7' })
    // Nothing is shell-interpreted: the exact argv carries every field, the
    // draft is a flag, and no credential ever appears. The body goes over
    // stdin (`--body-file -`) so a long description never hits argv limits.
    const index = calls.findIndex(call => call[2] === 'create')
    expect(calls[index]).toEqual([
      'C:\\fake\\gh.exe', 'pr', 'create',
      '--title', 'feat: 中文 "quoted" title',
      '--body-file', '-',
      '--base', 'main',
      '--head', 'feature',
      '--draft',
    ])
    expect(stdins[index]).toEqual({ data: 'line one\nline two' })
  })

  it('creates a non-draft PR without the draft flag', async () => {
    const { provider, calls } = await harness('create-ok')
    await provider.create('C:\\repo', {
      title: 't', body: 'b', base: 'main', head: 'feature', draft: false,
    })
    const argv = calls.find(call => call[2] === 'create')
    expect(argv?.includes('--draft')).toBe(false)
  })

  it('classifies a duplicate creation and extracts the existing PR URL', async () => {
    const { provider } = await harness('create-duplicate')
    const failure = await provider.create('C:\\repo', {
      title: 't', body: 'b', base: 'main', head: 'feature', draft: false,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PullRequestFailedError)
    expect((failure as PullRequestFailedError).reason).toBe('already-exists')
    expect((failure as PullRequestFailedError).url).toBe('https://github.com/o/r/pull/3')
  })

  it('classifies an auth failure with the raw stderr', async () => {
    const { provider } = await harness('create-auth-fail')
    const failure = await provider.create('C:\\repo', {
      title: 't', body: 'b', base: 'main', head: 'feature', draft: false,
    }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PullRequestFailedError)
    expect((failure as PullRequestFailedError).reason).toBe('auth')
    expect((failure as PullRequestFailedError).stderr).toContain('gh auth login')
  })

  it('throws missing-gh when creation cannot resolve the executable', async () => {
    const { provider } = await harness('missing')
    await expect(provider.create('C:\\repo', {
      title: 't', body: 'b', base: 'main', head: 'feature', draft: false,
    })).rejects.toMatchObject({ name: 'PullRequestUnavailableError', reason: 'missing-gh' })
  })

  it('classifies creation stderr into the stable reason vocabulary', () => {
    const duplicate = classifyGhCreateFailure(
      "a pull request for branch 'x' into branch 'main' already exists:\nhttps://github.com/o/r/pull/9\n",
    )
    expect(duplicate.reason).toBe('already-exists')
    expect(duplicate.url).toBe('https://github.com/o/r/pull/9')
    expect(classifyGhCreateFailure('Please run gh auth login to authenticate.')).toEqual({ reason: 'auth' })
    expect(classifyGhCreateFailure('some other failure')).toEqual({ reason: 'other' })
  })
})
