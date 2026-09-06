/**
 * Pure aggregation specs for the on-demand inspectors (B5-P5): Files /
 * Changes / Git·Review rows derived from the loaded-window Chat nodes.
 * @module @see-sol-lab/deepseekgui-workbench/tests/history-model
 */

import { describe, expect, it } from 'vitest'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  hasRunning,
  historyOf,
  reviewHistory,
  type HistoryToolEntry,
} from '../src/client/inspector/history-model.ts'

const result = (over: {
  name: string
  argsRaw: string
  text?: string
  seq?: number
  time?: number
  error?: boolean
  meta?: unknown
}): ToolCallBlock => ({
  kind: 'tool-result',
  seq: over.seq ?? 10,
  meta: over.meta,
  time: over.time ?? 2_000,
  callId: `c-${over.name}-${String(over.seq ?? 0)}`,
  call: { name: over.name, argsRaw: over.argsRaw },
  callTime: 1_000,
  content: over.text === undefined ? [] : [{ type: 'text', text: over.text }],
  isError: over.error === true,
  subCalls: [],
} as unknown as ToolCallBlock)

const runningCall = (name: string): ToolCallBlock => ({
  callId: 'c-run', name, argsRaw: '{}', turn: 1, step: 1, time: 500, subCalls: [],
} as unknown as ToolCallBlock)

/** One Chat window node wrapper. */
const node = (anchorSeq: number, root: ToolCallBlock, visibility = 'visible') => ({
  kind: 'tool-call',
  id: String(anchorSeq),
  key: String(anchorSeq),
  target: 'chat',
  anchorSeq,
  visibility,
  data: { root },
})

const STATUS_DIRTY = '2 changed path(s), on main:\n- staged src/a.ts\n- untracked src/new.ts'
const STATUS_DIRTY_META = {
  kind: 'git-status', clean: false, head: 'on main',
  counts: { staged: 1, unstaged: 0, untracked: 1, conflict: 0, total: 2 },
  entries: [
    { state: 'staged', path: 'src/a.ts', origPath: null },
    { state: 'untracked', path: 'src/new.ts', origPath: null },
  ],
}
const CLEAN_META = { kind: 'git-status', clean: true, head: 'on main', counts: { staged: 0, unstaged: 0, untracked: 0, conflict: 0, total: 0 }, entries: [] }
const DIFF_TEXT = '- src/a.ts +2 -1\n- src/b.ts (binary)'
const DIFF_META = {
  kind: 'git-diff',
  files: [
    { path: 'src/a.ts', origPath: null, binary: false, added: 2, deleted: 1 },
    { path: 'src/b.ts', origPath: null, binary: true, added: 0, deleted: 0 },
  ],
}
const nodeResult = (over: Parameters<typeof result>[0]): ToolResultNode =>
  result(over) as unknown as ToolResultNode

describe('historyOf', () => {
  it('flattens visible tool-call nodes in window order', () => {
    const entries = historyOf([
      node(1, result({ name: 'git_status', argsRaw: '{}', text: STATUS_DIRTY, meta: STATUS_DIRTY_META })),
      node(2, runningCall('git_diff')),
    ])
    expect(entries.map(entry => entry.toolName)).toEqual(['git_status', 'git_diff'])
    expect(entries[0]).toMatchObject({ seq: 1, state: 'ok', text: STATUS_DIRTY, meta: STATUS_DIRTY_META })
    expect(entries[1]).toMatchObject({ state: 'running', text: null })
  })

  it('descends into sub-calls: git tools driven from run_code (PTC mode) still count', () => {
    const commit = result({ name: 'git_commit', argsRaw: '{}', text: 'committed abc123', seq: 5, time: 1_500 })
    const push = result({ name: 'git_push', argsRaw: '{}', text: 'pushed abc123', seq: 6, time: 1_600 })
    const runCode = { ...result({ name: 'run_code', argsRaw: '{}', text: 'done', seq: 4 }), subCalls: [commit, push] } as unknown as ToolCallBlock
    const entries = historyOf([node(9, runCode)])
    expect(entries.map(entry => entry.toolName)).toEqual(['run_code', 'git_commit', 'git_push'])
    expect(entries.map(entry => entry.seq)).toEqual([9, 5, 6])
    expect(reviewHistory(entries).map(row => row.toolName)).toEqual(['git_push', 'git_commit'])
  })

  it('skips hidden nodes and non-tool kinds', () => {
    const entries = historyOf([
      { kind: 'assistant', id: 'a', key: 'a', target: 'chat', anchorSeq: 0, visibility: 'visible', data: {} },
      node(1, result({ name: 'git_status', argsRaw: '{}', text: 'clean on main', meta: CLEAN_META }), 'hidden'),
      node(2, result({ name: 'git_status', argsRaw: '{}', text: 'clean on main', meta: CLEAN_META })),
    ])
    expect(entries).toHaveLength(1)
  })
})

describe('reviewHistory', () => {
  it('lists commit/push/PR outcomes newest-first', () => {
    const rows = reviewHistory(historyOf([
      node(1, result({ name: 'git_commit', argsRaw: '{"message":"fix"}', text: 'committed abc123', seq: 1, time: 1_000 })),
      node(2, result({ name: 'pr_create', argsRaw: '{}', text: 'pull request created: #5 https://x', seq: 2, time: 2_000 })),
    ]))
    expect(rows.map(row => row.toolName)).toEqual(['pr_create', 'git_commit'])
    expect(rows[1]?.summary).toBe('committed abc123')
  })

  it('excludes running calls and flags errors', () => {
    const rows = reviewHistory(historyOf([
      node(1, runningCall('git_commit')),
      node(2, result({ name: 'git_push', argsRaw: '{}', seq: 2, error: true, text: 'push refused' })),
    ]))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ toolName: 'git_push', error: true, summary: 'push refused' })
  })

  it('answers empty for unrelated windows', () => {
    expect(reviewHistory([])).toEqual([])
  })
})

describe('hasRunning', () => {
  it('detects in-flight tool calls', () => {
    expect(hasRunning(historyOf([node(1, runningCall('git_status'))]))).toBe(true)
    expect(hasRunning(historyOf([node(1, nodeResult({ name: 'git_status', argsRaw: '{}', text: 'clean' }))]))).toBe(false)
  })
})
