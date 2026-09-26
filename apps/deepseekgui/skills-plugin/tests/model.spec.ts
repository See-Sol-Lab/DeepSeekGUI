/**
 * Pure page logic of Settings → Skills: drafts, selections, and formatters.
 * @module @see-sol-lab/deepseekgui-skills/tests/model
 */
import { describe, expect, it } from 'vitest'
import type { SkillImportCandidate, SkillImportPreview } from '@deepseek-ai/dsh-skill-manager/types'
import { draftReady, draftsFrom, formatBytes, formatTime, issueKey, issueText, selectionsFrom } from '../src/client/model.ts'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

function candidate(over: Partial<SkillImportCandidate> = {}): SkillImportCandidate {
  return {
    key: 'SKILL.md',
    entry: 'SKILL.md',
    kind: 'skill',
    name: 'alpha',
    description: 'alpha description',
    proposed: {},
    issues: [],
    files: 1,
    bytes: 10,
    replaces: null,
    installable: true,
    ...over,
  }
}

function preview(candidates: SkillImportCandidate[]): SkillImportPreview {
  return { source: { kind: 'directory', path: 'E:/src/alpha' }, candidates, problems: [] }
}

describe('draftsFrom', () => {
  it('starts from declared metadata, then proposals, and selects installable candidates', () => {
    const drafts = draftsFrom(preview([
      candidate(),
      candidate({ key: 'docs/Plain.md', name: null, description: null, proposed: { name: 'plain', description: 'First line' } }),
      candidate({ key: 'bad/SKILL.md', name: null, description: null, proposed: {}, installable: false }),
    ]))
    expect(drafts).toEqual([
      { key: 'SKILL.md', selected: true, name: 'alpha', description: 'alpha description' },
      { key: 'docs/Plain.md', selected: true, name: 'plain', description: 'First line' },
      { key: 'bad/SKILL.md', selected: false, name: '', description: '' },
    ])
  })
})

describe('draftReady and selectionsFrom', () => {
  it('sends only selected, unblocked, complete drafts and omits unchanged fields', () => {
    const blocked = candidate({ key: 'b/SKILL.md', issues: [{ code: 'legacy-key', message: 'legacy' }] })
    const fixable = candidate({ key: 'c/SKILL.md', name: null, issues: [{ code: 'missing-name', message: 'm', fixable: true }], proposed: { name: 'gamma' } })
    const replacing = candidate({
      key: 'd/SKILL.md',
      name: 'delta',
      replaces: { installId: 'delta-00000001', name: 'delta', origin: { kind: 'zip', path: 'E:/old.zip', entry: 'SKILL.md' }, location: 'E:/lib/delta-00000001' },
    })
    const source = preview([candidate(), blocked, fixable, replacing, candidate({ key: 'e/SKILL.md' })])
    const drafts = draftsFrom(source)
    drafts[2]!.description = '  edited description  '
    drafts[4]!.selected = false
    expect(draftReady(blocked, drafts[1]!)).toBe(false)
    expect(draftReady(fixable, drafts[2]!)).toBe(true)
    expect(draftReady(candidate(), { key: 'SKILL.md', selected: true, name: ' ', description: 'd' })).toBe(false)
    expect(selectionsFrom(source, drafts)).toEqual([
      { key: 'SKILL.md', replaces: null },
      { key: 'c/SKILL.md', name: 'gamma', description: 'edited description', replaces: null },
      { key: 'd/SKILL.md', replaces: 'delta-00000001' },
    ])
    expect(selectionsFrom(source, [])).toEqual([])
  })
})

describe('issue text and formatters', () => {
  it('maps codes to locale keys and appends the path', () => {
    expect(issueKey('zip-unreadable')).toBe('issue.zip-unreadable')
    expect(issueText({ code: 'too-large', message: 'x' }, t)).toBe(zh['issue.too-large'])
    expect(issueText({ code: 'unsafe-path', message: 'x', path: '../a' }, t)).toBe(`${zh['issue.unsafe-path']} — ../a`)
  })

  it('formats sizes and times', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatTime('not a date')).toBe('not a date')
    expect(formatTime('2026-09-13T04:00:00.000Z')).toMatch(/2026/u)
  })
})
