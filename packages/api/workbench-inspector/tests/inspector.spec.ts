import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalGit from '@deepseek-ai/dsh-git-local'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import WorkbenchInspector from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
const sid = 'inspection-session' as SessionId
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function setup(maxTextBytes = 1024) {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-live-inspection-')); roots.push(temporary)
  const root = join(temporary, 'workspace'); mkdirSync(root)
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(LocalGit)
  const dispose = vi.fn()
  const observe = vi.fn(async () => ({ header: { cwd: root }, [Symbol.dispose]: dispose }))
  ctx.provide('sessionQuery', { observeSession: observe } as never)
  ctx.provide('typert', {} as never)
  const deleteSession = vi.fn(async () => {})
  ctx.provide('sessionController', { deleteSession } as never)
  await ctx.plugin(WorkbenchInspector, { logLimit: 2, maxTextBytes })
  const api = ctx.get('workbenchInspector')
  if (api === undefined) throw new Error('Workbench inspector did not mount')
  return { api, ctx, root, temporary, observe, dispose, deleteSession, signal: new AbortController().signal }
}
it('requires desktop authorization before delegating deletion to the Session owner', async () => {
  const { api, ctx, observe, deleteSession } = await setup()
  const keys = generateKeyPairSync('ed25519')
  vi.stubEnv('DEEPSEEKGUI_SESSION_DELETE_PUBLIC_KEY', keys.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  vi.stubEnv('DSH_HOME', '/test-home')
  try {
    expect(ctx.bail('session/deletion-authorize', sid, 'wrong-token')).not.toBe(true)
    expect(deleteSession).not.toHaveBeenCalled()
    const signature = sign(null, Buffer.from(`/test-home\0${sid}`), keys.privateKey).toString('base64')
    expect(ctx.bail('session/deletion-authorize', sid, signature)).toBe(true)
    expect(ctx.bail('session/deletion-authorize', 'other-session' as SessionId, signature)).not.toBe(true)
    await api.deleteSession(sid, signature)
    expect(deleteSession).toHaveBeenCalledWith(sid, signature)
    expect(observe).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs()
  }
})
it('re-reads edited text without a model', async () => {
  const { api, root, signal, observe, dispose } = await setup()
  writeFileSync(join(root, 'a.txt'), 'before')
  expect((await api.text(sid, 'a.txt', false, signal)).text).toBe('before')
  writeFileSync(join(root, 'a.txt'), 'after')
  expect((await api.text(sid, 'a.txt', false, signal)).text).toBe('after')
  expect(observe).toHaveBeenCalledWith(sid, { signal, projectionMode: 'none' })
  expect(dispose).toHaveBeenCalledTimes(observe.mock.calls.length)
})
it('reads the newest assistant reply and whether its turn has ended (#15 feedback triage)', async () => {
  const { api, root, signal, observe } = await setup()
  const assistant = (seq: number, text: string) => ({
    seq, type: 'assistant/message', time: 0,
    data: { turn: 1, step: 1, message: { id: `m${String(seq)}`, role: 'assistant', content: [{ type: 'text', text }] }, stream: [] },
  })
  // No reply yet: nothing to read, nothing complete.
  observe.mockResolvedValueOnce({ header: { cwd: root }, events: [], [Symbol.dispose]: () => {} } as never)
  expect(await api.lastReply(sid, signal)).toEqual({ text: null, complete: false })
  // A reply still streaming: text is there, the turn has not ended.
  observe.mockResolvedValueOnce({ header: { cwd: root }, events: [assistant(3, 'partial')], [Symbol.dispose]: () => {} } as never)
  expect(await api.lastReply(sid, signal)).toEqual({ text: 'partial', complete: false })
  // Turn ended after the reply: complete, and the newest message wins.
  observe.mockResolvedValueOnce({
    header: { cwd: root },
    events: [assistant(3, 'first'), { seq: 4, type: 'turn/end', time: 0, data: { turn: 1, reason: 'completed' } }, assistant(6, 'second'), { seq: 7, type: 'turn/end', time: 0, data: { turn: 2, reason: 'completed' } }],
    [Symbol.dispose]: () => {},
  } as never)
  expect(await api.lastReply(sid, signal)).toEqual({ text: 'second', complete: true })
})
it('reads the project memory file by its folder-prefixed name and reports AGENTS.md presence', async () => {
  const { api, root, signal } = await setup()
  expect(await api.memory(sid, signal)).toEqual({ cwd: root, fileName: 'workspace.memory.md', text: null, agents: false })
  writeFileSync(join(root, 'workspace.memory.md'), '# notes\n- likes tabs\n')
  writeFileSync(join(root, 'AGENTS.md'), '# rules\n')
  expect(await api.memory(sid, signal)).toEqual({ cwd: root, fileName: 'workspace.memory.md', text: '# notes\n- likes tabs\n', agents: true })
})

it('rejects traversal and outside symlink targets', async () => {
  const { api, root, temporary, signal } = await setup()
  const outside = join(temporary, 'outside'); mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'synthetic')
  await expect(api.text(sid, '../outside/secret.txt', false, signal)).rejects.toThrow('outside')
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(api.text(sid, 'escape/secret.txt', false, signal)).rejects.toThrow('outside')
})
it('reports a deleted workspace folder on every read surface instead of a Git failure', async () => {
  const { api, root, signal } = await setup()
  rmSync(root, { recursive: true, force: true })
  const missing = `workspace directory does not exist: ${root}`
  await expect(api.memory(sid, signal)).rejects.toThrow(missing)
  await expect(api.text(sid, 'a.txt', false, signal)).rejects.toThrow(missing)
  await expect(api.status(sid, signal)).rejects.toThrow(missing)
  await expect(api.overview(sid, signal)).rejects.toThrow(missing)
})
it('reports binary and oversized text without clipping', async () => {
  const { api, root, signal } = await setup(6)
  writeFileSync(join(root, 'large.txt'), '汉字文')
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
  await expect(api.text(sid, 'large.txt', false, signal)).rejects.toThrow('limit')
  await expect(api.text(sid, 'binary.bin', false, signal)).rejects.toThrow()
  await expect(api.status(sid, AbortSignal.abort())).rejects.toThrow()
  await expect(api.overview(sid, AbortSignal.abort())).rejects.toThrow()
})
it('reads current Git status and staged patches without writing', async () => {
  const { api, root, signal } = await setup()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q')
  writeFileSync(join(root, 'a.txt'), 'first\n')
  expect((await api.status(sid, signal)).status.entries[0]?.kind).toBe('untracked')
  git('add', 'a.txt')
  git('config', 'diff.external', 'definitely-not-an-installed-diff-command')
  git('config', 'diff.audit.textconv', 'definitely-not-an-installed-textconv-command')
  writeFileSync(join(root, '.gitattributes'), 'a.txt diff=audit\n')
  const before = git('write-tree').trim()
  expect((await api.diff(sid, 'staged', 'a.txt', signal)).patch).toContain('+first')
  expect(git('write-tree').trim()).toBe(before)
  expect((await api.text(sid, 'a.txt', true, signal)).text).toBe('first\n')
})
it('reads the repository overview: status, remotes, newest commits, and work trees with their changes', async () => {
  const { api, root, temporary, signal } = await setup()
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'a.txt'), 'first\n')
  git('add', 'a.txt'); git('commit', '-q', '-m', 'one')
  writeFileSync(join(root, 'a.txt'), 'second\n')
  git('commit', '-q', '-am', 'two')
  writeFileSync(join(root, 'a.txt'), 'third\n')
  git('commit', '-q', '-am', 'three')
  git('remote', 'add', 'origin', 'https://example.invalid/synthetic.git')
  const second = join(temporary, 'second-tree')
  git('worktree', 'add', '-q', '-b', 'feature', second)
  writeFileSync(join(second, 'b.txt'), 'in the other tree\n')
  writeFileSync(join(root, 'c.txt'), 'in the main tree\n')

  const overview = await api.overview(sid, signal)
  expect(overview.status.head).toMatchObject({ kind: 'branch', name: 'main' })
  expect(overview.remotes.map(remote => remote.name)).toEqual(['origin'])
  // logLimit: 2 bounds the history newest first.
  expect(overview.commits.map(commit => commit.subject)).toEqual(['three', 'two'])
  expect(overview.worktrees).toHaveLength(2)
  const main = overview.worktrees.find(tree => tree.current)
  expect(main).toMatchObject({ branch: 'main', changedPaths: ['c.txt'] })
  const feature = overview.worktrees.find(tree => !tree.current)
  expect(feature).toMatchObject({ branch: 'feature', changedPaths: ['b.txt'] })
})
