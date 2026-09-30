// @vitest-environment jsdom
/**
 * The four DeepSeekGUI conversation views (D5, 2026-09-06): each reads
 * through the mounted Remote namespace, offers only harmless desktop
 * actions (reveal / copy path / open workspace), and never a write.
 * @module @see-sol-lab/deepseekgui-workbench/tests/views
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChangesView } from '../src/client/views/ChangesView.tsx'
import { GitView } from '../src/client/views/GitView.tsx'
import { overlappingPaths } from '../src/client/views/WorktreeView.tsx'
import { MemoryView } from '../src/client/views/MemoryView.tsx'
import type { InspectorRemote } from '../src/client/views/shared.tsx'
import type { ControlBridgeClient } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales-inspector.ts'
import { zh as memoryZh } from '../src/client/locales-memory.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const sessionId = 'test-session' as SessionId
const ok = <T,>(value: T) => ({ ok: true as const, value })
const failed = (message: string) => ({ ok: false as const, error: new Error(message) as never })
const cleanStatus = { clean: true, head: { kind: 'branch' as const, name: 'main' }, entries: [] }

/** A fake of the mounted namespace: every method resolves the Remote result shape. */
function fakeInspector(over: Partial<Record<keyof InspectorRemote, (...args: never[]) => unknown>> = {}): InspectorRemote {
  return {
    text: vi.fn(async () => ok({ path: 'a.txt', text: '' })),
    status: vi.fn(async () => ok({ root: 'E:/repo', status: cleanStatus })),
    diff: vi.fn(async () => ok({ files: [] })),
    overview: vi.fn(async () => ok({ root: 'E:/repo', status: cleanStatus, remotes: [], commits: [], worktrees: [] })),
    memory: vi.fn(async () => ok({ cwd: 'E:\\repo', fileName: 'repo.memory.md', text: null, agents: false })),
    ...over,
  } as unknown as InspectorRemote
}
const bridgeStub = (): ControlBridgeClient => ({ model: vi.fn(), run: vi.fn(async () => ({} as never)) })
const submitInstruction = vi.fn(async () => true)
const noChat = (() => undefined) as never

const tm = ((key: keyof typeof memoryZh, params?: Record<string, string | number>) => {
  let text: string = memoryZh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never

const memoryProps = () => ({ tm })

describe('ChangesView', () => {
  it('groups changed paths, opens a patch, and offers only reveal / copy', async () => {
    const inspector = fakeInspector({
      status: vi.fn(async () => ok({ root: 'E:/repo', status: { clean: false, head: { kind: 'branch', name: 'main' }, entries: [
        { kind: 'staged', path: 'src/a.ts', x: 'M', y: '.' },
        { kind: 'untracked', path: 'notes.txt', x: '?', y: '?' },
      ] } })),
      diff: vi.fn(async () => ok({ files: [], patch: '+added line' })),
    })
    const bridge = bridgeStub()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } })
    render(<ChangesView inspector={inspector} bridge={bridge} sessionId={sessionId} submitInstruction={submitInstruction} t={t} />)
    expect(await screen.findByText(/将提交/)).toBeTruthy()
    expect(screen.getByText(/新文件/)).toBeTruthy()
    // D10: no write buttons — commit/discard/revert are conversation requests.
    expect(screen.queryByRole('button', { name: /提交|丢弃|撤销|暂存/ })).toBeNull()
    fireEvent.click(screen.getAllByText('定位')[0] as HTMLElement)
    // B6-2: the reveal carries the Git-root-joined absolute path; the row
    // keeps the Git spelling.
    expect(bridge.run).toHaveBeenCalledWith({ type: 'reveal-path', sessionId, path: 'E:/repo/src/a.ts' })
    fireEvent.click(screen.getAllByText('复制路径')[0] as HTMLElement)
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('E:/repo/src/a.ts'))
    // #4: no "open in file manager" button on the views any more.
    expect(screen.queryByText('打开资源管理器')).toBeNull()
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(await screen.findByText('+added line')).toBeTruthy()
    expect(inspector.diff).toHaveBeenCalledWith(sessionId, 'staged', 'src/a.ts', expect.any(AbortSignal))
  })

  it('says the tree is clean and hides desktop actions without the bridge', async () => {
    render(<ChangesView inspector={fakeInspector()} bridge={null} sessionId={sessionId} submitInstruction={submitInstruction} t={t} />)
    expect(await screen.findByText(zh['changes.clean'])).toBeTruthy()
    expect(screen.queryByText('打开资源管理器')).toBeNull()
  })
})

