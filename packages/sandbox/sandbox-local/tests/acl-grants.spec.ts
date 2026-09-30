/**
 * windows-acl grant ownership through the real LocalSandboxProvider: one
 * workspace grant per workspace, made through the out-of-process
 * `acl-helper` and — DeepSeekGUI (2026-09-29) — taken back once the root is
 * idle and no runner holds a lease; plus one random, distinct, revocable temp
 * capability per live session/workspace pair. The Win32 grant surface and the
 * helper are mocked; native access checks live in sandbox-windows-acl's
 * runner and acl suites.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import type { AclHelperCommand } from '@deepseek-ai/dsh-sandbox-local'

/** Cross-file state shared with the vi.mock factory (hoisting contract). */
const mockState = vi.hoisted(() => ({
  grants: [] as Array<{
    writeSid: string
    added: Array<{ path: string; standing: boolean; readOnly?: readonly string[] }>
    disposed: boolean
  }>,
  addFailure: undefined as Error | undefined,
  createTempFailure: undefined as Error | undefined,
  disposeFailure: undefined as Error | undefined,
  /** What the in-process probe reports, by root (default: nothing there). */
  inspected: new Map<string, { grant: boolean; marks: boolean }>(),
}))

vi.mock('@deepseek-ai/dsh-sandbox-windows-acl', () => {
  class MockAclWriteGrant {
    readonly writeSid: string
    readonly added: Array<{ path: string; standing: boolean; readOnly?: readonly string[] }> = []
    disposed = false
    constructor(writeSid: string) {
      this.writeSid = writeSid
      mockState.grants.push(this)
    }
    static create(writeSid: string): MockAclWriteGrant {
      if (writeSid.startsWith('TEMP:') && mockState.createTempFailure !== undefined) throw mockState.createTempFailure
      return new MockAclWriteGrant(writeSid)
    }
    add(path: string, standing = false, readOnly: readonly string[] = []): void {
      this.added.push({ path, standing, ...readOnly.length === 0 ? {} : { readOnly } })
      if (mockState.addFailure !== undefined) throw mockState.addFailure
    }
    dispose(): void {
      if (mockState.disposeFailure !== undefined) throw mockState.disposeFailure
      this.disposed = true
    }
    inspect(root: string): { grant: boolean; marks: boolean } {
      return mockState.inspected.get(root) ?? { grant: false, marks: false }
    }
  }
  return {
    registerAclDiagnosisSkill: vi.fn(),
    AclWriteGrant: MockAclWriteGrant,
    assertTempRootOutsideWorkspace: (workspaceRoot: string, tempRoot: string) => {
      const workspace = realpathSync.native(workspaceRoot)
      const temp = realpathSync.native(tempRoot)
      if (temp === workspace || temp.startsWith(`${workspace}${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new Error(`Windows ACL temp root must be outside the workspace: workspace=${workspaceRoot}; temp=${tempRoot}`)
      }
    },
    workspaceWriteSid: () => 'S-1-4-42-42',
    tempWriteSid: (path: string) => `TEMP:${path}`,
  }
})

const WORKSPACE_SID = 'S-1-4-42-42'
const LEASE_DIR = join(tmpdir(), 'dsh-acl-leases', WORKSPACE_SID)

/** The mocked helper and the world it acts on. */
interface HelperWorld {
  calls: Array<{ command: AclHelperCommand; workspace: string; readOnly: string[] }>
  /** Roots whose workspace grant stands. */
  granted: Set<string>
  /** Roots carrying marks some earlier build left. */
  marked: Set<string>
  /** Pids whose runner is still running. */
  alive: Set<number>
  /** Roots handed to the detached revoke at dispose. */
  detached: string[]
  failure: Error | undefined
  /** When set, the next helper run waits for it. */
  gate: Promise<void> | undefined
}

/**
 * A provider on a mocked win32 host. By default the helper, the probe, the
 * lease liveness check, and the detached revoke are in-memory fakes;
 * `helperEntry` instead keeps the real out-of-process paths and points them
 * at a fake built `acl-helper` entry.
 */
async function setup(options: { helperEntry?: string } = {}) {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalSandboxProvider, {})
  const sandbox = ctx.sandbox as LocalSandboxProvider
  const clock = { now: 1_000_000 }
  const helper: HelperWorld = {
    calls: [], granted: new Set(), marked: new Set(), alive: new Set(), detached: [], failure: undefined, gate: undefined,
  }
  if (options.helperEntry !== undefined) {
    sandbox.internals = {
      platform: 'win32',
      windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
      aclHelperEntry: options.helperEntry,
      now: () => clock.now,
    }
    return { ctx, sandbox, fiber, clock, helper }
  }
  sandbox.internals = {
    platform: 'win32',
    windowsAclRunnerArgs: ['node', 'windows-acl-runner.js'],
    aclHelper: async (command, workspace, readOnly) => {
      helper.calls.push({ command, workspace, readOnly: [...readOnly] })
      if (helper.gate !== undefined) await helper.gate
      if (helper.failure !== undefined) throw helper.failure
      if (command === 'grant') helper.granted.add(workspace)
      else {
        helper.granted.delete(workspace)
        helper.marked.delete(workspace)
      }
    },
    inspectWorkspace: workspace => ({
      grant: helper.granted.has(workspace),
      marks: helper.granted.has(workspace) || helper.marked.has(workspace),
    }),
    leaseAlive: pid => helper.alive.has(pid),
    now: () => clock.now,
    revokeDetached: (workspace) => { helper.detached.push(workspace) },
  }
  return { ctx, sandbox, fiber, clock, helper }
}

function workspaceRoot(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'dsh-acl-grants-ws-')))
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index < 0 ? undefined : argv[index + 1]
}

describe('windows-acl write grants (LocalSandboxProvider)', () => {
  const scratch: string[] = []

  beforeEach(() => {
    mockState.inspected = new Map()
    mockState.grants = []
    mockState.addFailure = undefined
    mockState.createTempFailure = undefined
    mockState.disposeFailure = undefined
  })
  afterEach(() => { rmSync(LEASE_DIR, { recursive: true, force: true }) })

  const cleanup = () => {
    for (const grant of mockState.grants) {
      for (const added of grant.added) {
        if (!added.standing) rmSync(added.path, { recursive: true, force: true })
      }
    }
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  }

  it('does not create grants for a cancelled confinement request', async () => {
    const { sandbox, fiber, helper } = await setup()
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      const reason = new Error('cancel before grant creation')
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('cancelled'),
      }, AbortSignal.abort(reason))).rejects.toBe(reason)
      expect(mockState.grants).toEqual([])
      expect(helper.calls).toEqual([])
    } finally { await fiber.dispose(); cleanup() }
  })

  it('workspace-write grants the workspace through acl-helper and one private temp capability, then reuses both', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('sess-1') }

      const confined = await sandbox.confine(['pwsh', '/Command', 'x'], policy)
      const tempDir = flag(confined.argv, '--temp')
      const tempSid = flag(confined.argv, '--temp-write-sid')
      expect(tempDir).toBeDefined()
      expect(basename(tempDir ?? '')).toMatch(/^dsh-[A-Za-z0-9_-]{6}$/u)
      expect(tempSid).toBe(`TEMP:${tempDir}`)
      expect(confined.argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', ws,
        '--temp', tempDir,
        '--mode', 'workspace-write',
        '--write-sid', WORKSPACE_SID,
        '--temp-write-sid', tempSid,
        '--lease', LEASE_DIR,
        '--',
        'pwsh', '/Command', 'x',
      ])
      expect(helper.calls).toEqual([{ command: 'grant', workspace: ws, readOnly: [] }])
      expect(mockState.grants).toEqual([
        expect.objectContaining({ writeSid: tempSid, added: [{ path: tempDir, standing: false }], disposed: false }),
      ])
      expect(existsSync(tempDir ?? '')).toBe(true)

      expect((await sandbox.confine(['pwsh', '/Command', 'x'], policy)).argv).toEqual(confined.argv)
      expect(helper.calls).toHaveLength(1)
      expect(mockState.grants).toHaveLength(1)

      await fiber.dispose()
      expect(mockState.grants.every(grant => grant.disposed)).toBe(true)
      expect(existsSync(tempDir ?? '')).toBe(false)
      expect(helper.detached).toEqual([ws])
    } finally {
      cleanup()
    }
  })

  it('keeps a nested repository\'s .git read-only: passed to the workspace grant, or to an agentless runner', async () => {
    const { sandbox, fiber, helper } = await setup()
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      const childGit = join(ws, 'child', '.git')
      mkdirSync(childGit, { recursive: true })
      mkdirSync(join(ws, '.git'))

      await sandbox.confine(['pwsh'], { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('nested') })
      expect(helper.calls).toEqual([{ command: 'grant', workspace: ws, readOnly: [childGit] }])

      const agentless = await sandbox.confine(['pwsh'], { mode: 'workspace-write', workspaceRoot: ws })
      expect(flag(agentless.argv, '--read-only')).toBe(childGit)
      const readOnly = await sandbox.confine(['pwsh'], { mode: 'read-only', workspaceRoot: ws })
      expect(readOnly.argv).not.toContain('--read-only')
    } finally { await fiber.dispose(); cleanup() }
  })

  it('read-only materializes no capability and holds no lease; upgrade creates them and downgrade leaves them reusable', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const readOnly: SandboxPolicy = { mode: 'read-only', workspaceRoot: ws, sessionId: SessionId('switch') }
      const workspaceWrite: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('switch') }

      expect((await sandbox.confine(['true'], readOnly)).argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', ws,
        '--temp', tmpdir(),
        '--mode', 'read-only',
        '--',
        'true',
      ])
      expect(mockState.grants).toHaveLength(0)
      expect(helper.calls).toHaveLength(0)

      const upgraded = await sandbox.confine(['true'], workspaceWrite)
      expect(flag(upgraded.argv, '--temp-write-sid')).not.toBe(WORKSPACE_SID)
      expect(helper.calls).toHaveLength(1)
      expect(mockState.grants).toHaveLength(1)
      await sandbox.confine(['true'], readOnly)
      expect(mockState.grants.every(grant => !grant.disposed)).toBe(true)
      expect((await sandbox.confine(['true'], workspaceWrite)).argv).toEqual(upgraded.argv)
      expect(helper.calls).toHaveLength(1)

      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('a fresh provider gives a resumed session a new temp path and SID, so crash residue cannot collide', async () => {
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('resumed') }
      const first = await setup()
      const firstConfined = await first.sandbox.confine(['true'], policy)
      const firstTemp = flag(firstConfined.argv, '--temp') ?? ''

      // The first provider remains live: model an unclean prior process whose
      // temp directory and ACE survived. A new provider must still proceed.
      const second = await setup()
      const secondConfined = await second.sandbox.confine(['true'], policy)
      const secondTemp = flag(secondConfined.argv, '--temp') ?? ''
      expect(secondTemp).not.toBe(firstTemp)
      expect(flag(secondConfined.argv, '--temp-write-sid')).not.toBe(flag(firstConfined.argv, '--temp-write-sid'))
      expect(existsSync(firstTemp)).toBe(true)
      expect(existsSync(secondTemp)).toBe(true)

      await second.fiber.dispose()
      await first.fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('forks and workspace changes receive distinct temp capabilities while each workspace grant is reused', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const wsA = workspaceRoot()
      const wsB = workspaceRoot()
      scratch.push(wsA, wsB)
      const parent = await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsA, sessionId: SessionId('parent') })
      const child = await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsA, sessionId: SessionId('child') })
      const moved = await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: wsB, sessionId: SessionId('parent') })

      expect(flag(child.argv, '--temp')).not.toBe(flag(parent.argv, '--temp'))
      expect(flag(child.argv, '--temp-write-sid')).not.toBe(flag(parent.argv, '--temp-write-sid'))
      expect(flag(moved.argv, '--temp')).not.toBe(flag(parent.argv, '--temp'))
      expect(mockState.grants).toHaveLength(3) // two temps for A + one for B
      expect(helper.calls.map(call => call.workspace)).toEqual([wsA, wsB])

      await fiber.dispose()
      expect(helper.detached.sort()).toEqual([wsA, wsB].sort())
    } finally {
      cleanup()
    }
  })

  it('a failed workspace grant rejects the confinement, creates no temp capability, and does not block the next try', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      helper.failure = new Error('workspace grant exploded')
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('workspace-fail'),
      })).rejects.toThrow('workspace grant exploded')
      expect(mockState.grants).toHaveLength(0)

      helper.failure = undefined
      await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('workspace-fail') })
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'grant'])
      expect(mockState.grants).toHaveLength(1)
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('rejects a workspace containing the ambient temp root before any ACL mutation', async () => {
    const { sandbox, helper } = await setup()
    await expect(sandbox.confine(['true'], {
      mode: 'workspace-write', workspaceRoot: realpathSync.native(tmpdir()), sessionId: SessionId('overlap'),
    })).rejects.toThrow(/temp root must be outside the workspace/u)
    expect(mockState.grants).toHaveLength(0)
    expect(helper.calls).toHaveLength(0)
  })

  it('temp grant creation/add failures remove the random directory; cleanup failures aggregate', async () => {
    try {
      const { sandbox } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)

      mockState.createTempFailure = new Error('temp SID creation exploded')
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('create-fail'),
      })).rejects.toThrow('temp SID creation exploded')
      expect(mockState.grants).toHaveLength(0) // the random temp was removed

      mockState.createTempFailure = undefined
      mockState.addFailure = new Error('temp add exploded')
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('add-fail'),
      })).rejects.toThrow('temp add exploded')
      const failedTempGrant = mockState.grants.at(-1)
      expect(failedTempGrant?.disposed).toBe(true)
      expect(failedTempGrant?.added).toHaveLength(1)
      expect(existsSync(failedTempGrant?.added[0]?.path ?? '')).toBe(false)

      sandbox.internals.rmTempDir = () => { throw new Error('temp rm exploded') }
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('rm-fail'),
      })).rejects.toThrow(/temp grant materialization failed and its cleanup also failed/u)
      delete sandbox.internals.rmTempDir

      mockState.disposeFailure = new Error('temp cleanup exploded')
      await expect(sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('aggregate-fail'),
      })).rejects.toThrow(/temp grant materialization failed and its cleanup also failed/u)
    } finally {
      cleanup()
    }
  })

  it('agentless calls pass a temp root and no capabilities; the runner owns the private child lifecycle and holds a lease', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const confined = await sandbox.confine(['pwsh', '/Command', 'x'], { mode: 'workspace-write', workspaceRoot: '/ws' })
      expect(confined.argv).toEqual([
        'node', 'windows-acl-runner.js',
        '--workspace', '/ws',
        '--temp', tmpdir(),
        '--mode', 'workspace-write',
        '--lease', LEASE_DIR,
        '--',
        'pwsh', '/Command', 'x',
      ])
      expect(mockState.grants).toHaveLength(0)
      expect(helper.calls).toHaveLength(0)
      await fiber.dispose()
      // The runner granted the workspace itself; teardown takes it back too.
      expect(helper.detached).toEqual(['/ws'])
    } finally {
      cleanup()
    }
  })

  it('provider teardown reports temp grant and directory cleanup failures without aborting teardown', async () => {
    try {
      const { ctx, sandbox, fiber, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const confined = await sandbox.confine(['true'], {
        mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('dispose'),
      })
      const tempDir = flag(confined.argv, '--temp') ?? ''
      mockState.disposeFailure = new Error('revoke exploded')
      sandbox.internals.rmTempDir = () => { throw new Error('rm exploded') }
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)

      await fiber.dispose()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('cleanup completed with 2 failure(s)'))
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'revoke exploded' }))
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ message: 'rm exploded' }))
      expect(existsSync(tempDir)).toBe(true) // injected removal failed; test cleanup reclaims it
      expect(helper.detached).toEqual([ws])
    } finally {
      cleanup()
    }
  })

  it('takes an idle workspace grant back once no live runner holds a lease, and grants it again on the next command', async () => {
    try {
      const { sandbox, fiber, clock, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('idle') }
      await sandbox.confine(['true'], policy)

      clock.now += 29_000
      await sandbox.revokeIdleGrants()
      expect(helper.calls.map(call => call.command)).toEqual(['grant'])

      // A runner still holds a lease (a long command or a background job).
      mkdirSync(LEASE_DIR, { recursive: true })
      writeFileSync(join(LEASE_DIR, '4242'), '')
      helper.alive.add(4242)
      clock.now += 10_000
      await sandbox.revokeIdleGrants()
      expect(helper.calls.map(call => call.command)).toEqual(['grant'])

      // Its runner died without removing the lease: the dead pid no longer counts.
      helper.alive.delete(4242)
      await sandbox.revokeIdleGrants()
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'revoke'])
      expect(existsSync(join(LEASE_DIR, '4242'))).toBe(false)
      expect(helper.granted.has(ws)).toBe(false)

      await sandbox.confine(['true'], policy)
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'revoke', 'grant'])
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('a command that arrives while a revoke is queued keeps its grant; one that arrives during the revoke waits and grants again', async () => {
    try {
      const { sandbox, fiber, clock, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('race') }
      await sandbox.confine(['true'], policy)

      // Queued: the sweep's own check inside the queue sees the fresh use.
      clock.now += 60_000
      const sweep = sandbox.revokeIdleGrants()
      const confined = sandbox.confine(['true'], policy)
      await Promise.all([sweep, confined])
      expect(helper.calls.map(call => call.command)).toEqual(['grant'])

      // In flight: the command waits for the revoke, then the grant is made again.
      clock.now += 60_000
      let release!: () => void
      helper.gate = new Promise((resolve) => { release = resolve })
      const revoking = sandbox.revokeIdleGrants()
      await vi.waitFor(() => { expect(helper.calls.at(-1)?.command).toBe('revoke') })
      helper.gate = undefined
      const waiting = sandbox.confine(['true'], policy)
      release()
      await Promise.all([revoking, waiting])
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'revoke', 'grant'])
      expect(helper.granted.has(ws)).toBe(true)
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('grants again when something outside the provider took the workspace grant away', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const ws = workspaceRoot()
      scratch.push(ws)
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('repair') }
      await sandbox.confine(['true'], policy)
      helper.granted.delete(ws) // e.g. the desktop's "clean sandbox marks" on this folder
      await sandbox.confine(['true'], policy)
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'grant'])
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('cleans the registered workspaces that still carry marks, skipping clean, missing, and granted ones', async () => {
    try {
      const { sandbox, fiber, helper } = await setup()
      const marked = workspaceRoot()
      const clean = workspaceRoot()
      const inUse = workspaceRoot()
      scratch.push(marked, clean, inUse)
      mkdirSync(join(marked, 'child', '.git'), { recursive: true })
      helper.marked.add(marked)
      await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: inUse, sessionId: SessionId('in-use') })

      await sandbox.purgeRegisteredWorkspaces({ list: () => [marked, clean, inUse, join(clean, 'gone')].map(path => ({ path })) })
      expect(helper.calls).toEqual([
        { command: 'grant', workspace: inUse, readOnly: [] },
        { command: 'purge', workspace: marked, readOnly: [join(marked, 'child', '.git')] },
      ])
      expect(helper.marked.has(marked)).toBe(false)
      await fiber.dispose()
    } finally {
      cleanup()
    }
  })

  it('reads the registry structurally: anything that is not a list of { path } cleans nothing', async () => {
    const { sandbox, fiber, helper } = await setup()
    try {
      const marked = workspaceRoot()
      scratch.push(marked)
      helper.marked.add(marked)
      for (const registry of [undefined, null, {}, { list: 'no' }, { list: () => 'no' }, { list: () => [null, 1, { path: 7 }, { name: marked }] }]) {
        await sandbox.purgeRegisteredWorkspaces(registry)
      }
      expect(helper.calls).toEqual([])
    } finally { await fiber.dispose(); cleanup() }
  })

  it('logs a failed startup cleanup or idle revoke and keeps going', async () => {
    const { ctx, sandbox, fiber, clock, helper } = await setup()
    try {
      const marked = workspaceRoot()
      const granted = workspaceRoot()
      scratch.push(marked, granted)
      await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: granted, sessionId: SessionId('log') })
      helper.marked.add(marked)
      helper.failure = new Error('helper exploded')
      const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
      await sandbox.purgeRegisteredWorkspaces({ list: () => [{ path: marked }] })
      clock.now += 60_000
      await sandbox.revokeIdleGrants()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`cleaning the sandbox marks on ${marked} failed`))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`taking back the windows-acl grant on ${granted} failed`))
      // The grant still counts as standing, so the next sweep tries again.
      helper.failure = undefined
      await sandbox.revokeIdleGrants()
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'purge', 'revoke', 'revoke'])
    } finally { await fiber.dispose(); cleanup() }
  })

  it('runs one sweep at a time', async () => {
    const { sandbox, fiber, clock, helper } = await setup()
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('once') })
      clock.now += 60_000
      await Promise.all([sandbox.revokeIdleGrants(), sandbox.revokeIdleGrants()])
      expect(helper.calls.map(call => call.command)).toEqual(['grant', 'revoke'])
    } finally { await fiber.dispose(); cleanup() }
  })

  it('cleans a chosen folder, or the ancestor its marks are inherited from; refuses while a command runs there', async () => {
    const { sandbox, fiber, helper } = await setup()
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      const inner = join(ws, 'src', 'deep')
      mkdirSync(inner, { recursive: true })

      expect(await sandbox.cleanWorkspaceMarks(inner)).toEqual({ status: 'clean', root: inner })
      expect(helper.calls).toEqual([])

      helper.marked.add(ws)
      mkdirSync(LEASE_DIR, { recursive: true })
      writeFileSync(join(LEASE_DIR, '77'), '')
      helper.alive.add(77)
      expect(await sandbox.cleanWorkspaceMarks(inner)).toEqual({ status: 'busy', root: ws })
      expect(helper.calls).toEqual([])

      helper.alive.delete(77)
      expect(await sandbox.cleanWorkspaceMarks(inner)).toEqual({ status: 'cleaned', root: ws })
      expect(helper.calls).toEqual([{ command: 'purge', workspace: ws, readOnly: [] }])

      // A grant the provider made is dropped with the marks and made again on the next command.
      const policy: SandboxPolicy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('clean') }
      await sandbox.confine(['true'], policy)
      expect(await sandbox.cleanWorkspaceMarks(ws)).toEqual({ status: 'cleaned', root: ws })
      await sandbox.confine(['true'], policy)
      expect(helper.calls.map(call => call.command)).toEqual(['purge', 'grant', 'purge', 'grant'])
    } finally { await fiber.dispose(); cleanup() }
  })

  it('reports cleaning as unsupported off Windows and under an operator runner', async () => {
    const { sandbox, fiber } = await setup()
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      sandbox.internals.platform = 'linux'
      expect(await sandbox.cleanWorkspaceMarks(ws)).toEqual({ status: 'unsupported', root: ws })
    } finally { await fiber.dispose(); cleanup() }
    const ctx = new Context()
    const operator = await ctx.plugin(LocalSandboxProvider, { runnerCommand: ['runner'], runnerFailureSignatures: ['runner: '] })
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      const provider = ctx.sandbox as LocalSandboxProvider
      provider.internals = { platform: 'win32' }
      expect(await provider.cleanWorkspaceMarks(ws)).toEqual({ status: 'unsupported', root: ws })
    } finally { await operator.dispose(); cleanup() }
  })
})

describe('windows-acl helper process and probes (LocalSandboxProvider, real paths)', () => {
  const scratch: string[] = []
  beforeEach(() => {
    mockState.inspected = new Map()
    mockState.grants = []
    mockState.addFailure = undefined
    mockState.createTempFailure = undefined
    mockState.disposeFailure = undefined
  })
  afterEach(() => {
    rmSync(LEASE_DIR, { recursive: true, force: true })
    for (const grant of mockState.grants) for (const added of grant.added) rmSync(added.path, { recursive: true, force: true })
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * A fake built `lib/acl-helper.js`: appends its argv to a log and fails
   * `purge` the way the real entry reports an error.
   */
  function fakeHelper(): { entry: string; calls: () => string[][] } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fake-acl-helper-'))
    scratch.push(dir)
    const entry = join(dir, 'acl-helper.cjs')
    const log = join(dir, 'calls.log')
    writeFileSync(entry, [
      'const { appendFileSync } = require(\'node:fs\')',
      'const args = process.argv.slice(2)',
      `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n')`,
      'if (args[0] === \'purge\') { process.stderr.write(\'acl-helper: purge exploded\\n\'); process.exitCode = 1 }',
    ].join('\n'))
    return {
      entry,
      calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [],
    }
  }

  it('grants through the built helper entry, probes in process, and hands the revoke to a detached helper', async () => {
    const helper = fakeHelper()
    const { sandbox, fiber } = await setup({ helperEntry: helper.entry })
    const ws = workspaceRoot()
    scratch.push(ws)
    mkdirSync(join(ws, 'child', '.git'), { recursive: true })
    await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('real') })
    expect(helper.calls()).toEqual([['grant', '--workspace', ws, '--read-only', join(ws, 'child', '.git')]])

    // The probe says the grant stands: no second helper run.
    mockState.inspected.set(ws, { grant: true, marks: true })
    await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: ws, sessionId: SessionId('real') })
    expect(helper.calls()).toHaveLength(1)

    await fiber.dispose()
    await vi.waitFor(() => { expect(helper.calls()).toHaveLength(2) }, { timeout: 10_000 })
    expect(helper.calls()[1]).toEqual(['revoke', '--workspace', ws])
  })

  it('rejects with the helper\'s stderr when it fails', async () => {
    const helper = fakeHelper()
    const { sandbox, fiber } = await setup({ helperEntry: helper.entry })
    try {
      const ws = workspaceRoot()
      scratch.push(ws)
      mockState.inspected.set(ws, { grant: false, marks: true })
      await expect(sandbox.cleanWorkspaceMarks(ws)).rejects.toThrow(`sandbox-local: acl-helper purge failed for ${ws}: acl-helper: purge exploded`)
    } finally { await fiber.dispose() }
  })

  it('falls back to the helper source through tsx when the built entry is absent', async () => {
    const { sandbox, fiber } = await setup({ helperEntry: join(tmpdir(), 'dsh-absent-acl-helper', 'acl-helper.js') })
    try {
      const ws = workspaceRoot()
      mockState.inspected.set(ws, { grant: false, marks: true })
      // The folder disappears before the queued purge runs: the real source
      // entry refuses it the same way on every platform.
      const cleaning = sandbox.cleanWorkspaceMarks(ws)
      rmSync(ws, { recursive: true, force: true })
      await expect(cleaning).rejects.toThrow(`acl-helper: --workspace is not an existing directory: ${ws}`)
    } finally { await fiber.dispose() }
  }, 60_000)

  it('counts a lease as live only while its runner pid runs', async () => {
    const helper = fakeHelper()
    const { sandbox, fiber, clock } = await setup({ helperEntry: helper.entry })
    try {
      await sandbox.confine(['true'], { mode: 'workspace-write', workspaceRoot: '/ws' })
      mkdirSync(LEASE_DIR, { recursive: true })
      writeFileSync(join(LEASE_DIR, String(process.pid)), '')
      writeFileSync(join(LEASE_DIR, 'not-a-pid'), '')
      clock.now += 60_000
      await sandbox.revokeIdleGrants()
      expect(helper.calls()).toEqual([])
      expect(existsSync(join(LEASE_DIR, 'not-a-pid'))).toBe(false)
      rmSync(join(LEASE_DIR, String(process.pid)))
      writeFileSync(join(LEASE_DIR, '2147483646'), '') // no such process
      await sandbox.revokeIdleGrants()
      expect(helper.calls()).toEqual([['revoke', '--workspace', '/ws']])
    } finally { await fiber.dispose() }
  })
})
