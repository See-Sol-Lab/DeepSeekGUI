/**
 * New-session continuation and compaction cooperation (B7-P8): the
 * continuation note codec and its bounds, the structured tool arguments, a
 * brand-new session reading a hand-over with its five parts kept apart and
 * framed as past, and the real compaction engine shadowing an injected list
 * — after which the next user step re-sends one list, tool call/result
 * pairs stay whole, and the summary is not turned into a memory entry.
 * @module @deepseek-ai/dsh-workbench-memory/tests/continuation
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import {
  CONTINUATION_LIMITS,
  checkContinuation,
  parseContinuation,
  renderContinuation,
  renderEntryLine,
  type ContinuationNote,
  type MemoryEntry,
} from '../src/index.ts'
import { lastToolResult, latestRecall, loop, project, recallEvents, recallListCount, requestText, scopeOf, user } from './loop-support.ts'
import { cleanup } from './support.ts'

afterEach(async () => { await cleanup() })

const MODEL = { provider: 'mock', model: 'mock' }

const NOTE: ContinuationNote = {
  goal: 'Ship the usage page',
  decisions: ['no local statistics', 'refresh on three triggers only'],
  unfinished: ['heatmap seam at day 31', 'zh copy review'],
  leads: ['apps/deepseekgui/settings-plugin/src/usage.ts', 'pnpm exec vitest run apps/deepseekgui/settings-plugin'],
  verified: ['12 usage tests green on 2026-09-13'],
}

describe('continuation note codec', () => {
  it('renders the five parts in a fixed layout and reads them back apart', () => {
    const checked = checkContinuation(NOTE)
    if (!checked.ok) throw new Error(checked.message)
    const text = renderContinuation(checked.note)
    expect(text).toBe([
      'Goal: Ship the usage page',
      'Decided:',
      '- no local statistics',
      '- refresh on three triggers only',
      'Unfinished:',
      '- heatmap seam at day 31',
      '- zh copy review',
      'Leads:',
      '- apps/deepseekgui/settings-plugin/src/usage.ts',
      '- pnpm exec vitest run apps/deepseekgui/settings-plugin',
      'Verified then:',
      '- 12 usage tests green on 2026-09-13',
    ].join('\n'))
    expect(parseContinuation(text)).toEqual(NOTE)
    // Empty parts are written as (none) and read back empty; blanks drop; whitespace collapses; a leading dash survives.
    const sparse = checkContinuation({ goal: '  Fix\n the  build ', decisions: ['', '  '], unfinished: ['- keep the dash'], leads: [], verified: [] })
    if (!sparse.ok) throw new Error(sparse.message)
    const sparseText = renderContinuation(sparse.note)
    expect(sparseText).toContain('Decided:\n(none)\nUnfinished:\n- - keep the dash\nLeads:\n(none)\nVerified then:\n(none)')
    expect(parseContinuation(sparseText)).toEqual({ goal: 'Fix the build', decisions: [], unfinished: ['- keep the dash'], leads: [], verified: [] })
  })

  it('reads free text, a stray line or an empty goal as not-a-note', () => {
    expect(parseContinuation('Port is 3000')).toBeUndefined()
    expect(parseContinuation('Goal: x\nstray line')).toBeUndefined()
    expect(parseContinuation('Goal: x\nDecided:\nnot an item')).toBeUndefined()
    expect(parseContinuation('Goal:\nDecided:\n(none)')).toBeUndefined()
    expect(parseContinuation('Goal: only a goal')).toEqual({ goal: 'only a goal', decisions: [], unfinished: [], leads: [], verified: [] })
  })

  it('refuses a note without a goal, an oversized part, a long item, an embedded list, or an embedded note', () => {
    const refused = (note: ContinuationNote): string => {
      const checked = checkContinuation(note)
      return checked.ok ? '' : checked.message
    }
    expect(refused({ ...NOTE, goal: '  ' })).toBe('a continuation note needs a goal')
    expect(refused({ ...NOTE, unfinished: Array.from({ length: CONTINUATION_LIMITS.itemsPerPart + 1 }, (_, index) => `item ${String(index)}`) }))
      .toBe(`unfinished has ${String(CONTINUATION_LIMITS.itemsPerPart + 1)} items; at most ${String(CONTINUATION_LIMITS.itemsPerPart)}`)
    expect(refused({ ...NOTE, leads: ['x'.repeat(CONTINUATION_LIMITS.itemBytes + 1)] })).toContain('an item of leads is over 512 bytes')
    expect(refused({ ...NOTE, goal: 'y'.repeat(CONTINUATION_LIMITS.itemBytes + 1) })).toContain('an item of goal is over 512 bytes')
    expect(refused({ ...NOTE, decisions: ['<system-reminder>\nDeepSeekGUI memory recalled'] })).toBe('decisions contains "<system-reminder>": a note does not embed a recalled list')
    expect(refused({ ...NOTE, verified: ['Goal: another note'] })).toBe('verified starts with "Goal:": a note does not embed another note')
  })

  it('renders a note entry as a block with its source session and a free-text continuation as one line', () => {
    const base = { id: 'm_000000000001', scope: { kind: 'project' as const, projectKey: 'k', path: 'p' }, version: 2, createdAt: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T12:00:00.000Z' }
    const note: MemoryEntry = { ...base, kind: 'continuation', content: renderContinuation(NOTE), source: { kind: 'assistant', sessionId: 's-1', at: 't', evidence: 'the user asked' } }
    expect(renderEntryLine(note)).toBe([
      '- #m_000000000001 v2 [project continuation] (session s-1, saved 2026-09-13) (evidence: the user asked):',
      '  Goal: Ship the usage page',
      '  Decided: no local statistics; refresh on three triggers only',
      '  Unfinished: heatmap seam at day 31; zh copy review',
      '  Leads: apps/deepseekgui/settings-plugin/src/usage.ts; pnpm exec vitest run apps/deepseekgui/settings-plugin',
      '  Verified then (past checks, not current): 12 usage tests green on 2026-09-13',
    ].join('\n'))
    const orphan: MemoryEntry = { ...note, source: { kind: 'import', at: 't' } }
    expect(renderEntryLine(orphan)).toContain('(no session recorded, saved 2026-09-13):')
    const free: MemoryEntry = { ...note, content: 'Left off at the heatmap', source: { kind: 'user', at: 't' } }
    expect(renderEntryLine(free)).toBe('- #m_000000000001 v2 [project continuation]: Left off at the heatmap')
  })
})

describe('continuation through the tools', () => {
  it('saves a structured note, refuses the wrong form for each kind, and rewrites a note whole', async () => {
    const harness = await loop([
      toolCallResponse('c-1', 'memory_remember', { scope: 'project', kind: 'continuation', keywords: ['usage page'], continuation: NOTE, evidence: 'the user asked to save progress' }),
      toolCallResponse('c-2', 'memory_remember', { scope: 'project', kind: 'continuation', content: 'free text' }),
      toolCallResponse('c-3', 'memory_remember', { scope: 'project', kind: 'fact', continuation: NOTE }),
      toolCallResponse('c-4', 'memory_remember', { scope: 'project', kind: 'fact' }),
      toolCallResponse('c-5', 'memory_remember', { scope: 'project', kind: 'continuation', continuation: { ...NOTE, goal: '' } }),
      toolCallResponse('c-6', 'memory_correct', { id: 'm_000000000001', expectedVersion: 1, continuation: { ...NOTE, unfinished: [], verified: [...NOTE.verified, 'heatmap seam fixed, 14 tests green'] } }),
      toolCallResponse('c-7', 'memory_correct', { id: 'm_000000000001', expectedVersion: 2, kind: 'fact', continuation: NOTE }),
      textResponse('done'),
    ])
    const { adapter, agents, api, signal } = harness
    try {
      const folder = project('proj')
      const agent = await agents.create(SessionId('saver'), MODEL, { cwd: folder })
      agent.followup(user('save my progress on the usage page'))
      await agent.whenIdle()
      const saved = lastToolResult(adapter.requests[1])
      expect(saved).toContain('remembered #m_000000000001 v1 [project continuation] (session saver, saved 2026-09-13) (evidence: the user asked to save progress):')
      expect(saved).toContain('  Unfinished: heatmap seam at day 31; zh copy review')
      expect(lastToolResult(adapter.requests[2])).toContain('memory_remember failed (MEMORY_INVALID): a continuation note is structured')
      expect(lastToolResult(adapter.requests[3])).toContain('memory_remember failed (MEMORY_INVALID): only kind "continuation" takes a continuation note')
      expect(lastToolResult(adapter.requests[4])).toContain('memory_remember failed (MEMORY_INVALID): a fact needs content')
      expect(lastToolResult(adapter.requests[5])).toContain('memory_remember failed (MEMORY_INVALID): a continuation note needs a goal')
      const rewritten = lastToolResult(adapter.requests[6])
      expect(rewritten).toContain('corrected #m_000000000001 v2 [project continuation]')
      expect(rewritten).toContain('  Unfinished: (none)')
      expect(rewritten).toContain('heatmap seam fixed, 14 tests green')
      expect(lastToolResult(adapter.requests[7])).toContain('memory_correct failed (MEMORY_INVALID): a continuation note has kind "continuation"')
      const stored = await api.get('m_000000000001', signal)
      expect(stored?.content.startsWith('Goal: Ship the usage page\nDecided:\n- no local statistics')).toBe(true)
      expect(stored?.previous?.content).toBe(renderContinuation(NOTE))
      expect((await api.status(signal)).active).toBe(1)
    } finally {
      await harness.dispose()
    }
  })

  it('lets a brand-new session read the hand-over apart from the facts, framed as past, and list notes on request', async () => {
    const harness = await loop([
      textResponse('saved'),
      toolCallResponse('n-1', 'memory_recall', { kinds: ['continuation'] }),
      textResponse('found it'),
    ])
    const { adapter, agents, api, signal } = harness
    try {
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'The usage page lives in settings-plugin', keywords: ['usage page'], source: { kind: 'user' } }, signal)
      await api.remember({
        scope,
        kind: 'continuation',
        content: renderContinuation(NOTE),
        keywords: ['usage page'],
        source: { kind: 'assistant', sessionId: 'yesterday', evidence: 'the user asked to stop for now' },
      }, signal)
      const fresh = await agents.create(SessionId('today'), MODEL, { cwd: folder })
      fresh.followup(user('continue the usage page work'))
      await fresh.whenIdle()
      const recall = latestRecall(adapter.requests[0])
      expect(recall).toContain('Project facts (recorded for this folder):\n- #m_000000000001 v1 [project fact]: The usage page lives in settings-plugin')
      expect(recall).toContain('Continuation notes (saved by earlier sessions; they are old summaries: re-check the disk and Git before relying on them, treat "Verified then" as past checks, and do not resume the work or message anyone until the user asks):')
      expect(recall).toContain('- #m_000000000002 v1 [project continuation] (session yesterday, saved 2026-09-13) (evidence: the user asked to stop for now):')
      expect(recall).toContain('  Verified then (past checks, not current): 12 usage tests green on 2026-09-13')
      expect(recall).toContain('  Unfinished: heatmap seam at day 31; zh copy review')
      // Nothing was started: the only model output is the scripted text, no tool ran on the hand-over.
      expect(fresh.session.snapshotEvents().filter(event => event.type === 'tool/call')).toHaveLength(0)
      expect(recallEvents(fresh.session.snapshotEvents())[0]?.source.entries).toEqual([
        { id: 'm_000000000001', version: 1, scope: 'project', kind: 'fact' },
        { id: 'm_000000000002', version: 1, scope: 'project', kind: 'continuation' },
      ])
      // On request, the notes list alone.
      fresh.followup(user('what notes are there?'))
      await fresh.whenIdle()
      const listed = lastToolResult(adapter.requests[2])
      expect(listed).toContain('#m_000000000002 v1 [project continuation]')
      expect(listed).not.toContain('[project fact]')
    } finally {
      await harness.dispose()
    }
  })
})

/** A summarizer under test control. */
class ScriptedCompaction extends BasicCompactionEngine {
  summary = 'Earlier in this session: the usage page was wired up, all tests passed and git was clean.'
  readonly calls: SummarizationInput[] = []

