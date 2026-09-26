/**
 * The Harness-facing half (B7-P7) driven through the production agent loop
 * with a scripted model adapter: what the model actually receives (the
 * recall list, the guide, the tool results) and what the session log
 * records (the recall source with ids and versions, the tool calls), across
 * relevant recall, irrelevant omission, project isolation, write failure,
 * correction and forgetting, automatic project facts, global writes without
 * a gate, and the markdown mode that injects nothing.
 * @module @deepseek-ai/dsh-workbench-memory/tests/runtime
 */
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import WorkbenchMemory, {
  WORKBENCH_MEMORY_LIMITS,
  memoryGuide,
  readRecallSource,
  recallEntries,
  registerMemoryRecall,
  termsOf,
  type MemoryEntry,
} from '../src/index.ts'
import { lastToolResult, latestRecall, loop, project, recallEvents, requestText, scopeOf, user } from './loop-support.ts'
import { cleanup } from './support.ts'

afterEach(async () => { await cleanup() })

describe('recall injection', () => {
  it('injects the relevant project facts and the global preferences, omits the unrelated and the other project, and records ids and versions', async () => {
    const harness = await loop([textResponse('ok'), textResponse('ok')])
    const { api, signal, adapter, agents } = harness
    try {
      const writing = project('writing')
      const art = project('art')
      const writingScope = await scopeOf(api, writing, signal)
      const artScope = await scopeOf(api, art, signal)
      const pref = await api.remember({ scope: { kind: 'global' }, kind: 'preference', content: '回答用中文', source: { kind: 'user' } }, signal)
      const build = await api.remember({ scope: writingScope, kind: 'fact', content: 'Build with `pnpm run build`', keywords: ['build'], source: { kind: 'assistant', evidence: 'package.json scripts' } }, signal)
      await api.remember({ scope: writingScope, kind: 'fact', content: 'CI runs on ubuntu runners', source: { kind: 'user' } }, signal)
      await api.remember({ scope: artScope, kind: 'fact', content: 'The art project builds with jest and vite', keywords: ['build'], source: { kind: 'user' } }, signal)
      if (!pref.ok || !build.ok) throw new Error('remember failed')
      const agent = await agents.create(SessionId('writing-session'), { provider: 'mock', model: 'mock' }, { cwd: writing })
      agent.followup(user('how do I build this project?'))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      const request = requestText(adapter.requests[0])
      expect(request).toContain(`#${build.entry.id} v1 [project fact]: Build with \`pnpm run build\` (evidence: package.json scripts)`)
      expect(request).toContain(`#${pref.entry.id} v1 [global preference]: 回答用中文`)
      expect(request).not.toContain('ubuntu')
      expect(request).not.toContain('jest')
      expect(request).toContain('grant no tool permission')
      // The guide rides the runtime context in entries mode.
      expect(request).toContain('DeepSeekGUI keeps memory as entries, not files.')
      expect(request).toContain('Do not record: guesses')
      // The session log records exactly what was shown, by id and version.
      const recalled = recallEvents(agent.session.snapshotEvents())
      expect(recalled).toHaveLength(1)
      expect(recalled[0]?.source).toMatchObject({
        kind: 'deepseekgui-memory',
        form: 'recall',
        query: 'how do I build this project?',
        entries: [
          { id: build.entry.id, version: 1, scope: 'project', kind: 'fact' },
          { id: pref.entry.id, version: 1, scope: 'global', kind: 'preference' },
        ],
        omitted: 0,
      })
      expect(recalled[0]?.source.update).toBeUndefined()
      // The same query again: the visible list is unchanged, so nothing is re-sent.
      agent.followup(user('how do I build this project?'))
      await agent.whenIdle()
      expect(recallEvents(agent.session.snapshotEvents())).toHaveLength(1)
      expect(adapter.requests).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })

  it('replaces the list when a correction changes a version and when a forget empties it', async () => {
    const harness = await loop([textResponse('one'), textResponse('two'), textResponse('three')])
    const { api, signal, adapter, agents } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      const fact = await api.remember({ scope, kind: 'fact', content: 'Port is 3000', keywords: ['port'], source: { kind: 'user' } }, signal)
      if (!fact.ok) throw new Error('remember failed')
      const agent = await agents.create(SessionId('correct-session'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      agent.followup(user('which port?'))
      await agent.whenIdle()
      expect(requestText(adapter.requests[0])).toContain(`#${fact.entry.id} v1 [project fact]: Port is 3000`)
      // Another window corrects the entry between turns.
      const corrected = await api.correct({ id: fact.entry.id, expectedVersion: 1, content: 'Port is 3100', source: { kind: 'user', sessionId: 'other-window' } }, signal)
      expect(corrected.ok).toBe(true)
      agent.followup(user('which port?'))
      await agent.whenIdle()
      const second = latestRecall(adapter.requests[1])
      expect(second).toContain(`#${fact.entry.id} v2 [project fact]: Port is 3100`)
      expect(second).not.toContain('Port is 3000')
      expect(second).toContain('replaces every earlier recalled-memory list')
      // Forgotten: the next request says so instead of keeping the stale list in force.
      await api.forget({ id: fact.entry.id, expectedVersion: 2, source: { kind: 'user' } }, signal)
      agent.followup(user('which port?'))
      await agent.whenIdle()
      const third = latestRecall(adapter.requests[2])
      expect(third).toContain('No memory entries match this request; earlier recalled entries no longer apply')
      expect(third).not.toContain('Port is')
      // The earlier lists stay in the history exactly as sent; only the newest is in force.
      expect(requestText(adapter.requests[2])).toContain('Port is 3000')
      const recalled = recallEvents(agent.session.snapshotEvents())
      expect(recalled.map(event => (event.source.entries as unknown[]).length)).toEqual([1, 1, 0])
      expect(recalled[1]?.source.update).toBe(true)
      expect(recalled[2]?.source.update).toBe(true)
    } finally {
      await harness.dispose()
    }
  })

  it('injects nothing in markdown mode and nothing for a session without matches', async () => {
    const harness = await loop([textResponse('ok'), textResponse('ok')], { injection: 'markdown' })
    const { api, signal, adapter, agents } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port is 3000', source: { kind: 'user' } }, signal)
      const agent = await agents.create(SessionId('markdown-session'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      agent.followup(user('which port?'))
      await agent.whenIdle()
      expect(requestText(adapter.requests[0])).not.toContain('Port is 3000')
      expect(requestText(adapter.requests[0])).not.toContain('memory_remember')
      expect(adapter.requests[0]?.tools).toBeUndefined()
      expect(harness.ctx.tools.get('memory_remember')).toBeUndefined()
      expect(recallEvents(agent.session.snapshotEvents())).toHaveLength(0)
      // Entries mode, but nothing matches and nothing was published: still nothing.
      await api.setInjection('entries', signal)
      const other = await agents.create(SessionId('quiet-session'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      other.followup(user('unrelated words'))
      await other.whenIdle()
      expect(recallEvents(other.session.snapshotEvents())).toHaveLength(0)
      expect(JSON.stringify(adapter.requests[1]?.tools)).toContain('memory_remember')
      const rememberedTool = harness.ctx.tools.get('memory_remember')!
      await api.setInjection('markdown', signal)
      expect(harness.ctx.tools.get('memory_remember')).toBeUndefined()
      await expect(rememberedTool.execute({ scope: 'global', kind: 'fact', content: 'hidden entry' }, { signal } as never)).rejects.toThrow('entry memory is not enabled')
      expect(adapter.requests).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })

  it('says how many matching entries the limit left out', async () => {
    const harness = await loop([textResponse('ok')], { config: { recallLimit: 1 } })
    const { api, signal, adapter, agents } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port 3000 for the api', keywords: ['port'], source: { kind: 'user' } }, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port 3001 for the web', source: { kind: 'user' } }, signal)
      const agent = await agents.create(SessionId('limited-session'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      agent.followup(user('which port?'))
      await agent.whenIdle()
      const recall = latestRecall(adapter.requests[0])
      expect(recall).toContain('Port 3000 for the api')
      expect(recall).not.toContain('Port 3001')
      expect(recall).toContain('1 more matching entries were left out for budget; call memory_recall with a narrower query to see them.')
      expect(recallEvents(agent.session.snapshotEvents())[0]?.source.omitted).toBe(1)
    } finally {
      await harness.dispose()
    }
  })
})

describe('memory tools', () => {
  it('records a project fact with its evidence and a global preference through the tools, with no approval gate', async () => {
    const harness = await loop([
      toolCallResponse('call-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Tests run with vitest', keywords: ['test'], evidence: 'package.json scripts.test' }),
      toolCallResponse('call-2', 'memory_remember', { scope: 'global', kind: 'preference', content: 'Prefer short answers' }),
      textResponse('saved'),
    ])
    const { api, signal, adapter, agents } = harness
    try {
      const folder = project('proj')
      const agent = await agents.create(SessionId('remember-session'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      agent.followup(user('remember how tests run'))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(3)
      const entries = (await api.list({ scope: { kind: 'all' } }, signal)).entries
      expect(entries).toHaveLength(2)
      const fact = entries.find(entry => entry.kind === 'fact')
      expect(fact).toMatchObject({
        scope: await scopeOf(api, folder, signal),
        content: 'Tests run with vitest',
        keywords: ['test'],
        source: { kind: 'assistant', sessionId: 'remember-session', evidence: 'package.json scripts.test' },
        version: 1,
      })
      expect(entries.find(entry => entry.kind === 'preference')).toMatchObject({ scope: { kind: 'global' }, content: 'Prefer short answers', source: { kind: 'assistant', sessionId: 'remember-session' } })
      // The model was told the entry landed, by id and version, only after the write.
      expect(requestText(adapter.requests[1])).toContain(`remembered #${fact?.id ?? ''} v1 [project fact]: Tests run with vitest (evidence: package.json scripts.test)`)
      expect(requestText(adapter.requests[2])).toContain('remembered #')
      const events = agent.session.snapshotEvents()
      expect(events.some(event => event.type.startsWith('approval/'))).toBe(false)
      expect(events.filter(event => event.type === 'tool/result')).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })

  it('reports a failed write to the model as a tool error instead of a silent log line', async () => {
    const harness = await loop([
      toolCallResponse('call-1', 'memory_remember', { scope: 'global', kind: 'preference', content: 'never lands' }),
      textResponse('noted the failure'),
    ])
    const { api, signal, adapter, agents } = harness
    try {
      rmSync(join(harness.domainRoot, 'entries'), { recursive: true, force: true })
      writeFileSync(join(harness.domainRoot, 'entries'), 'blocked')
      const agent = await agents.create(SessionId('fail-session'), { provider: 'mock', model: 'mock' }, { cwd: project('proj') })
      agent.followup(user('remember this'))
      await agent.whenIdle()
      expect(requestText(adapter.requests[1])).toContain('memory_remember failed (MEMORY_IO)')
      expect(requestText(adapter.requests[1])).not.toContain('remembered #')
      expect((await api.status(signal)).active).toBe(0)
      const failed = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
      expect(JSON.stringify(failed)).toContain('MEMORY_IO')
    } finally {
      await harness.dispose()
    }
  })

  it('corrects and forgets by id, quoting the version, and refuses a stale one with the current version', async () => {
    const harness = await loop([
      toolCallResponse('call-1', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'Port is 3100', evidence: 'the user said so' }),
      toolCallResponse('call-2', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'stale write' }),
      toolCallResponse('call-3', 'memory_forget', { id: 'm_000000000001', expectedVersion: 2 }),
      toolCallResponse('call-4', 'memory_correct', { id: 'm_000000000001', expectedVersion: 3, content: 'after forget' }),
      toolCallResponse('call-5', 'memory_forget', { id: 'm_000000000001' }),
      textResponse('done'),
    ])
    const { api, signal, adapter, agents } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      const fact = await api.remember({ scope, kind: 'fact', content: 'Port is 3000', source: { kind: 'user' } }, signal)
      if (!fact.ok) throw new Error('remember failed')
      expect(fact.entry.id).toBe('m_000000000001')
      const agent = await agents.create(SessionId('correct-tools'), { provider: 'mock', model: 'mock' }, { cwd: folder })
      agent.followup(user('fix the port'))
      await agent.whenIdle()
      expect(requestText(adapter.requests[1])).toContain('corrected #m_000000000001 v2 [project fact]: Port is 3100')
      expect(requestText(adapter.requests[2])).toContain('memory_correct failed (MEMORY_CONFLICT)')
      expect(requestText(adapter.requests[2])).toContain('version 2')
      expect(requestText(adapter.requests[3])).toContain('forgot #m_000000000001 (was v2 [project fact]: Port is 3100)')
      expect(requestText(adapter.requests[4])).toContain('memory_correct failed (MEMORY_FORGOTTEN)')
      // The version is never guessed: a forget without the version the model saw is refused by the schema.
      expect(lastToolResult(adapter.requests[5])).toContain('expectedVersion')
      expect(lastToolResult(adapter.requests[5])).not.toContain('forgot #')
      const stored = await api.listForgotten({ kind: 'all' }, signal)
      expect(stored[0]?.entry).toMatchObject({
        content: 'Port is 3100',
        version: 2,
        source: { kind: 'user' },
        revised: { action: 'correct', source: { kind: 'assistant', sessionId: 'correct-tools', evidence: 'the user said so' } },
      })
      expect(stored[0]?.forgottenBy).toMatchObject({ kind: 'assistant', sessionId: 'correct-tools' })
    } finally {
      await harness.dispose()
    }
  })

  it('searches through memory_recall within the session reach and explains a miss', async () => {
    const harness = await loop([
      toolCallResponse('call-1', 'memory_recall', { query: 'jest' }),
      toolCallResponse('call-2', 'memory_recall', { query: 'vitest', scope: 'project' }),
      toolCallResponse('call-3', 'memory_recall', { scope: 'global' }),
      textResponse('done'),
    ])
    const { api, signal, adapter, agents } = harness
    try {
      const writing = project('writing')
      const art = project('art')
      await api.remember({ scope: await scopeOf(api, writing, signal), kind: 'fact', content: 'Tests run with vitest', source: { kind: 'user' } }, signal)
      await api.remember({ scope: await scopeOf(api, art, signal), kind: 'fact', content: 'Tests run with jest', source: { kind: 'user' } }, signal)
      await api.remember({ scope: { kind: 'global' }, kind: 'preference', content: 'Prefer short answers', source: { kind: 'user' } }, signal)
      const agent = await agents.create(SessionId('recall-tools'), { provider: 'mock', model: 'mock' }, { cwd: writing })
      agent.followup(user('look things up'))
      await agent.whenIdle()
      // "jest" lives in the other project: a miss, explained.
      expect(lastToolResult(adapter.requests[1])).toBe(`no memory entries matched terms [jest] in scope project ${writing} + global (2 entries considered)`)
      expect(lastToolResult(adapter.requests[2])).toContain('[project fact]: Tests run with vitest')
      expect(lastToolResult(adapter.requests[2])).not.toContain('Prefer short answers')
      expect(lastToolResult(adapter.requests[3])).toContain('[global preference]: Prefer short answers')
      expect(lastToolResult(adapter.requests[3])).not.toContain('vitest')
    } finally {
      await harness.dispose()
    }
  })

  it('refuses project writes and project searches for a session without a folder, and falls back to global', async () => {
    const harness = await loop([
      toolCallResponse('call-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'nowhere' }),
      toolCallResponse('call-2', 'memory_recall', { query: 'x', scope: 'project' }),
      toolCallResponse('call-3', 'memory_recall', { query: 'x' }),
      textResponse('done'),
    ])
    const { adapter, agents } = harness
    try {
      const agent = await agents.create(SessionId('no-folder'), { provider: 'mock', model: 'mock' })
      agent.followup(user('try'))
      await agent.whenIdle()
      expect(requestText(adapter.requests[1])).toContain('memory_remember refused: this session has no project folder')
      expect(requestText(adapter.requests[2])).toContain('memory_recall refused: this session has no project folder')
      expect(requestText(adapter.requests[3])).toContain('in scope global (no project folder)')
    } finally {
      await harness.dispose()
    }
  })
})

describe('tool seams', () => {
  it('refuses correcting or forgetting another project through the actual model tools', async () => {
    const harness = await loop([
      toolCallResponse('foreign-correct', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'overwritten' }),
      toolCallResponse('foreign-forget', 'memory_forget', { id: 'm_000000000001', expectedVersion: 1 }),
      textResponse('done'),
    ])
    const { api, signal, agents, adapter } = harness
    try {
      const scope = await scopeOf(api, project('owner'), signal)
      const saved = await api.remember({ scope, kind: 'fact', content: 'Owner project fact', source: { kind: 'user' } }, signal)
      if (!saved.ok) throw new Error('remember failed')
      const agent = await agents.create(SessionId('foreign-writer'), { provider: 'mock', model: 'mock' }, { cwd: project('other') })
      agent.followup(user('change the referenced entry'))
      await agent.whenIdle()
      expect(lastToolResult(adapter.requests[1])).toContain('outside this session')
      expect(lastToolResult(adapter.requests[2])).toContain('outside this session')
      expect(await api.get(saved.entry.id, signal)).toEqual(saved.entry)
    } finally {
      await harness.dispose()
    }
  })

  /** A tool run with no agent behind it (a bare registry call). */
  const bareExec = (signal: AbortSignal) => ({
    callId: 'call-0',
    rootCallId: 'call-0',
    name: 'memory',
    arguments: {},
    token: Symbol('token'),
    signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }) as never

  it('presents its calls, trims evidence, corrects keywords and kind, forgets a global entry, and lists a scope by kind within a limit', async () => {
    const harness = await loop([])
    const { api, signal, ctx } = harness
    try {
      const exec = bareExec(signal)
      const tool = (name: string) => {
        const found = ctx.tools.get(name)
        if (found === undefined) throw new Error(`no tool ${name}`)
        return found
      }
      expect(tool('memory_remember').presentCall?.({ scope: 'global', kind: 'preference', content: 'x' })).toMatchObject({ title: 'memory_remember global preference' })
      expect(tool('memory_correct').presentCall?.({ id: 'm_1', expectedVersion: 1 })).toMatchObject({ title: 'memory_correct m_1' })
      expect(tool('memory_forget').presentCall?.({ id: 'm_1', expectedVersion: 1 })).toMatchObject({ title: 'memory_forget m_1' })
      expect(tool('memory_forget').presentCall?.({ id: 'm_1' })).toBeUndefined()
      expect(tool('memory_recall').presentCall?.({ query: 'port' })).toMatchObject({ title: 'memory_recall port' })
      expect(tool('memory_recall').presentCall?.({})).toMatchObject({ title: 'memory_recall' })
      // No agent: the source carries no session id, and blank evidence is dropped.
      const remembered = await tool('memory_remember').execute({ scope: 'global', kind: 'preference', content: 'Reply tersely', evidence: '  ' }, exec) as MemoryEntry
      expect(remembered.source).toEqual({ kind: 'assistant', at: '2026-09-13T12:00:01.000Z' })
      const corrected = await tool('memory_correct').execute(
        { id: remembered.id, expectedVersion: 1, keywords: ['tone'], kind: 'fact', evidence: 'the user said so' },
        exec,
      ) as MemoryEntry
      expect(corrected).toMatchObject({ version: 2, kind: 'fact', keywords: ['tone'], content: 'Reply tersely' })
      // The original source stays; the correction is recorded beside it, without a session id.
      expect(corrected.source).toEqual(remembered.source)
      expect(corrected.revised).toMatchObject({ action: 'correct', source: { kind: 'assistant', evidence: 'the user said so' } })
      expect(corrected.revised?.source).not.toHaveProperty('sessionId')
      // A project scope from a bare call is refused; global is always reachable.
      await expect(tool('memory_remember').execute({ scope: 'project', kind: 'fact', content: 'x' }, exec)).rejects.toThrow('memory_remember refused: this session has no project folder')
      const second = await tool('memory_remember').execute({ scope: 'global', kind: 'fact', content: 'Global fact' }, exec) as MemoryEntry
      const listed = await tool('memory_recall').execute({ scope: 'global', kinds: ['fact'], limit: 1 }, exec) as { entries: MemoryEntry[]; omitted: number; scope: string }
      expect(listed.entries.map(entry => entry.id)).toEqual([second.id])
      expect(listed).toMatchObject({ omitted: 1, scope: 'global' })
      const rendered = tool('memory_recall').output.render({}, listed as never)
      expect(rendered[0]).toMatchObject({ type: 'text', text: `${renderedLine(second)}\n(1 more matching entries left out; narrow the query)` })
      // A missing id is not found; a call without the version is refused before any lookup.
      await expect(tool('memory_correct').execute({ id: 'm_missing', expectedVersion: 1, content: 'x' }, exec)).rejects.toThrow('memory_correct failed (MEMORY_NOT_FOUND)')
      await expect(tool('memory_correct').execute({ id: corrected.id, content: 'x' }, exec)).rejects.toThrow('expectedVersion')
      const forgotten = await tool('memory_forget').execute({ id: corrected.id, expectedVersion: 2 }, exec) as MemoryEntry
      expect(tool('memory_forget').output.render({}, forgotten as never)[0]).toMatchObject({ text: `forgot #${corrected.id} (was v2 [global fact]: Reply tersely)` })
      expect(await api.get(corrected.id, signal)).toBeNull()
    } finally {
      await harness.dispose()
    }
  })

  function renderedLine(entry: MemoryEntry): string {
    return `- #${entry.id} v${String(entry.version)} [global ${entry.kind}]: ${entry.content}`
  }

  it('reports markdown until the domain is open, and the recorded mode after', async () => {
    const ctx = new Context()
    let open: (domain: unknown) => void = () => {}
    const opening = new Promise<unknown>((resolve) => { open = resolve })
    ctx.provide('typert', {} as never)
    ctx.provide('storageDomain', { open: () => opening } as never)
    const mounting = ctx.plugin(WorkbenchMemory, { ...WORKBENCH_MEMORY_LIMITS })
    await new Promise((resolve) => { setImmediate(resolve) })
    const api = ctx.reflect.get('workbenchMemory', false) as WorkbenchMemory
    expect(api.injectionMode()).toBe('markdown')
    // A session deleted before the domain opens is not waited on: the deletion pipeline never blocks here.
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    await api.sessionDeleted('early')
    expect(warnings).toEqual(['workbench-memory: session early deleted before the memory domain opened; its entries are not marked'])
    open({
      table: () => ({ entries: () => [][Symbol.iterator](), get: () => undefined }),
      global: { get: () => ({ injection: 'entries' }), set: async () => {} },
      close: () => {},
    })
    await mounting
    expect(api.injectionMode()).toBe('entries')
    await ctx.fiber.dispose()
  })
})

describe('recall listener', () => {
  type Listener = (input: { agent: unknown; messages: unknown[]; signal: AbortSignal }, next: () => Promise<unknown>) => Promise<unknown>
  const recalled: MemoryEntry[] = []
  const host = {
    ready: Promise.resolve(),
    injectionMode: () => 'entries',
    sessionScope: async () => null,
    recall: () => ({ entries: recalled, omitted: 0, terms: [], considered: 0 }),
  }
  const capture = (): Listener => {
    let listener: Listener | undefined
    registerMemoryRecall({ on: (_name: string, callback: Listener) => { listener = callback } } as never, host as never)
    if (listener === undefined) throw new Error('listener not registered')
    return listener
  }
  const agentWith = (events: unknown[], nodes: number[]) => ({
    session: { header: {}, surface: { nodes }, seq: events.length, eventAt: (index: number) => events[index] },
  })
  const signal = new AbortController().signal

  it('passes a rejection and a step without user text through untouched', async () => {
    const listener = capture()
    const rejected = { kind: 'reject', reason: 'no' }
    expect(await listener({ agent: agentWith([], []), messages: [], signal }, async () => rejected)).toBe(rejected)
    const entered = { kind: 'enter', messages: [] }
    const messages = [
      createUserMessage({ content: [{ type: 'text', text: 'plugin text' }], source: { kind: 'plugin', plugin: 'x' } as never }),
      createUserMessage({ content: [{ type: 'image', image: { mediaType: 'image/png', data: '' } } as never], source: { kind: 'user' } }),
    ]
    expect(await listener({ agent: agentWith([], []), messages, signal }, async () => entered)).toBe(entered)
  })

  it('treats a published list that left the visible surface as published, and skips unreadable records', async () => {
    const listener = capture()
    const events = [
      { type: 'user/message', seq: 0, data: { source: { kind: 'deepseekgui-memory', entries: 'unreadable' }, content: [] } },
      { type: 'user/message', seq: 1, data: { source: { kind: 'deepseekgui-memory', form: 'recall', query: 'q', entries: [{ id: 'm_1', version: 1, scope: 'global', kind: 'fact' }], omitted: 0 }, content: [] } },
      undefined,
    ]
    const messages = [user('anything')]
    const decision = await listener({ agent: agentWith(events, []), messages, signal }, async () => ({ kind: 'enter', messages })) as { messages: unknown[] }
    expect(decision.messages).toHaveLength(2)
    expect(decision.messages[1]).toMatchObject({ source: { kind: 'deepseekgui-memory', update: true, entries: [] } })
  })
})

describe('recall records', () => {
  it('reads back only well-formed records', () => {
    expect(readRecallSource(null)).toBeUndefined()
    expect(readRecallSource({ kind: 'user' })).toBeUndefined()
    expect(readRecallSource({ kind: 'deepseekgui-memory', entries: [null] })).toBeUndefined()
    expect(readRecallSource({ kind: 'deepseekgui-memory', entries: [{ id: 1, version: 1 }] })).toBeUndefined()
    expect(readRecallSource({ kind: 'deepseekgui-memory', entries: [{ id: 'm', version: 1, scope: 'nowhere', kind: 'fact' }] })).toBeUndefined()
    expect(readRecallSource({ kind: 'deepseekgui-memory', entries: [{ id: 'm', version: 1, scope: 'global', kind: 'rule' }] })).toBeUndefined()
    expect(readRecallSource({ kind: 'deepseekgui-memory', entries: [{ id: 'm', version: 1, scope: 'project', kind: 'continuation' }] }))
      .toEqual([{ id: 'm', version: 1, scope: 'project', kind: 'continuation' }])
  })

  it('ships the guide as an asset', () => {
    expect(memoryGuide()).toContain('# Memory')
    expect(memoryGuide().endsWith('\n')).toBe(false)
  })
})

describe('recall ranking', () => {
  const entry = (id: string, kind: MemoryEntry['kind'], content: string, keywords?: string[]): MemoryEntry => ({
    id,
    scope: { kind: 'global' },
    kind,
    content,
    ...keywords === undefined ? {} : { keywords },
    source: { kind: 'user', at: 't' },
    version: 1,
    createdAt: 't',
    updatedAt: 't',
  })

  it('tokenizes latin words and Han bigrams', () => {
    expect(termsOf('Build the Project-Two')).toEqual(['build', 'the', 'project-two'])
    expect(termsOf('回答用中文 ok')).toEqual(['回答', '答用', '用中', '中文', 'ok'])
    expect(termsOf('中文')).toEqual(['中文'])
    expect(termsOf('')).toEqual([])
  })

  it('ranks keyword hits above content hits, facts above notes on ties, unmatched preferences last, and honours limit and budget with a count', () => {
    const table = {
      entries: () => [
        ['a', { state: 'active', entry: entry('m_a', 'fact', 'build steps', ['deploy']) }],
        ['b', { state: 'active', entry: entry('m_b', 'fact', 'deploy with the build script') }],
        ['c', { state: 'active', entry: entry('m_c', 'preference', 'Prefer short answers') }],
        ['d', { state: 'active', entry: entry('m_d', 'continuation', 'deploy left unfinished') }],
        ['e', { state: 'active', entry: entry('m_e', 'fact', 'unrelated') }],
        ['f', { state: 'active', entry: entry('m_f', 'fact', 'Deploy with the build script') }],
      ][Symbol.iterator](),
      get: () => undefined,
    } as never
    const ambient = { scope: { kind: 'all' } as const, ambient: true, limit: 10, budgetBytes: 4096 }
    const full = recallEntries(table, { ...ambient, query: 'deploy' })
    expect(full.entries.map(item => item.id)).toEqual(['m_a', 'm_b', 'm_d', 'm_c'])
    expect(full).toMatchObject({ omitted: 0, terms: ['deploy'], considered: 6 })
    const limited = recallEntries(table, { ...ambient, query: 'deploy', limit: 2 })
    expect(limited.entries.map(item => item.id)).toEqual(['m_a', 'm_b'])
    expect(limited.omitted).toBe(2)
    const tight = recallEntries(table, { ...ambient, query: 'deploy', budgetBytes: 60 })
    expect(tight.entries).toHaveLength(1)
    expect(tight.omitted).toBe(3)
    // Ambient recall with no terms carries only the preferences; an explicit search needs a hit, and lists the scope without a query.
    expect(recallEntries(table, { ...ambient, query: '' }).entries.map(item => item.id)).toEqual(['m_c'])
    expect(recallEntries(table, { ...ambient, query: '', kinds: ['fact'] }).entries).toEqual([])
    const explicit = { scope: { kind: 'all' } as const, limit: 10, budgetBytes: 4096 }
    expect(recallEntries(table, { ...explicit, query: 'deploy' }).entries.map(item => item.id)).toEqual(['m_a', 'm_b', 'm_d'])
    expect(recallEntries(table, { ...explicit, query: '', kinds: ['fact'] }).entries.map(item => item.id)).toEqual(['m_a', 'm_b', 'm_e'])
    // Short latin terms need an exact word: `i` does not hit `ci`, `ci` does.
    expect(recallEntries(table, { ...explicit, query: 'i' }).entries).toEqual([])
    expect(recallEntries(table, { ...explicit, query: 'build' }).entries.map(item => item.id)).toEqual(['m_a', 'm_b'])
    expect(recallEntries(table, { ...explicit, query: '#m_e' }).entries.map(item => item.id)).toEqual(['m_e'])
  })
})
