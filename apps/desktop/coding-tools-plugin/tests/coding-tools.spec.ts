/**
 * coding-tools 插件测试：11 个工具的注册面、execute 经 capability 走通、
 * 审批/只读门禁的行为断言。fake ctx（零网络、零 git 进程）。
 * @module @see-sol-lab/deepseekgui-coding-tools/tests
 */

import { describe, expect, it, vi } from 'vitest'
import { apply, cwdOf } from '../src/index.ts'

// The tools refuse a working directory that does not exist; the fake repos
// here are synthetic paths, so the probe answers for them.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, existsSync: (path: unknown) => /^[CX]:\\/u.test(String(path)) || actual.existsSync(path as string) }
})

type Def = {
  name: string
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  output?: { render?: (args: unknown, value: unknown) => unknown }
}

const REGISTERED_NAMES = [
  'git_status', 'git_diff', 'git_stage', 'git_unstage', 'git_revert',
  'git_commit', 'git_push_preview', 'git_push',
  'pr_availability', 'pr_existing', 'pr_create',
]

function execWith(overrides: Record<string, unknown> = {}) {
  return {
    agent: { session: { header: { cwd: 'C:\\default-repo' } } },
    callId: 'call-1',
    signal: new AbortController().signal,
    ...overrides,
  }
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const defs: Def[] = []
  const git = {
    repoIdentity: vi.fn(async (cwd: string) => ({ root: cwd, gitDir: `${cwd}/.git`, bare: false })),
    status: vi.fn(async () => ({ clean: true, head: { kind: 'branch', name: 'main' }, entries: [] })),
    diff: vi.fn(async () => ({ files: [] })),
    stageFile: vi.fn(async () => {}),
    unstageFile: vi.fn(async () => {}),
    revertFile: vi.fn(async () => {}),
    stagedTree: vi.fn(async () => 'tree-1'),
    commit: vi.fn(async () => ({ sha: 'sha-1', treeMatchesExpected: true })),
    pushPreview: vi.fn(async () => ({ sourceOid: 'sha-2', remote: { name: 'origin', fetchUrl: 'https://example.invalid/repo.git', pushUrl: 'https://example.invalid/push.git' }, localBranch: 'main', remoteBranch: 'main', aheadCommits: [], remoteRefExists: true })),
    push: vi.fn(async () => ({ remote: 'origin', remoteBranch: 'main', pushedSha: 'sha-2' })),
  }
  const pullRequest = {
    availability: vi.fn(async () => ({ available: false, reason: 'missing-gh' })),
    existing: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ url: 'https://example.invalid/pr/1', number: 1 })),
  }
  const approval = { request: vi.fn(async () => 'allowed-once') }
  const sandboxPolicy = { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: 'C:\\repo' })) }
  const ctx = {
    tools: { register: (def: Def) => { defs.push(def) } },
    git,
    pullRequest,
    approval,
    sandboxPolicy,
  }
  apply(ctx as never)
  const def = (name: string): Def => {
    const found = defs.find(d => d.name === name)
    if (found === undefined) throw new Error(`tool ${name} not registered`)
    return found
  }
  return { defs, def, git, pullRequest, approval, sandboxPolicy }
}

describe('coding-tools registration', () => {
  it('registers the eleven coding tools', () => {
    const { defs } = makeCtx()
    expect(defs.map(d => d.name).sort()).toEqual([...REGISTERED_NAMES].sort())
  })
})

describe('read tools', () => {
  it('git_status calls the git capability with the explicit cwd', async () => {
    const { def, git } = makeCtx()
    const value = await def('git_status').execute({ cwd: 'C:\\repo' }, execWith())
    expect(git.status).toHaveBeenCalledWith('C:\\repo')
    expect(value).toMatchObject({ clean: true })
  })

  it('git_status falls back to the agent session cwd', async () => {
    const { def, git } = makeCtx()
    const agent = { session: { header: { cwd: 'C:\\session-repo' } } }
    await def('git_status').execute({}, execWith({ agent }))
    expect(git.status).toHaveBeenCalledWith('C:\\session-repo')
  })

  it('cwdOf resolves a relative cwd against the session and refuses a missing directory by name', () => {
    const exec = execWith({ agent: { session: { header: { cwd: 'C:\\session-repo' } } } }) as never
    const exists = (path: string) => path === 'C:\\session-repo\\novel'
    expect(cwdOf('novel', exec, exists)).toBe('C:\\session-repo\\novel')
    expect(cwdOf(undefined, exec, () => true)).toBe('C:\\session-repo')
    expect(() => cwdOf('missing', exec, exists)).toThrow('working directory does not exist: C:\\session-repo\\missing')
    expect(() => cwdOf('D:\\elsewhere', exec, exists)).toThrow('working directory does not exist: D:\\elsewhere')
  })

  it('git_diff passes scope/path/wantPatch to the capability', async () => {
    const { def, git } = makeCtx()
    await def('git_diff').execute({ cwd: 'C:\\repo', scope: 'staged', path: 'a.ts', wantPatch: true }, execWith())
    expect(git.diff).toHaveBeenCalledWith('C:\\repo', 'staged', 'a.ts', true, 512 * 1024)
  })

  it('renderers produce model-facing text without throwing on capability values', () => {
    const { def } = makeCtx()
    const rendered = def('git_status').output?.render?.(
      {},
      { clean: true, head: { kind: 'branch', name: 'main' }, entries: [] },
    ) as [{ type: 'text'; text: string }] | undefined
    expect(rendered?.[0]?.text).toContain('clean on main')
  })
})

