/**
 * Pure notifier-model specs (B5-P6): job-transition memory and official
 * event ids used for dedup.
 * @module @see-sol-lab/deepseekgui-workbench/tests/notifier-model
 */

import { describe, expect, it } from 'vitest'
import {
  advanceJobMemory,
  compactLine,
  officialEventIdOf,
} from '../src/client/notify/notifier-model.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const SID = 's1' as SessionId

const job = (over: { id: string; status: string; label?: string; kind?: string }) => ({
  id: over.id,
  status: over.status,
  label: over.label ?? 'dev server',
  kind: over.kind ?? 'service',
})

describe('officialEventIdOf', () => {
  it('uses the correlated tool-call id for approvals when present', () => {
    expect(officialEventIdOf({
      kind: 'approval', key: 'approval:1', callId: 'call-9', toolName: 'git_commit',
    })).toBe('call-9')
  })

  it('uses request identity for approvals without a call id', () => {
    expect(officialEventIdOf({ kind: 'approval', key: 'approval:2', toolName: 'bash' }))
      .toBe('approval:2')
    expect(officialEventIdOf({
      kind: 'approval', key: 'approval:2', toolName: 'bash', reason: 'run tests',
    })).toBe('approval:2')
  })

  it('uses the request instance instead of reusable question item ids', () => {
    expect(officialEventIdOf({
      kind: 'question',
      key: 'question:3',
      questions: [{ id: 'b' }, { id: 'a' }, { id: '', question: 'x' }],
    })).toBe('question:3')
    expect(officialEventIdOf({ kind: 'question', key: 'question:5', questions: [{ id: 'a' }] })).toBe('question:5')
  })

  it('degrades to the render key only when the event carries no stable identity', () => {
    expect(officialEventIdOf({ kind: 'question', key: 'question:4', questions: [] })).toBe('question:4')
  })
})

describe('advanceJobMemory', () => {
  it('treats the first sighting as baseline: completed/failed replay never notifies', () => {
    const memory = new Map<string, string>()
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'completed' })])).toEqual([])
    expect(memory.get(`${SID}\u0000j1`)).toBe('completed')
  })

  it('notifies once per job on the transition into completed/failed', () => {
    const memory = new Map<string, string>()
    advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'running' })])
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'completed' })])).toEqual([
      { sessionId: SID, jobId: 'j1', status: 'completed', label: 'dev server', kind: 'service' },
    ])
    // Terminal status repeated (replay/baseline refresh) must stay silent.
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'completed' })])).toEqual([])
    // A second job failing notifies independently after its own baseline.
    advanceJobMemory(memory, SID, [
      job({ id: 'j1', status: 'completed' }),
      job({ id: 'j2', status: 'running' }),
    ])
    expect(advanceJobMemory(memory, SID, [
      job({ id: 'j1', status: 'completed' }),
      job({ id: 'j2', status: 'failed' }),
    ])).toEqual([
      { sessionId: SID, jobId: 'j2', status: 'failed', label: 'dev server', kind: 'service' },
    ])
  })

  it('killed/stopping edges do not notify', () => {
    const memory = new Map<string, string>()
    advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'running' })])
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'killed' })])).toEqual([])
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'stopping' })])).toEqual([])
  })

  it('prunes departed jobs so a later re-arrival is a fresh baseline', () => {
    const memory = new Map<string, string>()
    advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'running' })])
    advanceJobMemory(memory, SID, [])
    expect(memory.size).toBe(0)
    expect(advanceJobMemory(memory, SID, [job({ id: 'j1', status: 'completed' })])).toEqual([])
  })
})

describe('compactLine', () => {
  it('collapses whitespace and bounds the line', () => {
    expect(compactLine('a\n  b\tc ')).toBe('a b c')
    expect(compactLine('x'.repeat(500))).toBe(`${'x'.repeat(400)}…`)
  })
})
