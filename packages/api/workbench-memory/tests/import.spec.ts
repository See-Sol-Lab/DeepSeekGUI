/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { segmentMarkdown } from '../src/index.ts'
import { cleanup, mount, projectScope, temp, user, writeMemoryFile } from './support.ts'

afterEach(async () => { await cleanup() })

const LEGACY = [
  '# 全局偏好',
  '',
  '<!-- 编辑器注释 -->',
  '- 回答用中文。',
  '- 命令示例放在',
  '  fenced 代码块里。',
  '',
  '## 工具习惯',
  '',
  '1. 先看 git status 再动手。',
  '2) 不要自动推送。',
  '',
  'This is a paragraph that spans',
  'two lines under the tools heading.',
  '',
  '```bash',
  'pnpm test',
  '',
  '```',
  '---',
  '### 空标题',
  '',
  '#',
  '* 星号列表项',
  '+ 加号列表项',
  '',
].join('\n')

describe('segmentMarkdown', () => {
  it('cuts by headings, blank lines, list items and fences, keeping the heading path and line', () => {
    expect(segmentMarkdown(LEGACY)).toEqual([
      { headings: ['全局偏好'], line: 4, text: '- 回答用中文。' },
      { headings: ['全局偏好'], line: 5, text: '- 命令示例放在\n  fenced 代码块里。' },
      { headings: ['全局偏好', '工具习惯'], line: 10, text: '1. 先看 git status 再动手。' },
      { headings: ['全局偏好', '工具习惯'], line: 11, text: '2) 不要自动推送。' },
      { headings: ['全局偏好', '工具习惯'], line: 13, text: 'This is a paragraph that spans\ntwo lines under the tools heading.' },
      { headings: ['全局偏好', '工具习惯'], line: 16, text: '```bash\npnpm test\n\n```' },
      // A bare `#` is an empty level-one heading, as in CommonMark.
      { headings: [''], line: 24, text: '* 星号列表项' },
      { headings: [''], line: 25, text: '+ 加号列表项' },
    ])
  })

  it('handles CRLF, an unterminated fence, a deeper heading after a shallow one, and no headings at all', () => {
    expect(segmentMarkdown('plain\r\nline\r\n\r\n### deep\r\nunder deep\r\n# top\r\ntop text\r\n')).toEqual([
      { headings: [], line: 1, text: 'plain\nline' },
      { headings: ['', '', 'deep'], line: 5, text: 'under deep' },
      { headings: ['top'], line: 7, text: 'top text' },
    ])
    expect(segmentMarkdown('~~~\nopen\n')).toEqual([{ headings: [], line: 1, text: '~~~\nopen' }])
    expect(segmentMarkdown('')).toEqual([])
    expect(segmentMarkdown('\n\n   \n')).toEqual([])
  })
})

