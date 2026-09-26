/**
 * Cross-window behaviour (B7-P8) through two truly independent production
 * Sessions of one Harness process, each on its own scripted adapter: a
 * write in window A is what window B's next user step recalls, a step in
 * flight keeps the list it started with, a stale version is refused and
 * never merged, a forget empties B's next list, two projects stay apart, an
 * application restart over the same home keeps everything and a fresh home
 * has nothing, enhanced memory switched off injects nothing and refuses the
 * tools without falling back to the files, and a deleted source session
 * leaves its entries standing and marked.
 * @module @deepseek-ai/dsh-workbench-memory/tests/crosswindow
 */
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { MemoryChangeEvent } from '../src/index.ts'
import {
  lastToolResult,
  latestRecall,
  latestRuntimeContext,
  loop,
  project,
  recallEvents,
  recallListCount,
  requestText,
  scopeOf,
  user,
} from './loop-support.ts'
import { cleanup } from './support.ts'

afterEach(async () => { await cleanup() })

const A = { provider: 'mock-a', model: 'mock' }
const B = { provider: 'mock', model: 'mock' }

describe('two windows on one project', () => {
  it('lets B recall what A remembered, corrected and forgot — each on B\'s next user step, never on the same one', async () => {
    const harness = await loop(
      // Window B: four plain turns.
      [textResponse('b1'), textResponse('b2'), textResponse('b3'), textResponse('b4')],
      {
        adapters: {
          // Window A: remember, then correct, then forget, each in its own turn.
          'mock-a': [
            toolCallResponse('a-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Deploy runs on port 3000', keywords: ['deploy'], evidence: 'deploy.sh' }),
            textResponse('a1'),
            toolCallResponse('a-2', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'Deploy runs on port 3100', evidence: 'the user said so' }),
            textResponse('a2'),
            toolCallResponse('a-3', 'memory_forget', { id: 'm_000000000001', expectedVersion: 2, evidence: 'port moved to the env file' }),
            textResponse('a3'),
          ],
        },
      },
    )
    const { adapters, agents, api, signal } = harness
    const a = adapters['mock-a']
    const b = harness.adapter
    try {
      const folder = project('proj')
      const windowA = await agents.create(SessionId('window-a'), A, { cwd: folder })
      const windowB = await agents.create(SessionId('window-b'), B, { cwd: folder })
      // B asks before A wrote anything: no list, nothing published.
      windowB.followup(user('how does deploy work?'))
      await windowB.whenIdle()
      expect(recallListCount(b.requests[0])).toBe(0)
      // A remembers.
      windowA.followup(user('remember the deploy port'))
      await windowA.whenIdle()
      expect(lastToolResult(a?.requests[1])).toContain('remembered #m_000000000001 v1 [project fact]: Deploy runs on port 3000 (evidence: deploy.sh)')
      // B's next user step reads it.
      windowB.followup(user('how does deploy work?'))
      await windowB.whenIdle()
      expect(latestRecall(b.requests[1])).toContain('#m_000000000001 v1 [project fact]: Deploy runs on port 3000')
      // A corrects; B's next step reads v2 as a declared replacement.
      windowA.followup(user('the port changed'))
      await windowA.whenIdle()
      windowB.followup(user('how does deploy work?'))
      await windowB.whenIdle()
      const second = latestRecall(b.requests[2])
      expect(second).toContain('#m_000000000001 v2 [project fact]: Deploy runs on port 3100')
      expect(second).toContain('replaces every earlier recalled-memory list')
      expect(second).not.toContain('port 3000')
      // A forgets; B's next step gets the empty replacement and the entry is gone from B's reach.
      windowA.followup(user('forget the port'))
      await windowA.whenIdle()
      windowB.followup(user('how does deploy work?'))
      await windowB.whenIdle()
      expect(latestRecall(b.requests[3])).toContain('No memory entries match this request; earlier recalled entries no longer apply')
      expect(recallEvents(windowB.session.snapshotEvents()).map(record => (record.source.entries as unknown[]).length)).toEqual([1, 1, 0])
      expect(await api.get('m_000000000001', signal)).toBeNull()
      // A's own steps recalled the entry too — at the version A's step started with.
      const versionsSeenByA = recallEvents(windowA.session.snapshotEvents())
        .map(record => (record.source.entries as Array<{ version: number }>).map(entry => entry.version))
      expect(versionsSeenByA).toEqual([[1], [2]])
    } finally {
      await harness.dispose()
    }
  })

  it('refuses a stale write from B with the current version instead of merging over A\'s correction', async () => {
    const harness = await loop(
      [
        textResponse('b1'),
        toolCallResponse('b-1', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'Tests: jest' }),
        textResponse('b2'),
        textResponse('b3'),
      ],
      {
        adapters: {
          'mock-a': [
            toolCallResponse('a-1', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'Tests: vitest --run', evidence: 'package.json' }),
            textResponse('a1'),
          ],
        },
      },
    )
    const { adapters, agents, api, signal } = harness
    const a = adapters['mock-a']
    const b = harness.adapter
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Tests: vitest', keywords: ['tests'], source: { kind: 'user' } }, signal)
      const windowA = await agents.create(SessionId('window-a'), A, { cwd: folder })
      const windowB = await agents.create(SessionId('window-b'), B, { cwd: folder })
      // Both read v1.
      windowB.followup(user('which tests?'))
      await windowB.whenIdle()
      expect(latestRecall(b.requests[0])).toContain('v1 [project fact]: Tests: vitest')
      // A corrects to v2.
      windowA.followup(user('fix the tests fact'))
      await windowA.whenIdle()
      expect(lastToolResult(a?.requests[1])).toContain('corrected #m_000000000001 v2')
      // B, still holding v1, tries to correct: refused with the current version, nothing merged.
      windowB.followup(user('change the tests fact'))
      await windowB.whenIdle()
      // B's step started with v2 already recalled (A's write landed first); the tool still quotes v1.
      expect(latestRecall(b.requests[1])).toContain('v2 [project fact]: Tests: vitest --run')
      const refusal = lastToolResult(b.requests[2])
      expect(refusal).toContain('memory_correct failed (MEMORY_CONFLICT)')
      expect(refusal).toContain('at version 2, the write quoted 1')
      const live = await api.get('m_000000000001', signal)
      expect(live).toMatchObject({ version: 2, content: 'Tests: vitest --run' })
      expect(live?.revised?.source).toMatchObject({ kind: 'assistant', sessionId: 'window-a' })
    } finally {
      await harness.dispose()
    }
  })

  it('keeps the list a turn started with while A writes mid-turn, and swaps only on B\'s next user step', async () => {
    const gate = Promise.withResolvers<undefined>()
    const harness = await loop(
      [
        toolCallResponse('b-1', 'wait_for_gate', {}),
        textResponse('b1'),
        textResponse('b2'),
      ],
      {
        adapters: {
          'mock-a': [
            toolCallResponse('a-1', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, content: 'Port is 3100' }),
            textResponse('a1'),
          ],
        },
      },
    )
    const { ctx, adapters, agents, api, signal } = harness
    const b = harness.adapter
    try {
      ctx.tools.register(defineTool({
        name: 'wait_for_gate',
        description: 'blocks until the test releases it',
        parameters: {},
        output: { schema: { type: 'object', additionalProperties: true }, render: () => [{ type: 'text', text: 'released' }] },
        async execute() {
          await gate.promise
          return {}
        },
      }))
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port is 3000', keywords: ['port'], source: { kind: 'user' } }, signal)
      const windowA = await agents.create(SessionId('window-a'), A, { cwd: folder })
      const windowB = await agents.create(SessionId('window-b'), B, { cwd: folder })
      // B starts a turn that blocks inside a tool.
      windowB.followup(user('which port?'))
      await new Promise<void>((resolve) => {
        const poll = (): void => { if (b.requests.length === 1) resolve(); else setTimeout(poll, 5) }
        poll()
      })
      expect(latestRecall(b.requests[0])).toContain('v1 [project fact]: Port is 3000')
      // A corrects while B is blocked.
      windowA.followup(user('fix the port'))
      await windowA.whenIdle()
      expect(lastToolResult(adapters['mock-a']?.requests[1])).toContain('corrected #m_000000000001 v2')
      // B's turn continues on its fixed snapshot: the next step of the same turn carries no new list.
      gate.resolve(undefined)
      await windowB.whenIdle()
      expect(b.requests).toHaveLength(2)
      expect(recallListCount(b.requests[1])).toBe(1)
      expect(latestRecall(b.requests[1])).toContain('v1 [project fact]: Port is 3000')
      expect(recallEvents(windowB.session.snapshotEvents())).toHaveLength(1)
      // B's next user step reads v2.
      windowB.followup(user('which port?'))
      await windowB.whenIdle()
      expect(latestRecall(b.requests[2])).toContain('v2 [project fact]: Port is 3100')
      expect(latestRecall(b.requests[2])).toContain('replaces every earlier recalled-memory list')
    } finally {
      gate.resolve(undefined)
      await harness.dispose()
    }
  })
})

