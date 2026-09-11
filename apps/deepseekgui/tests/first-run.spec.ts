/**
 * First-run guide durable facts (B6-P5): eligibility is decided once, an
 * upgrade with conversations is never shown the guide, a half-finished user
 * finds it again after a restart, and a damaged file fails closed.
 * @module @see-sol-lab/deepseekgui/tests/first-run
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FIRST_RUN_FILENAME, isFirstRunPending, markFirstRunCompleted,
  parseFirstRunState, readFirstRunState, resolveFirstRunState, writeFirstRunState,
} from '../src/first-run.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-first-run-')); roots.push(dir); return dir
}

describe('resolveFirstRunState', () => {
  it('marks a fresh Managed Home eligible and persists the decision', () => {
    const dir = userData()
    const state = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true })
    expect(state).toEqual({ schemaVersion: 1, eligible: true, completedAt: null })
    expect(isFirstRunPending(state)).toBe(true)
    expect(existsSync(join(dir, FIRST_RUN_FILENAME))).toBe(true)
    expect(readFileSync(join(dir, FIRST_RUN_FILENAME), 'utf8').endsWith('\n')).toBe(true)
  })

  it('marks a Managed Home that already has conversations ineligible (upgrade)', () => {
    const dir = userData()
    const state = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 3, sessionsReadable: true })
    expect(state).toEqual({ schemaVersion: 1, eligible: false, completedAt: null })
    expect(isFirstRunPending(state)).toBe(false)
  })

  it('never shows the guide for an Existing Home', () => {
    const dir = userData()
    expect(isFirstRunPending(resolveFirstRunState({ userDataDir: dir, homeKind: 'existing', sessionCount: 0, sessionsReadable: true }))).toBe(false)
  })

  it('defers the decision when the sessions sweep could not read, rather than calling an existing user new', () => {
    // A count of zero from an unreadable sweep is indistinguishable from a
    // genuinely empty home, and this decision is persisted once and never
    // revisited — deciding here would mark an existing user as new for good.
    const dir = userData()
    expect(resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: false })).toBeNull()
    expect(existsSync(join(dir, FIRST_RUN_FILENAME))).toBe(false)

    // The next launch decides normally once the sweep succeeds.
    const later = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 3, sessionsReadable: true })
    expect(later).toEqual({ schemaVersion: 1, eligible: false, completedAt: null })
  })

  it('keeps a half-finished user eligible after a restart that now has conversations', () => {
    const dir = userData()
    const first = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true })
    expect(isFirstRunPending(first)).toBe(true)
    // The user created a conversation and restarted: the persisted eligibility
    // wins, so the guide is still there where they left it.
    const second = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 1, sessionsReadable: true })
    expect(second).toEqual(first)
    expect(isFirstRunPending(second)).toBe(true)
  })

  it('stays hidden after completion, restart after restart', () => {
    const dir = userData()
    const state = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true })
    const done = markFirstRunCompleted(dir, state, new Date('2026-09-10T00:00:00.000Z'))
    expect(done?.completedAt).toBe('2026-09-10T00:00:00.000Z')
    expect(isFirstRunPending(done)).toBe(false)
    expect(isFirstRunPending(resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true }))).toBe(false)
  })

  it('fails closed on a damaged state file instead of nagging', () => {
    const dir = userData()
    writeFileSync(join(dir, FIRST_RUN_FILENAME), '{ not json', 'utf8')
    const read = readFirstRunState(dir)
    expect(read.state).toBeNull()
    expect(read.error).toContain('not valid JSON')
    expect(resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true })).toBeNull()
    expect(isFirstRunPending(null)).toBe(false)
  })
})

describe('first-run state file', () => {
  it('rejects unknown fields and unsupported versions', () => {
    expect(() => parseFirstRunState(JSON.stringify({ schemaVersion: 1, eligible: true, completedAt: null, extra: 1 })))
      .toThrow('unknown field "extra"')
    expect(() => parseFirstRunState(JSON.stringify({ schemaVersion: 2, eligible: true, completedAt: null })))
      .toThrow('unsupported schemaVersion 2')
    expect(() => parseFirstRunState(JSON.stringify({ schemaVersion: 1, eligible: 'yes', completedAt: null })))
      .toThrow('eligible must be a boolean')
    expect(() => parseFirstRunState(JSON.stringify({ schemaVersion: 1, eligible: true, completedAt: 5 })))
      .toThrow('completedAt must be a string or null')
  })

  it('is idempotent when completion is recorded twice', () => {
    const dir = userData()
    const state = resolveFirstRunState({ userDataDir: dir, homeKind: 'managed', sessionCount: 0, sessionsReadable: true })
    const first = markFirstRunCompleted(dir, state, new Date('2026-09-10T01:00:00.000Z'))
    const second = markFirstRunCompleted(dir, first, new Date('2026-09-10T02:00:00.000Z'))
    expect(second).toEqual(first)
    expect(readFirstRunState(dir).state).toEqual(first)
  })

  it('round-trips a written state and reports a missing file as never resolved', () => {
    const dir = userData()
    expect(readFirstRunState(dir)).toEqual({ state: null, error: null })
    writeFirstRunState(dir, { schemaVersion: 1, eligible: true, completedAt: null })
    expect(readFirstRunState(dir)).toEqual({
      state: { schemaVersion: 1, eligible: true, completedAt: null },
      error: null,
    })
  })
})
