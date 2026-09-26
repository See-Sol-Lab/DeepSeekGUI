/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { readZip, safeArchivePath } from '../src/zip.ts'

const limits = { maxFileBytes: 1024, maxTotalBytes: 4096, maxFiles: 3 }
const text = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('safeArchivePath', () => {
  it('accepts plain relative paths', () => {
    expect(safeArchivePath('SKILL.md')).toBe('SKILL.md')
    expect(safeArchivePath('scripts/run.py')).toBe('scripts/run.py')
    expect(safeArchivePath('assets/图.png')).toBe('assets/图.png')
  })

  it('refuses everything that could escape or confuse the install directory', () => {
    for (const raw of [
      '', 'dir/', '../SKILL.md', 'a/../../b', '/etc/passwd', 'C:evil', 'c:/evil', 'a\\b', 'a//b', './a', 'a/./b',
      'a\u0000b', 'a\u001fb', 'a\u007f', 'trailing.', 'trailing ', 'ntfs:stream', 'dir/name.',
      // Windows-invalid name characters: rejected on every platform so an
      // archive that installs on Linux never dies mid-write on Windows.
      'a<b', 'a>b', 'quo"te', 'pi|pe', 'ques?tion', 'st*ar', 'dir/we<ird.md',
    ]) {
      expect(safeArchivePath(raw), raw).toBeUndefined()
    }
  })
})

describe('readZip', () => {
  it.each([
    { maxFiles: 1, maxTotalBytes: 4096 },
    { maxFiles: 3, maxTotalBytes: 100 },
  ])('does not inflate an entry after the aggregate cap: %j', (cap) => {
    const bytes = zipSync({ 'first.bin': new Uint8Array(100), 'second.bin': new Uint8Array(100) })
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const second = 30 + header.getUint16(26, true) + header.getUint16(28, true) + header.getUint32(18, true)
    const payload = second + 30 + header.getUint16(second + 26, true) + header.getUint16(second + 28, true)
    // Invalid DEFLATE block type: reading this payload would fail the whole archive.
    bytes[payload] = 7
    const result = readZip(bytes, { ...limits, ...cap })
    expect(result.entries.map(entry => entry.path)).toEqual(['first.bin'])
    expect(result.problems[0]?.code).toBe(cap.maxFiles === 1 ? 'too-many-files' : 'too-large')
  })

  it('reads safe entries and skips directory entries', () => {
    const bytes = zipSync({ 'SKILL.md': text('---\nname: a\n---\n'), 'scripts/': new Uint8Array(), 'scripts/x.sh': text('echo') })
    const contents = readZip(bytes, limits)
    expect(contents.problems).toEqual([])
    expect(contents.entries.map(entry => entry.path)).toEqual(['SKILL.md', 'scripts/x.sh'])
    expect(new TextDecoder().decode(contents.entries[1]!.data)).toBe('echo')
  })

  it('reports an unreadable archive without entries', () => {
    const contents = readZip(text('this is not a zip'), limits)
    expect(contents.entries).toEqual([])
    expect(contents.problems).toEqual([{ code: 'zip-unreadable', message: expect.stringContaining('cannot be read') }])
  })

  it('excludes unsafe and colliding paths and reports each', () => {
    const bytes = zipSync({ '../escape.md': text('x'), 'SKILL.md': text('a'), 'skill.MD': text('b'), 'ok.txt': text('c') })
    const contents = readZip(bytes, limits)
    expect(contents.entries.map(entry => entry.path)).toEqual(['SKILL.md', 'ok.txt'])
    expect(contents.problems).toEqual([
      { code: 'unsafe-path', message: expect.stringContaining('not a safe'), path: '../escape.md' },
      { code: 'unsafe-path', message: expect.stringContaining('collides'), path: 'skill.MD' },
    ])
  })

  it('drops oversized entries before inflating them', () => {
    const bytes = zipSync({ 'big.bin': new Uint8Array(2048), 'SKILL.md': text('ok') })
    const contents = readZip(bytes, limits)
    expect(contents.entries.map(entry => entry.path)).toEqual(['SKILL.md'])
    expect(contents.problems).toEqual([{ code: 'too-large', message: expect.stringContaining('1024'), path: 'big.bin' }])
  })

  it('stops at the file count cap', () => {
    const bytes = zipSync({ 'a.md': text('1'), 'b.md': text('2'), 'c.md': text('3'), 'd.md': text('4') })
    const contents = readZip(bytes, limits)
    expect(contents.entries).toHaveLength(3)
    expect(contents.problems).toEqual([{ code: 'too-many-files', message: expect.stringContaining('3'), path: 'd.md' }])
  })

  it('stops at the total byte cap', () => {
    const bytes = zipSync({ 'a.bin': new Uint8Array(1000), 'b.bin': new Uint8Array(1000), 'c.bin': new Uint8Array(1000), 'd.bin': new Uint8Array(1000) })
    const contents = readZip(bytes, { ...limits, maxFiles: 10, maxTotalBytes: 2500 })
    expect(contents.entries.map(entry => entry.path)).toEqual(['a.bin', 'b.bin'])
    expect(contents.problems).toEqual([{ code: 'too-large', message: expect.stringContaining('2500'), path: 'c.bin' }])
  })
})