describe('two projects', () => {
  it('shares a global preference and keeps each project\'s facts to its own sessions', async () => {
    const harness = await loop(
      [textResponse('b1')],
      {
        adapters: {
          'mock-a': [
            toolCallResponse('a-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Writing builds with pandoc', keywords: ['build'] }),
            toolCallResponse('a-2', 'memory_remember', { scope: 'global', kind: 'preference', content: 'Answer in Chinese' }),
            textResponse('a1'),
          ],
        },
      },
    )
    const { agents } = harness
    const b = harness.adapter
    try {
      const writing = project('writing')
      const art = project('art')
      const windowA = await agents.create(SessionId('window-a'), A, { cwd: writing })
      windowA.followup(user('remember how we build'))
      await windowA.whenIdle()
      const windowB = await agents.create(SessionId('window-b'), B, { cwd: art })
      windowB.followup(user('how do I build this?'))
      await windowB.whenIdle()
      const recall = latestRecall(b.requests[0])
      expect(recall).toContain('[global preference]: Answer in Chinese')
      expect(recall).not.toContain('pandoc')
      expect(requestText(b.requests[0])).not.toContain('pandoc')
    } finally {
      await harness.dispose()
    }
  })
})

describe('restart and home', () => {
  it('keeps entries and the mode across an application restart over the same home, and starts empty on another home', async () => {
    const first = await loop([
      toolCallResponse('c-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Lint with oxlint', keywords: ['lint'] }),
      textResponse('saved'),
    ])
    const folder = project('proj')
    let home: string
    try {
      const agent = await first.agents.create(SessionId('before-restart'), B, { cwd: folder })
      agent.followup(user('remember the linter'))
      await agent.whenIdle()
      expect(lastToolResult(first.adapter.requests[1])).toContain('remembered #m_000000000001 v1')
      home = first.home
    } finally {
      await first.dispose()
    }
    // The same home, a new process: the entry and the entries mode are there for a brand-new session.
    const second = await loop([textResponse('ok')], { home, injection: 'entries', clockOffset: 100 })
    try {
      expect((await second.api.status(second.signal))).toMatchObject({ injection: 'entries', active: 1 })
      const agent = await second.agents.create(SessionId('after-restart'), B, { cwd: folder })
      agent.followup(user('how do I lint?'))
      await agent.whenIdle()
      expect(latestRecall(second.adapter.requests[0])).toContain('#m_000000000001 v1 [project fact]: Lint with oxlint')
    } finally {
      await second.dispose()
    }
    // Another home: nothing crosses over.
    const other = await loop([textResponse('ok')])
    try {
      expect((await other.api.status(other.signal)).active).toBe(0)
      const agent = await other.agents.create(SessionId('other-home'), B, { cwd: folder })
      agent.followup(user('how do I lint?'))
      await agent.whenIdle()
      expect(recallListCount(other.adapter.requests[0])).toBe(0)
      expect(requestText(other.adapter.requests[0])).not.toContain('oxlint')
    } finally {
      await other.dispose()
    }
  })
})

