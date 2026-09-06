/**
 * Local Git provider specs over a scripted subprocess seam (B4-P2): the
 * exact git argv per query, failure classification (unavailable, unsupported
 * version, command failure), and the machine-format passthrough.
 * @module @deepseek-ai/dsh-git-local/tests/provider
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import LocalGitCapability from '../src/index.ts'
import {
  GitCommandFailedError, GitUnavailableError, GitUnsupportedVersionError,
} from '@deepseek-ai/dsh-git'

interface ScriptedGit {
  /** Invocation → scripted outcome, keyed by the joined argv. */
  script: Map<string, { exitCode?: number | null; stdout?: string; stderr?: string }>
  /** Recorded spawn specs in call order. */
  spawns: SubprocessSpawnSpec[]
  /** Whether `resolveExecutable` fails. */
  executableMissing?: boolean
}

function scriptedSubprocess(git: ScriptedGit): unknown {
  return {
    async resolveExecutable(command: string) {
      if (git.executableMissing === true) throw new Error(`cannot resolve ${command}`)
      return `resolved-${command}`
    },
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      git.spawns.push(spec)
      const scripted = git.script.get(spec.argv.join(' ')) ?? {}
      const text = (value: string | undefined) => ({ text: value ?? '', nextOffset: 0, lossy: false })
      return {
        pid: 1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => text(scripted.stdout) },
          stderr: { readFrom: () => text(scripted.stderr) },
        },
        done: Promise.resolve({ exitCode: scripted.exitCode ?? 0, signal: null }),
        terminate: () => {},
        waitFor: () => Promise.resolve(),
      } as unknown as SubprocessHandle
    },
    spawnTerminal: () => { throw new Error('provider tests never spawn terminals') },
  }
}

async function harness(git: ScriptedGit) {
  const ctx = new Context()
  ctx.provide('subprocess', scriptedSubprocess(git))
  await ctx.plugin(LocalGitCapability)
  return { gitCap: ctx.git, git }
}

const versionOk = 'git version 2.39.2\n'

describe('LocalGitCapability over a scripted subprocess', () => {
  it('runs the exact read-only argv for each query', async () => {
    const git: ScriptedGit = {
      script: new Map([
        ['resolved-git --version', { stdout: versionOk }],
        ['resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository', { stdout: '/repo\n/repo/.git\nfalse' }],
        ['resolved-git branch --show-current', { stdout: 'main\n' }],
        ['resolved-git rev-parse HEAD', { stdout: 'abc123\n' }],
      ]),
      spawns: [],
    }
    const { gitCap, git: recorded } = await harness(git)
    const identity = await gitCap.repoIdentity('/work')
    expect(identity).toEqual({ root: '/repo', gitDir: '/repo/.git', bare: false })
    const head = await gitCap.head('/work')
    expect(head).toEqual({ kind: 'branch', branch: 'main', oid: 'abc123' })

    expect(recorded.spawns.map(spec => spec.argv.join(' '))).toEqual([
      'resolved-git --version',
      'resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository',
      'resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository',
      'resolved-git branch --show-current',
      'resolved-git rev-parse HEAD',
    ])
    for (const spec of recorded.spawns) {
      expect(spec.argv[0]).toBe('resolved-git')
      // The version probe runs in the harness cwd; every query runs in the
      // caller's working directory.
      if (!spec.argv.includes('--version')) expect(spec.cwd).toBe('/work')
    }
  })

  it('classifies an unresolvable executable as unavailable', async () => {
    const git: ScriptedGit = { script: new Map(), spawns: [], executableMissing: true }
    const { gitCap } = await harness(git)
    await expect(gitCap.repoIdentity('/work')).rejects.toBeInstanceOf(GitUnavailableError)
  })

  it('classifies an old git version as unsupported', async () => {
    const git: ScriptedGit = {
      script: new Map([['resolved-git --version', { stdout: 'git version 2.10.3\n' }]]),
      spawns: [],
    }
    const { gitCap } = await harness(git)
    await expect(gitCap.repoIdentity('/work')).rejects.toBeInstanceOf(GitUnsupportedVersionError)
    await expect(gitCap.repoIdentity('/work')).rejects.toThrow(/2\.10\.3/)
  })

  it('classifies non-repository probes and presents raw stderr on command failures', async () => {
    const git: ScriptedGit = {
      script: new Map([
        ['resolved-git --version', { stdout: versionOk }],
        ['resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository',
          { exitCode: 128, stderr: 'fatal: not a git repository' }],
      ]),
      spawns: [],
    }
    const { gitCap } = await harness(git)
    await expect(gitCap.repoIdentity('/work')).rejects.toMatchObject({ name: 'GitNotARepositoryError' })
  })

  it('classifies every other non-zero exit as a command failure with the raw stderr', async () => {
    const git: ScriptedGit = {
      script: new Map([
        ['resolved-git --version', { stdout: versionOk }],
        ['resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository', { stdout: '/repo\n/repo/.git\nfalse' }],
        ['resolved-git -c core.fsmonitor=false status --porcelain=v2 --branch -z', { exitCode: 128, stderr: 'fatal: bad state' }],
      ]),
      spawns: [],
    }
    const { gitCap } = await harness(git)
    await expect(gitCap.status('/work')).rejects.toBeInstanceOf(GitCommandFailedError)
    await expect(gitCap.status('/work')).rejects.toMatchObject({
      exitCode: 128,
      stderr: 'fatal: bad state',
      command: ['resolved-git', '-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch', '-z'],
    })
  })

  it('reads upstream absence from the 128 rejection of the upstream probe', async () => {
    const git: ScriptedGit = {
      script: new Map([
        ['resolved-git --version', { stdout: versionOk }],
        ['resolved-git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository', { stdout: '/repo\n/repo/.git\nfalse' }],
        ['resolved-git rev-parse --abbrev-ref --symbolic-full-name @{u}', { exitCode: 128, stderr: 'fatal: no upstream' }],
      ]),
      spawns: [],
    }
    const { gitCap } = await harness(git)
    expect(await gitCap.upstream('/work')).toBeUndefined()
  })
})