describe('GitView', () => {
  it('shows branch, remote sync, remotes, commits, and the session history; no write buttons', async () => {
    const inspector = fakeInspector({
      overview: vi.fn(async () => ok({
        root: 'E:/repo',
        status: { clean: true, head: { kind: 'branch', name: 'main' }, upstream: { ref: 'origin/main', ahead: 2, behind: 0 }, entries: [] },
        remotes: [{ name: 'origin', fetchUrl: 'https://example.invalid/r.git' }],
        commits: [{ sha: 'a'.repeat(40), subject: 'feat: one', author: '开发者', time: 1_757_000_000_000 }],
        worktrees: [],
      })),
    })
    const chat = { nodes: new Map([['n1', { kind: 'tool-call', visibility: 'visible', anchorSeq: 7, data: { root: {
      kind: 'tool-result', seq: 7, time: 3_000, callId: 'c1', call: { name: 'git_commit', argsRaw: '{}' }, callTime: 2_000,
      content: [{ type: 'text', text: 'committed abc' }], isError: false, subCalls: [],
    } } }]]) }
    const useConversation = ((select: (snapshot: unknown) => unknown) => select({ views: new Map([['chat', chat]]) })) as never
    render(
      <GitView
        inspector={inspector} bridge={null} sessionId={sessionId} submitInstruction={submitInstruction} t={t}
        useConversation={useConversation}
      />,
    )
    expect(await screen.findByText('main')).toBeTruthy()
    expect(screen.getByText(/本地比远端多 2 个提交/)).toBeTruthy()
    expect(screen.getByText('origin')).toBeTruthy()
    expect(screen.getByText('feat: one')).toBeTruthy()
    expect(screen.getByText('committed abc')).toBeTruthy()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['刷新'])
  })

  it('reports a read failure', async () => {
    const inspector = fakeInspector({ overview: vi.fn(async () => failed('not a repository')) })
    render(
      <GitView
        inspector={inspector} bridge={null} sessionId={sessionId} submitInstruction={submitInstruction} t={t}
        useConversation={noChat}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('not a repository'))
  })
})

describe('WorktreeSection inside GitView', () => {
  it('finds paths changed in more than one tree', () => {
    expect(overlappingPaths([{ changedPaths: ['a', 'b'] }, { changedPaths: ['b', 'c'] }, { changedPaths: ['c'] }])).toEqual(['b', 'c'])
  })

  it('says only the main tree exists, else lists trees with the current one and overlap warnings', async () => {
    const only = fakeInspector({ overview: vi.fn(async () => ok({ root: 'E:/repo', status: cleanStatus, remotes: [], commits: [], worktrees: [
      { path: 'E:/repo', head: 'abc', branch: 'main', detached: false, bare: false, current: true, changedPaths: [] },
    ] })) })
    const first = render(
      <GitView inspector={only} bridge={null} sessionId={sessionId} submitInstruction={submitInstruction} t={t} useConversation={noChat} />,
    )
    expect(await screen.findByText(zh['worktree.only'])).toBeTruthy()
    first.unmount()
    const two = fakeInspector({ overview: vi.fn(async () => ok({ root: 'E:/repo', status: cleanStatus, remotes: [], commits: [], worktrees: [
      { path: 'E:/repo', head: 'abc', branch: 'main', detached: false, bare: false, current: true, changedPaths: ['shared.ts'] },
      { path: 'E:/repo-feature', head: 'def', branch: 'feature', detached: false, bare: false, current: false, changedPaths: ['shared.ts', 'other.ts'] },
    ] })) })
    render(
      <GitView inspector={two} bridge={null} sessionId={sessionId} submitInstruction={submitInstruction} t={t} useConversation={noChat} />,
    )
    expect(await screen.findByText('E:/repo-feature')).toBeTruthy()
    expect(screen.getByText(zh['worktree.current'])).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('shared.ts')
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['刷新'])
  })
})

/** The Memory view for one inspector and bridge, on the fixed test session. */
function renderMemory(inspector: InspectorRemote, bridge: ControlBridgeClient | null) {
  return render(
    <MemoryView
      inspector={inspector}
      bridge={bridge}
      sessionId={sessionId}
      submitInstruction={submitInstruction}
      t={t}
      {...memoryProps()}
    />,
  )
}

