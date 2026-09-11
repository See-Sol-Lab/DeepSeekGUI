/**
 * Pure row-model specs for the DeepSeekGUI tool-result cards (B5-P5). The
 * fixtures mirror the wire slices the client folds (RunningToolCall and
 * ToolResultNode) and the deterministic coding-tools render texts.
 * @module @see-sol-lab/deepseekgui-workbench/tests/tool-models
 */

import { describe, expect, it } from 'vitest'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  contentText,
  failureLine,
  firstLine,
  gitSummary,
  toolCardModel,
  type ToolCardModel,
} from '../src/client/cards/tool-models.ts'

/** A settled result node with one text content block. */
const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result',
  seq: 10,
  time: 2_000,
  callId: 'c1',
  call: { name: 'git_status', argsRaw: '{}' },
  callTime: 1_000,
  content: [{ type: 'text', text: 'clean on main' }],
  isError: false,
  subCalls: [],
  ...over,
})

/** A running call slice. */
const running = (name = 'git_status', argsRaw = '{}'): ToolCallBlock => ({
  callId: 'c1', name, argsRaw, turn: 1, step: 1, time: 1_000, subCalls: [],
} as unknown as ToolCallBlock)

const block = (node: ToolResultNode): ToolCallBlock => node as unknown as ToolCallBlock

describe('toolCardModel', () => {
  it('marks running slices and derives their argument label', () => {
    const model = toolCardModel(running('git_stage', '{"path":"src/a.ts"}'))
    expect(model.state).toBe('running')
    expect(model.settled).toBe(false)
    expect(model.output).toBeNull()
    expect(model.errorSummary).toBeNull()
    expect(model.summary).toBe('src/a.ts')
    expect(model.toolName).toBe('git_stage')
  })

  it('reads the settled text as output and the first line as the summary', () => {
    const model = toolCardModel(block(settled()))
    expect(model.state).toBe('ok')
    expect(model.output).toBe('clean on main')
    expect(model.summary).toBe('clean on main')
  })

  it('surfaces an error line and the error code when content is empty', () => {
    const node = settled({
      isError: true,
      error: { name: 'ApprovalRefused', code: 'user-approval' },
      content: [],
    })
    const model = toolCardModel(block(node))
    expect(model.state).toBe('error')
    expect(model.output).toBe('ApprovalRefused: user-approval')
    expect(model.errorSummary).toBe('ApprovalRefused: user-approval')
    expect(failureLine(block(node))).toBe('ApprovalRefused: user-approval')
  })

  it('keeps the first line of a verbose failure as the collapsed error line', () => {
    const node = settled({
      isError: true,
      content: [{ type: 'text', text: 'git_commit refused: this session is read-only\nmore detail' }],
    })
    const model = toolCardModel(block(node))
    expect(model.state).toBe('error')
    expect(model.errorSummary).toBe('git_commit refused: this session is read-only')
  })

  it('marks an interrupted result as stopped', () => {
    const node = settled({ isError: true, error: { name: 'Interrupted', code: 'interrupted' }, content: [] })
    expect(toolCardModel(block(node)).state).toBe('stopped')
  })
})

describe('git card projection', () => {
  const model = (meta: unknown, output: string | null = null): ToolCardModel => ({
    settled: true, meta, output, args: null, argsRaw: null, errorSummary: null,
    state: 'ok', toolName: 'git_status', callId: 'c1', time: 0, summary: '',
  } as unknown as ToolCardModel)

  it('reads entries and counts from the tool projection', () => {
    const view = gitSummary('git_status', model({
      kind: 'git-status', clean: false, head: 'on b5', upstream: null,
      counts: { staged: 1, unstaged: 1, untracked: 1, conflict: 0, total: 3 },
      entries: [
        { state: 'staged', path: 'src/a.ts', origPath: null },
        { state: 'unstaged', path: 'src/b.ts', origPath: null },
        { state: 'untracked', path: 'README.md', origPath: null },
      ],
    }))
    expect(view.counts).toEqual({ staged: 1, unstaged: 1, untracked: 1, conflict: 0, total: 3 })
    expect(view.summary).toBe('3 changed path(s), on b5')
  })

  it('reads diff files with line deltas', () => {
    const view = gitSummary('git_diff', model({
      kind: 'git-diff',
      files: [{ path: 'a.ts', binary: false, added: 3, deleted: 1 }, { path: 'i.png', binary: true, added: 0, deleted: 0 }],
    }))
    expect(view.diffFiles).toEqual([
      { path: 'a.ts', binary: false, added: 3, deleted: 1 },
      { path: 'i.png', binary: true, added: 0, deleted: 0 },
    ])
  })

  it('degrades to the rendered line when a call carries no projection', () => {
    expect(gitSummary('git_status', model(null, 'clean on main')).summary).toBe('clean on main')
  })
})

describe('contentText and firstLine', () => {
  it('flattens mixed blocks and falls back to the error code line', () => {
    const node = settled({
      content: [
        { type: 'text', text: 'a\nb' },
        { type: 'file', path: 'x' },
      ] as unknown as ToolResultNode['content'],
    })
    expect(contentText(node)).toBe('a\nb\n{\n  "type": "file",\n  "path": "x"\n}')
    const empty = settled({ content: [], isError: true, error: { name: 'E', code: 'boom' } })
    expect(contentText(empty)).toBe('E: boom')
  })

  it('firstLine keeps only the first physical line', () => {
    expect(firstLine('one\ntwo')).toBe('one')
  })
})