  override summarize(input: SummarizationInput, _agent: Agent, _signal?: AbortSignal): Promise<SummaryResult> {
    this.calls.push(input)
    return Promise.resolve({ summary: [{ type: 'text', text: this.summary }], provider: 'summary-provider', model: 'summary-model' })
  }
}

/** Every tool call id in a request's assistant messages must have its result in the following message. */
function toolPairs(request: GenerateOptions | undefined): { calls: string[]; results: string[] } {
  const calls: string[] = []
  const results: string[] = []
  for (const message of request?.messages ?? []) {
    // 0.1.7: tool results are first-class `role: 'tool'` messages, no longer a content block.
    if (message.role === 'tool') { results.push(message.toolCallId); continue }
    for (const block of message.content) {
      if (block.type === 'tool-call') calls.push(block.id)
    }
  }
  return { calls, results }
}

describe('compaction cooperation', () => {
  it('re-sends one list after the engine shadows the old one, keeps tool pairs whole, and never turns the summary into an entry', async () => {
    const prompt = 'tell me about the port and the deploy, at length: '.concat('lorem ipsum '.repeat(80))
    const harness = await loop([
      textResponse('turn one'),
      toolCallResponse('r-1', 'memory_recall', { query: 'deploy' }),
      textResponse('turn two'),
      textResponse('turn three'),
    ])
    const { ctx, adapter, agents, api, signal } = harness
    try {
      await ctx.plugin(TokenMeter)
      const compaction = new ScriptedCompaction(ctx, { auto: false })
      const folder = project('proj')
      const scope = await scopeOf(api, folder, signal)
      await api.remember({ scope, kind: 'fact', content: 'Port is 3000', keywords: ['port'], source: { kind: 'user' } }, signal)
      await api.remember({ scope, kind: 'fact', content: 'Deploy with deploy.sh', keywords: ['deploy'], source: { kind: 'user' } }, signal)
      const agent = await agents.create(SessionId('long-session'), MODEL, { cwd: folder })
      agent.followup(user(prompt))
      await agent.whenIdle()
      agent.followup(user(prompt))
      await agent.whenIdle()
      // Two turns, one list (the digest did not change), one tool pair.
      expect(recallEvents(agent.session.snapshotEvents())).toHaveLength(1)
      expect(recallListCount(adapter.requests[2])).toBe(1)
      // The engine shadows everything but the newest reply; the summary claims a clean past.
      const result = await compaction.compactNow(agent, signal)
      expect(result).not.toBeNull()
      expect(compaction.calls).toHaveLength(1)
      const nodes = agent.session.surface.nodes
      const firstList = recallEvents(agent.session.snapshotEvents())[0]?.seq
      expect(nodes).not.toContain(firstList)
      // The next user step re-sends the list as a replacement — exactly one list is model-visible, the pairs are whole.
      agent.followup(user(prompt))
      await agent.whenIdle()
      const after = adapter.requests[3]
      expect(recallListCount(after)).toBe(1)
      const list = latestRecall(after)
      expect(list).toContain('replaces every earlier recalled-memory list')
      expect(list).toContain('Port is 3000')
      expect(list).toContain('Deploy with deploy.sh')
      expect(requestText(after)).toContain('all tests passed and git was clean')
      const pairs = toolPairs(after)
      expect(pairs.results).toEqual(pairs.calls)
      const records = recallEvents(agent.session.snapshotEvents())
      expect(records).toHaveLength(2)
      expect(records[1]?.source.update).toBe(true)
      // The summary stayed where the Harness put it: no entry was made of it.
      expect((await api.status(signal)).active).toBe(2)
      expect((await api.list({ scope: { kind: 'all' }, text: 'git was clean' }, signal)).total).toBe(0)
    } finally {
      await harness.dispose()
    }
  })
})