describe('enhanced memory switched off', () => {
  it('injects nothing, refuses the tools, keeps the entries, and comes back on the next step after switching on', async () => {
    const harness = await loop([
      textResponse('on'),
      toolCallResponse('c-1', 'memory_remember', { scope: 'global', kind: 'preference', content: 'Be brief' }),
      toolCallResponse('c-2', 'memory_recall', { query: 'port' }),
      textResponse('off'),
      textResponse('on again'),
    ])
    const { adapter, agents, api, signal } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port is 3000', keywords: ['port'], source: { kind: 'user' } }, signal)
      const agent = await agents.create(SessionId('toggle'), B, { cwd: folder })
      agent.followup(user('which port?'))
      await agent.whenIdle()
      expect(latestRecall(adapter.requests[0])).toContain('Port is 3000')
      expect(latestRuntimeContext(adapter.requests[0])).toContain('DeepSeekGUI keeps memory as entries')
      // Off: the next step gets neither the list nor the guide, and every tool refuses.
      expect((await api.setInjection('off', signal)).injection).toBe('off')
      agent.followup(user('which port? (off)'))
      await agent.whenIdle()
      expect(recallListCount(adapter.requests[1])).toBe(1)
      expect(latestRuntimeContext(adapter.requests[1])).toBe('Current runtime context: none. Earlier runtime-context snapshots no longer apply.')
      expect(lastToolResult(adapter.requests[2])).toContain('unknown tool "memory_remember"')
      expect(lastToolResult(adapter.requests[3])).toContain('unknown tool "memory_recall"')
      expect(adapter.requests[1]?.tools).toBeUndefined()
      expect((await api.status(signal))).toMatchObject({ injection: 'off', active: 1 })
      // On again: the list is back on the next user step, the guide with it.
      await api.setInjection('entries', signal)
      agent.followup(user('which port? (on)'))
      await agent.whenIdle()
      expect(latestRecall(adapter.requests[4])).toContain('Port is 3000')
      expect(latestRuntimeContext(adapter.requests[4])).toContain('DeepSeekGUI keeps memory as entries')
      expect(JSON.stringify(adapter.requests[4]?.tools)).toContain('memory_remember')
      await expect(api.setInjection('sideways' as never, signal)).rejects.toThrow('unknown injection mode')
    } finally {
      await harness.dispose()
    }
  })
})