describe('preview and apply', () => {
  it('refuses a selected segment changed at the same line after preview', async () => {
    const { api, signal, home } = await mount()
    const path = join(home, 'memory.md')
    writeMemoryFile(path, '# Notes\n\nReviewed fact\n')
    const preview = await api.previewImport({ kind: 'global' }, signal)
    writeMemoryFile(path, '# Notes\n\nDifferent unreviewed fact\n')
    const result = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: preview.candidates[0]!.key }] }, signal)
    expect(result.written).toEqual([])
    expect(result.failedAt?.error.code).toBe('MEMORY_INVALID')
    expect(result.failedAt?.error.message).toContain('preview the file again')
    expect((await api.status(signal)).active).toBe(0)
    expect(readFileSync(path, 'utf8')).toContain('Different unreviewed fact')
  })

  it('previews the global file with duplicates marked and writes nothing', async () => {
    const harness = await mount()
    const { api, signal } = harness
    writeMemoryFile(join(harness.home, 'memory.md'), LEGACY)
    await api.remember({ scope: { kind: 'global' }, kind: 'preference', content: '- 回答用中文。', source: user }, signal)
    const preview = await api.previewImport({ kind: 'global' }, signal)
    expect(preview.path).toBe(join(harness.home, 'memory.md'))
    expect(preview.scope).toEqual({ kind: 'global' })
    expect(preview.problem).toBeUndefined()
    expect(preview.candidates).toHaveLength(8)
    expect(preview.candidates[0]).toEqual({
      key: key(4), headings: ['全局偏好'], line: 4, text: '- 回答用中文。', kind: 'preference', duplicateOf: 'm_000000000001',
    })
    expect(preview.candidates[1]?.duplicateOf).toBeNull()
    expect((await api.status(signal)).active).toBe(1)
    expect(readFileSync(join(harness.home, 'memory.md'), 'utf8')).toBe(LEGACY)
  })

  it('previews a project file under the folder scope and reports the file problems', async () => {
    const harness = await mount()
    const { api, signal } = harness
    const folder = join(temp('dsh-project-'), 'writing')
    mkdirSync(folder)
    const scope = await projectScope(harness, folder)
    const missing = await api.previewImport({ kind: 'project', cwd: folder }, signal)
    expect(missing).toEqual({ source: { kind: 'project', cwd: folder }, path: join(folder, 'writing.memory.md'), scope, problem: 'missing', candidates: [] })
    writeMemoryFile(join(folder, 'writing.memory.md'), '# Notes\n\nUses vitest.\n')
    const found = await api.previewImport({ kind: 'project', cwd: folder }, signal)
    expect(found.candidates).toEqual([{ key: key(3, '# Notes\n\nUses vitest.\n'), headings: ['Notes'], line: 3, text: 'Uses vitest.', kind: 'fact', duplicateOf: null }])
    writeMemoryFile(join(folder, 'writing.memory.md'), '# Only a heading\n\n')
    expect((await api.previewImport({ kind: 'project', cwd: folder }, signal)).problem).toBe('empty')
    const gone = await api.previewImport({ kind: 'project', cwd: join(harness.home, 'nowhere') }, signal)
    expect(gone).toMatchObject({ scope: null, problem: 'no-project', candidates: [] })
    const tight = await mount({ config: { importMaxBytes: 4 } })
    writeMemoryFile(join(tight.home, 'memory.md'), 'more than four bytes')
    expect((await tight.api.previewImport({ kind: 'global' }, tight.signal)).problem).toBe('too-large')
    // A directory where the file should be reads as unreadable, not as missing.
    mkdirSync(join(harness.home, 'memory.md'))
    expect((await api.previewImport({ kind: 'global' }, signal)).problem).toBe('unreadable')
  })

  it('imports the chosen segments with their origin, skips duplicates, honours edits, and leaves the file alone', async () => {
    const harness = await mount()
    const { api, signal } = harness
    writeMemoryFile(join(harness.home, 'memory.md'), LEGACY)
    await api.remember({ scope: { kind: 'global' }, kind: 'preference', content: '- 回答用中文。', source: user }, signal)
    const outcome = await api.applyImport({
      source: { kind: 'global' },
      sessionId: 's9',
      selections: [
        { key: key(4) },
        { key: key(5), content: '命令示例放在 fenced 代码块里。', keywords: ['style'] },
        { key: key(10), kind: 'fact' },
        { key: key(11), content: '2) 不要自动推送。' },
        { key: key(11) },
      ],
    }, signal)
    expect(outcome).toEqual({
      written: ['m_000000000002', 'm_000000000003', 'm_000000000004'],
      skipped: [{ key: key(4), duplicateOf: 'm_000000000001' }, { key: key(11), duplicateOf: 'm_000000000004' }],
    })
    const entries = (await api.list({ scope: { kind: 'global' } }, signal)).entries
    expect(entries.find(entry => entry.id === 'm_000000000002')).toMatchObject({
      kind: 'preference',
      content: '命令示例放在 fenced 代码块里。',
      keywords: ['style'],
      source: { kind: 'import', sessionId: 's9', detail: `${join(harness.home, 'memory.md')}#全局偏好`, evidence: 'line 5' },
    })
    expect(entries.find(entry => entry.id === 'm_000000000003')).toMatchObject({ kind: 'fact', source: { detail: expect.stringContaining('#全局偏好 > 工具习惯') } })
    expect(harness.changes.at(-1)).toEqual({ action: 'import', ids: ['m_000000000002', 'm_000000000003', 'm_000000000004'] })
    expect(readFileSync(join(harness.home, 'memory.md'), 'utf8')).toBe(LEGACY)
    // Re-importing the same file writes nothing new.
    const again = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: key(10) }, { key: key(4) }] }, signal)
    expect(again.written).toEqual([])
    expect(again.skipped).toHaveLength(2)
    expect(harness.changes.filter(change => change.action === 'import')).toHaveLength(1)
  })

  it('stops at the first failure and reports what landed', async () => {
    const harness = await mount({ config: { contentMaxBytes: 40 } })
    const { api, signal } = harness
    writeMemoryFile(join(harness.home, 'memory.md'), LEGACY)
    const outcome = await api.applyImport({
      source: { kind: 'global' },
      selections: [{ key: key(4) }, { key: key(13) }, { key: key(10) }],
    }, signal)
    expect(outcome.written).toEqual(['m_000000000001'])
    expect(outcome.failedAt).toEqual({ key: key(13), error: { code: 'MEMORY_INVALID', message: expect.stringContaining('40 bytes') } })
    expect((await api.status(signal)).active).toBe(1)
    const unknown = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: key(999) }] }, signal)
    expect(unknown).toEqual({ written: [], skipped: [], failedAt: { key: key(999), error: expect.objectContaining({ code: 'MEMORY_INVALID' }) } })
    rmSync(join(harness.home, 'memory.md'))
    const missing = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: key(4) }] }, signal)
    expect(missing.failedAt).toEqual({ key: key(4), error: expect.objectContaining({ code: 'MEMORY_INVALID', message: expect.stringContaining('missing') }) })
    expect(await api.applyImport({ source: { kind: 'global' }, selections: [] }, signal)).toEqual({ written: [], skipped: [] })
    const noProject = await api.applyImport({ source: { kind: 'project', cwd: join(harness.home, 'nowhere') }, selections: [{ key: key(1) }] }, signal)
    expect(noProject.failedAt?.error.message).toContain('no-project')
  })

  it('stops when the backend refuses a write mid-import and keeps the earlier entries', async () => {
    const harness = await mount()
    const { api, signal } = harness
    writeMemoryFile(join(harness.home, 'memory.md'), LEGACY)
    const first = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: key(4) }] }, signal)
    expect(first.written).toHaveLength(1)
    rmSync(join(harness.domainRoot, 'entries'), { recursive: true, force: true })
    writeFileSync(join(harness.domainRoot, 'entries'), 'blocked')
    const outcome = await api.applyImport({ source: { kind: 'global' }, selections: [{ key: key(4) }, { key: key(10) }, { key: key(11) }] }, signal)
    expect(outcome).toEqual({
      written: [],
      skipped: [{ key: key(4), duplicateOf: 'm_000000000001' }],
      failedAt: { key: key(10), error: expect.objectContaining({ code: 'MEMORY_IO' }) },
    })
    expect((await api.list({ scope: { kind: 'all' } }, signal)).entries.map(entry => entry.content)).toEqual(['- 回答用中文。'])
  })
})

function key(line: number, text = LEGACY): string {
  const segment = segmentMarkdown(text).find(item => item.line === line)
  return segment === undefined ? 'missing-' + String(line) : 'L' + String(line) + ':' + createHash('sha256').update(JSON.stringify(segment)).digest('hex')
}
