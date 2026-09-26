/**
 * Pure helpers of the memory pages (B7-P9): the used-memory record read
 * from Chat context rows, the Markdown export, and the small formatters.
 * @module @see-sol-lab/deepseekgui-workbench/tests/memory-model
 */
import { describe, expect, it } from 'vitest'
import type { MemoryEntry } from '@deepseek-ai/dsh-workbench-memory/types'
import { exportMarkdown, formatTime, keywordsFrom, oneLine, usedMemoryOf } from '../src/client/memory/model.ts'

const recall = (seq: number, entries: unknown[], extra: Record<string, unknown> = {}) => ({
  kind: 'context',
  data: { seq, source: { kind: 'deepseekgui-memory', form: 'recall', query: 'which port?', entries, omitted: 0, ...extra } },
})

describe('usedMemoryOf', () => {
  it('takes the newest well-formed recall record and ignores other context rows and malformed sources', () => {
    const nodes = [
      { kind: 'user', data: { seq: 1 } },
      recall(2, [{ id: 'm_1', version: 1, scope: 'project', kind: 'fact' }]),
      { kind: 'context', data: { seq: 3, source: { kind: 'skill-invocation', name: 'x' } } },
      recall(4, [{ id: 'm_1', version: 2, scope: 'project', kind: 'fact' }, { id: 'm_2', version: 1, scope: 'global', kind: 'preference' }], { update: true, omitted: 3 }),
      recall(5, [{ id: 1 }]),
      recall(6, [{ id: 'm_3', version: 1, scope: 'nowhere', kind: 'fact' }]),
      recall(7, [{ id: 'm_3', version: 1, scope: 'global', kind: 'rule' }]),
      recall(8, [null]),
      { kind: 'context', data: { seq: 9, source: { kind: 'deepseekgui-memory', form: 'other', query: 'q', entries: [] } } },
      { kind: 'context', data: null },
      { kind: 'context', data: { seq: 'x', source: {} } },
    ]
    expect(usedMemoryOf(nodes)).toEqual({
      seq: 4,
      query: 'which port?',
      entries: [{ id: 'm_1', version: 2, scope: 'project', kind: 'fact' }, { id: 'm_2', version: 1, scope: 'global', kind: 'preference' }],
      omitted: 3,
      update: true,
    })
    expect(usedMemoryOf([])).toBeUndefined()
    expect(usedMemoryOf([recall(1, [], { omitted: 'many' })])).toEqual({ seq: 1, query: 'which port?', entries: [], omitted: 0, update: false })
  })
})

describe('exportMarkdown', () => {
  const entry = (id: string, kind: MemoryEntry['kind'], content: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({
    id, kind, content, scope: { kind: 'global' }, source: { kind: 'user', at: 't' }, version: 1, createdAt: 't', updatedAt: 't', ...over,
  })
  it('groups by kind in the fixed order, keeps ids, versions, scopes and keywords, and indents multi-line content', () => {
    const text = exportMarkdown([
      entry('m_2', 'preference', 'Answer in Chinese', { keywords: ['language', 'reply'] }),
      entry('m_1', 'fact', 'Goal: ship\nDecided:\n- x', { scope: { kind: 'project', projectKey: 'k', path: 'p' }, version: 3 }),
      entry('m_3', 'continuation', 'Left off at the seam'),
    ], { title: '导出', kind: kind => `K:${kind}`, scope: scope => `S:${scope}` })
    expect(text).toBe([
      '# 导出', '',
      '## K:fact', '',
      '- Goal: ship (#m_1 v3, S:project)',
      '  Decided:',
      '  - x',
      '',
      '## K:preference', '',
      '- Answer in Chinese (#m_2 v1, S:global) — language, reply',
      '',
      '## K:continuation', '',
      '- Left off at the seam (#m_3 v1, S:global)',
      '',
    ].join('\n'))
    expect(exportMarkdown([], { title: 'T', kind: kind => kind, scope: scope => scope })).toBe('# T\n')
  })
})

describe('formatters', () => {
  it('splits keywords on either comma, trims, dedupes and drops blanks', () => {
    expect(keywordsFrom(' build , deploy，build,, ')).toEqual(['build', 'deploy'])
    expect(keywordsFrom('')).toEqual([])
  })
  it('collapses whitespace and cuts long content with an ellipsis', () => {
    expect(oneLine('  a \n b  ')).toBe('a b')
    expect(oneLine('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
  })
  it('formats a readable time and leaves an unreadable one empty', () => {
    expect(formatTime('not a time')).toBe('')
    expect(formatTime('2026-09-13T12:00:00.000Z')).not.toBe('')
  })
})