describe('write gates', () => {
  it('rejects a repository outside the session workspace before a write or approval', async () => {
    const { def, git, approval } = makeCtx()
    await expect(def('git_stage').execute({ cwd: 'X:\\outside', path: '.' }, execWith())).rejects.toThrow('outside the writable workspace')
    expect(git.stageFile).not.toHaveBeenCalled()
    expect(approval.request).not.toHaveBeenCalled()
  })

  it('checks the repository root even when cwd is a permitted subdirectory', async () => {
    const { def, git } = makeCtx()
    git.repoIdentity.mockResolvedValue({ root: 'C:\\', gitDir: 'C:\\.git', bare: false })
    await expect(def('git_stage').execute({ cwd: 'C:\\repo', path: '.' }, execWith())).rejects.toThrow('outside the writable workspace')
    expect(git.stageFile).not.toHaveBeenCalled()
  })

  it('captures the commit tree before approval', async () => {
    const { def, git, approval } = makeCtx()
    approval.request.mockImplementation(async () => {
      git.stagedTree.mockResolvedValue('tree-changed')
      return 'allowed-once'
    })
    await def('git_commit').execute({ cwd: 'C:\\repo', message: 'reviewed' }, execWith())
    expect(git.commit).toHaveBeenCalledWith('C:\\repo', 'reviewed', 'tree-1')
  })
  it('stage executes without approval in a writable session and returns fresh status', async () => {
    const { def, git, approval } = makeCtx()
    const value = await def('git_stage').execute({ cwd: 'C:\\repo', path: 'a.ts' }, execWith())
    expect(git.stageFile).toHaveBeenCalledWith('C:\\repo', 'a.ts')
    expect(approval.request).not.toHaveBeenCalled()
    expect(value).toMatchObject({ clean: true })
  })

  it('stage refuses in a read-only session', async () => {
    const { git } = makeCtx()
    const defs2: Def[] = []
    const ctx2 = {
      tools: { register: (d: Def) => { defs2.push(d) } },
      git,
      pullRequest: { availability: vi.fn(), existing: vi.fn(), create: vi.fn() },
      approval: { request: vi.fn() },
      sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'read-only' })) },
    }
    apply(ctx2 as never)
    const stage = defs2.find(d => d.name === 'git_stage')
    await expect(stage?.execute({ cwd: 'C:\\repo', path: 'a.ts' }, execWith()))
      .rejects.toThrow('read-only')
    expect(git.stageFile).not.toHaveBeenCalled()
  })

  it('commit requests approval with the message and then commits the staged tree', async () => {
    const { def, git, approval } = makeCtx()
    const value = await def('git_commit').execute({ cwd: 'C:\\repo', message: 'fix: p4' }, execWith())
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'git_commit',
      reason: expect.stringContaining('fix: p4'),
    }))
    expect(git.stagedTree).toHaveBeenCalledWith('C:\\repo')
    expect(git.commit).toHaveBeenCalledWith('C:\\repo', 'fix: p4', 'tree-1')
    expect(value).toMatchObject({ sha: 'sha-1' })
  })

  it('commit refusal (user rejected) throws and never touches git', async () => {
    const { def, git } = makeCtx()
    const approval = { request: vi.fn(async () => 'rejected') }
    const ctx = {
      tools: { register: (d: Def) => { void d } },
      git,
      pullRequest: { availability: vi.fn(), existing: vi.fn(), create: vi.fn() },
      approval,
      sandboxPolicy: { resolve: vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: 'C:\\repo' })) },
    }
    const defs2: Def[] = []
    const ctx2 = { ...ctx, tools: { register: (d: Def) => { defs2.push(d) } } }
    apply(ctx2 as never)
    const commit = defs2.find(d => d.name === 'git_commit')
    await expect(commit?.execute({ cwd: 'C:\\repo', message: 'fix: p4' }, execWith()))
      .rejects.toThrow('did not approve')
    expect(git.commit).not.toHaveBeenCalled()
  })

  it('push requests approval before the external write', async () => {
    const { def, git, approval } = makeCtx()
    const value = await def('git_push').execute({ cwd: 'C:\\repo', remote: 'origin', localBranch: 'main', remoteBranch: 'main' }, execWith())
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'git_push' }))
    expect(git.pushPreview).toHaveBeenCalledWith('C:\\repo', 'origin', 'main', 'main')
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('https://example.invalid/push.git') }))
    expect(git.push).toHaveBeenCalledWith('C:\\repo', 'origin', 'main', 'main', { sourceOid: 'sha-2', pushUrl: 'https://example.invalid/push.git' })
    expect(value).toMatchObject({ pushedSha: 'sha-2' })
  })
})

describe('pull-request tools', () => {
  it('pr_create requests approval and returns the created reference', async () => {
    const { def, pullRequest, approval } = makeCtx()
    const value = await def('pr_create').execute({ cwd: 'C:\\repo', title: 'P4', body: 'b', base: 'main', head: 'p4' }, execWith())
    expect(approval.request).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'pr_create',
      reason: expect.stringContaining('P4'),
    }))
    expect(pullRequest.create).toHaveBeenCalledWith('C:\\repo', {
      title: 'P4', body: 'b', base: 'main', head: 'p4', draft: false,
    })
    expect(value).toMatchObject({ number: 1 })
  })

  it('pr_existing resolves found:false when no PR exists', async () => {
    const { def, pullRequest } = makeCtx()
    const value = await def('pr_existing').execute({ cwd: 'C:\\repo', head: 'p4' }, execWith())
    expect(pullRequest.existing).toHaveBeenCalledWith('C:\\repo', 'p4')
    expect(value).toEqual({ found: false })
  })
})