describe('MemoryView', () => {
  it('in the desktop window edits the project memory in place: open / ask / generate-AGENTS, and a save that quotes the text it started from', async () => {
    const inspector = fakeInspector({
      memory: vi.fn(async () => ok({ cwd: 'E:\\repo', fileName: 'repo.memory.md', text: '# 项目记忆\n- likes `tabs`\n', agents: false })),
    })
    const bridge = bridgeStub()
    render(
      <MemoryView
        inspector={inspector}
        bridge={bridge}
        sessionId={sessionId}
        submitInstruction={submitInstruction}
        t={t}
        {...memoryProps()}
      />,
    )
    const box = await screen.findByLabelText(memoryZh['project.label']) as HTMLTextAreaElement
    expect(box.value).toBe('# 项目记忆\n- likes `tabs`\n')
    expect(inspector.memory).toHaveBeenCalledWith(sessionId, expect.any(AbortSignal))
    fireEvent.click(screen.getByText(zh['memory.open']))
    expect(bridge.run).toHaveBeenCalledWith({ type: 'open-memory', which: 'project', sessionId })
    fireEvent.click(screen.getByText(zh['memory.ask']))
    expect(submitInstruction).toHaveBeenCalledWith(zh['memory.prompt'].replace('{file}', 'repo.memory.md'))
    fireEvent.click(screen.getByText(zh['memory.createAgents']))
    expect(bridge.run).toHaveBeenCalledWith({ type: 'create-project-agents', sessionId })
    expect(await screen.findByText(zh['memory.openAgents'])).toBeTruthy()
    expect(screen.getByText(/E:\\repo\\repo\.memory\.md/)).toBeTruthy()

    const save = screen.getByText(memoryZh['project.save']) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(box, { target: { value: '# 项目记忆\n- likes `spaces`\n' } })
    fireEvent.click(save)
    expect(bridge.run).toHaveBeenCalledWith({ type: 'save-project-memory', sessionId, content: '# 项目记忆\n- likes `spaces`\n', expected: '# 项目记忆\n- likes `tabs`\n' })
    await waitFor(() => { expect(inspector.memory).toHaveBeenCalledTimes(2) })
  })

  it('a refused save says why and keeps the draft', async () => {
    const refuse = vi.fn(async () => { throw new Error('项目记忆文件已被改动，请刷新后再保存。') })
    const bridge: ControlBridgeClient = { model: vi.fn(), run: refuse }
    renderMemory(fakeInspector(), bridge)
    const box = await screen.findByLabelText(memoryZh['project.label']) as HTMLTextAreaElement
    expect(box.placeholder).toBe(memoryZh['project.placeholder'])
    fireEvent.change(box, { target: { value: 'new fact' } })
    fireEvent.click(screen.getByText(memoryZh['project.save']))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('已被改动'))
    expect(box.value).toBe('new fact')
    expect(bridge.run).toHaveBeenCalledWith({ type: 'save-project-memory', sessionId, content: 'new fact', expected: '' })
  })

  it('outside the desktop window renders the memory read-only, only the head of an oversized one', async () => {
    const text = `# big\n${'- 条目\n'.repeat(6000)}`
    const inspector = fakeInspector({
      memory: vi.fn(async () => ok({ cwd: 'E:\\repo', fileName: 'repo.memory.md', text, agents: false })),
    })
    renderMemory(inspector, null)
    expect(await screen.findByText(zh['memory.truncated'].replaceAll('{max}', '20,000'))).toBeTruthy()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(6000)
    expect(screen.queryByLabelText(memoryZh['project.label'])).toBeNull()
  })

  it('outside the desktop window shows the empty state for a missing file', async () => {
    const inspector = fakeInspector({
      memory: vi.fn(async () => ok({ cwd: 'E:\\repo', fileName: 'repo.memory.md', text: null, agents: true })),
    })
    renderMemory(inspector, null)
    expect(await screen.findByText(zh['memory.empty'])).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an oversized file is not put in the editor', async () => {
    const inspector = fakeInspector({
      memory: vi.fn(async () => ok({ cwd: 'E:\\repo', fileName: 'repo.memory.md', text: 'x'.repeat(200_001), agents: false })),
    })
    renderMemory(inspector, bridgeStub())
    expect(await screen.findByText(memoryZh['project.tooLong'].replace('{max}', '200,000'))).toBeTruthy()
    expect(screen.queryByLabelText(memoryZh['project.label'])).toBeNull()
  })

  it('names the deleted workspace folder and points at the recovery steps', async () => {
    const inspector = fakeInspector({
      memory: vi.fn(async () => failed('workspace directory does not exist: E:\\gone')),
    })
    renderMemory(inspector, null)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('E:\\gone'))
    expect(screen.getByText(zh['memory.missingHint'])).toBeTruthy()
  })
})
