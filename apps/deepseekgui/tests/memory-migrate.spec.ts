/**
 * 增强记忆条目迁回 Markdown（住户 2026-09-29）：有效条目追加进全局 memory.md
 * 与项目 `<文件夹名>.memory.md`，按文字去重；墓碑、接续记录、坏文件不迁；
 * 项目文件夹不在的条目留在备份；旧目录原样保留，标记之后不再重复。
 * 只用临时目录，不碰真实数据。
 * @module @see-sol-lab/deepseekgui/tests/memory-migrate
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATION_MARKER, migrateMemoryEntries } from '../src/memory-migrate.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function temp(): string {
  const root = mkdtempSync(join(tmpdir(), 'deepseekgui-memory-migrate-'))
  roots.push(root)
  return root
}

/** 按旧服务的落盘格式写一条记录：`{ version, record }`。 */
function writeRecord(home: string, id: string, record: unknown): void {
  const dir = join(home, 'storages', 'deepseekgui_memory', 'entries')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({ version: 1, record }, null, 2)}\n`)
}

function active(content: string, scope: unknown, createdAt: string, kind = 'fact'): unknown {
  return { state: 'active', entry: { id: 'm_000000000000', scope, kind, content, source: { kind: 'user', at: createdAt }, version: 1, createdAt, updatedAt: createdAt } }
}

const NOW = new Date('2026-09-29T12:00:00Z')

describe('migrateMemoryEntries', () => {
  it('从没用过条目模式：什么都不做', () => {
    const home = temp()
    expect(migrateMemoryEntries(home, 'zh', NOW)).toEqual({ skipped: true, appended: 0, duplicates: 0, orphaned: 0, files: [] })
    expect(existsSync(join(home, 'storages'))).toBe(false)
  })

  it('全局与项目条目按时间追加进各自的文件，已有的文字不重复，旧目录留作备份', () => {
    const home = temp()
    const project = join(temp(), 'my-app')
    mkdirSync(project)
    writeFileSync(join(home, 'memory.md'), '# 全局记忆\n\n- 回复用中文\n', 'utf8')
    writeRecord(home, 'm_a', active('回复用中文', { kind: 'global' }, '2026-09-20T00:00:00Z', 'preference'))
    writeRecord(home, 'm_b', active('用户昵称是小林', { kind: 'global' }, '2026-09-21T00:00:00Z'))
    writeRecord(home, 'm_c', active('测试命令是 pnpm test\n改完先跑 lint', { kind: 'project', projectKey: 'k', path: project }, '2026-09-22T00:00:00Z'))
    writeRecord(home, 'm_d', active('发布前更新 CHANGELOG', { kind: 'project', projectKey: 'k', path: project }, '2026-09-21T00:00:00Z'))
    writeRecord(home, 'm_e', active('同一句话', { kind: 'global' }, '2026-09-23T00:00:00Z'))
    writeRecord(home, 'm_f', active('同一句话 ', { kind: 'global' }, '2026-09-24T00:00:00Z'))

    const result = migrateMemoryEntries(home, 'zh', NOW)
    expect(result).toMatchObject({ skipped: false, appended: 4, duplicates: 2, orphaned: 0 })
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe('# 全局记忆\n\n- 回复用中文\n\n## 从记忆条目迁回（2026-09-29）\n\n- 用户昵称是小林\n- 同一句话\n')
    expect(readFileSync(join(project, 'my-app.memory.md'), 'utf8')).toBe('## 从记忆条目迁回（2026-09-29）\n\n- 发布前更新 CHANGELOG\n- 测试命令是 pnpm test\n  改完先跑 lint\n')
    expect(result.files).toEqual([join(home, 'memory.md'), join(project, 'my-app.memory.md')])
    // 旧条目原样保留，旁边多一个说明标记。
    expect(readdirSync(join(home, 'storages', 'deepseekgui_memory', 'entries'))).toHaveLength(6)
    expect(readFileSync(join(home, 'storages', 'deepseekgui_memory', MIGRATION_MARKER), 'utf8')).toContain('追加 4 条')

    // 标记之后再启动：不再动文件。
    writeFileSync(join(home, 'memory.md'), '用户后来改过', 'utf8')
    expect(migrateMemoryEntries(home, 'zh', NOW).skipped).toBe(true)
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe('用户后来改过')
  })

  it('去重保留相反的内容和大小写不同的路径', () => {
    const home = temp()
    writeFileSync(join(home, 'memory.md'), '- 不使用 Python\n- 路径使用 Foo\n')
    writeRecord(home, 'm_a', active('使用 Python', { kind: 'global' }, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_b', active('路径使用 foo', { kind: 'global' }, '2026-09-21T00:00:00Z'))
    expect(migrateMemoryEntries(home, 'zh', NOW)).toMatchObject({ appended: 2, duplicates: 0 })
    const text = readFileSync(join(home, 'memory.md'), 'utf8')
    expect(text).toContain('- 不使用 Python\n- 路径使用 Foo\n')
    expect(text).toContain('- 使用 Python\n- 路径使用 foo\n')
  })

  it('完整匹配已有的多行列表项和独立原文', () => {
    const home = temp()
    const original = '# Memory\r\n\r\n- First line\r\n  Second line\r\n\r\nPlain fact\r\n'
    writeFileSync(join(home, 'memory.md'), original)
    writeRecord(home, 'm_a', active('First line\nSecond line', { kind: 'global' }, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_b', active('Plain fact', { kind: 'global' }, '2026-09-21T00:00:00Z'))
    expect(migrateMemoryEntries(home, 'en', NOW)).toMatchObject({ appended: 0, duplicates: 2 })
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe(original)
  })

  it('墓碑、接续记录、坏文件、形状不对的不迁；项目文件夹不在的留在备份', () => {
    const home = temp()
    writeRecord(home, 'm_a', { state: 'forgotten', id: 'm_a', scope: { kind: 'global' }, version: 2, forgottenAt: '2026-09-20T00:00:00Z' })
    writeRecord(home, 'm_b', active('下一步做 X', { kind: 'global' }, '2026-09-20T00:00:00Z', 'continuation'))
    writeRecord(home, 'm_c', active('那个项目的事', { kind: 'project', projectKey: 'k', path: join(home, 'gone') }, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_d', active('   ', { kind: 'global' }, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_e', active('没有作用域', null, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_f', active('未知作用域', { kind: 'team' }, '2026-09-20T00:00:00Z'))
    writeRecord(home, 'm_g', { state: 'active', entry: null })
    writeRecord(home, 'm_h', 'not a record')
    writeFileSync(join(home, 'storages', 'deepseekgui_memory', 'entries', 'm_i.json'), '{ broken')
    const result = migrateMemoryEntries(home, 'en', NOW)
    expect(result).toEqual({ skipped: false, appended: 0, duplicates: 0, orphaned: 1, files: [] })
    expect(existsSync(join(home, 'memory.md'))).toBe(false)
    expect(readFileSync(join(home, 'storages', 'deepseekgui_memory', MIGRATION_MARKER), 'utf8')).toContain('1 whose project folder no longer exists')
  })

  it('没有信封的记录也认；英文标题；原文末尾没有换行也能接上', () => {
    const home = temp()
    const dir = join(home, 'storages', 'deepseekgui_memory', 'entries')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'm_a.json'), JSON.stringify(active('plain record', { kind: 'global' }, '')))
    writeFileSync(join(home, 'memory.md'), 'no trailing newline', 'utf8')
    expect(migrateMemoryEntries(home, 'en', NOW).appended).toBe(1)
    expect(readFileSync(join(home, 'memory.md'), 'utf8')).toBe('no trailing newline\n\n## Moved back from memory entries (2026-09-29)\n\n- plain record\n')
  })
})