describe('deleting a source session', () => {
  it('keeps the entries it wrote, marks them, lists them by session, and tells the next session the source is gone', async () => {
    const harness = await loop(
      [textResponse('b1')],
      {
        adapters: {
          'mock-a': [
            toolCallResponse('a-1', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Release tag is v1.1.1', keywords: ['release'] }),
            toolCallResponse('a-2', 'memory_remember', {
              scope: 'project',
              kind: 'continuation',
              keywords: ['release'],
              continuation: { goal: 'Cut the v1.1.2 release', decisions: ['keep the tag scheme'], unfinished: ['changelog'], leads: ['CHANGELOG.md'], verified: ['build passed on 2026-09-13'] },
            }),
            toolCallResponse('a-3', 'memory_remember', { scope: 'project', kind: 'fact', content: 'Scratch fact', keywords: ['scratch'] }),
            textResponse('a1'),
          ],
        },
      },
    )
    const { ctx, agents, api, signal } = harness
    const b = harness.adapter
    try {
      const changes: MemoryChangeEvent[] = []
      ctx.on('workbench-memory/change', (change) => { changes.push(change) })
      const folder = project('proj')
      const windowA = await agents.create(SessionId('window-a'), A, { cwd: folder })
      windowA.followup(user('save the release work'))
      await windowA.whenIdle()
      // One of A's entries was forgotten before the deletion: the kept-aside copy is marked too.
      await api.forget({ id: 'm_000000000003', expectedVersion: 1, source: { kind: 'user' } }, signal)
      // An entry from another origin is neither listed by A's id nor marked.
      await api.remember({ scope: await scopeOf(api, folder, signal), kind: 'fact', content: 'Written by hand', source: { kind: 'user' } }, signal)
      const before = await api.list({ scope: { kind: 'all' }, sessionId: 'window-a' }, signal)
      expect(before.entries.map(entry => entry.id)).toEqual(['m_000000000002', 'm_000000000001'])
      expect(before.entries.every(entry => entry.source.sessionDeleted === undefined)).toBe(true)
      // The session's content is deleted (the persistence backend's serial hook).
      await ctx.serial('session/content-deleting', SessionId('window-a'))
      const after = await api.list({ scope: { kind: 'all' }, sessionId: 'window-a' }, signal)
      expect(after.entries.map(entry => [entry.id, entry.source.sessionDeleted])).toEqual([['m_000000000002', true], ['m_000000000001', true]])
      expect(after.entries.map(entry => entry.version)).toEqual([1, 1])
      expect((await api.listForgotten({ kind: 'all' }, signal))[0]?.entry.source).toMatchObject({ sessionId: 'window-a', sessionDeleted: true })
      expect(changes.at(-1)).toEqual({ action: 'session-deleted', ids: ['m_000000000001', 'm_000000000002', 'm_000000000003'] })
      // Deleting again is a no-op: nothing to mark, no event.
      const count = changes.length
      await ctx.serial('session/content-deleting', SessionId('window-a'))
      expect(changes).toHaveLength(count)
      // A later session still recalls the entries and is told the source session is gone.
      const windowB = await agents.create(SessionId('window-b'), B, { cwd: folder })
      windowB.followup(user('continue the release'))
      await windowB.whenIdle()
      const recall = latestRecall(b.requests[0])
      expect(recall).toContain('Release tag is v1.1.1')
      expect(recall).toContain('(session window-a, since deleted, saved 2026-09-13)')
      expect(recall).toContain('Goal: Cut the v1.1.2 release')
      // The mark survives a correction and an undo.
      const corrected = await api.correct({ id: 'm_000000000001', expectedVersion: 1, content: 'Release tag is v1.1.2', source: { kind: 'user' } }, signal)
      expect(corrected.ok && corrected.entry.source.sessionDeleted).toBe(true)
      const undone = await api.undo({ id: 'm_000000000001', expectedVersion: 2, source: { kind: 'user' } }, signal)
      expect(undone.ok && undone.entry.source.sessionDeleted).toBe(true)
      const restored = await api.restore({ id: 'm_000000000003', source: { kind: 'user' } }, signal)
      expect(restored.ok && restored.entry.source.sessionDeleted).toBe(true)
      expect((await api.get('m_000000000004', signal))?.source.sessionDeleted).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })

  it('reports marks that did not persist and never blocks the deletion on them', async () => {
    const harness = await loop([
      toolCallResponse('a-1', 'memory_remember', { scope: 'global', kind: 'preference', content: 'Keep replies short' }),
      toolCallResponse('a-2', 'memory_remember', { scope: 'global', kind: 'preference', content: 'Forgotten later' }),
      textResponse('a1'),
    ])
    const { ctx, agents, api, signal } = harness
    try {
      const warnings: string[] = []
      ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
      const changes: MemoryChangeEvent[] = []
      ctx.on('workbench-memory/change', (change) => { changes.push(change) })
      const windowA = await agents.create(SessionId('window-a'), B, { cwd: project('proj') })
      windowA.followup(user('remember this'))
      await windowA.whenIdle()
      await api.forget({ id: 'm_000000000002', expectedVersion: 1, source: { kind: 'user' } }, signal)
      expect((await api.status(signal))).toMatchObject({ active: 1, forgotten: 1 })
      // The backend refuses every write from now on, in both tables.
      for (const table of ['entries', 'forgotten']) {
        rmSync(join(harness.domainRoot, table), { recursive: true, force: true })
        writeFileSync(join(harness.domainRoot, table), 'blocked')
      }
      await ctx.serial('session/content-deleting', SessionId('window-a'))
      expect(warnings).toEqual(['workbench-memory: 2 entries of deleted session window-a could not be marked'])
      expect(changes.some(change => change.action === 'session-deleted')).toBe(false)
      expect((await api.get('m_000000000001', signal))?.source.sessionDeleted).toBeUndefined()
    } finally {
      await harness.dispose()
    }
  })
})
