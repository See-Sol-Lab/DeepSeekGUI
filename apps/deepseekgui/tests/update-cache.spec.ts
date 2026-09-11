/**
 * update-cache 测试（P11）：single-slot 缓存目录准备、partial → verified
 * 改名、verified 记录的严格读写。全部使用合成临时目录，不触碰真实用户数据。
 * @module @see-sol-lab/deepseekgui/tests/update-cache
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  prepareUpdateCache,
  promoteVerifiedFile,
  readVerifiedRecord,
  updateCacheDir,
  VERIFIED_RECORD_FILENAME,
  writeVerifiedRecord,
} from '../src/update-cache.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时 userData 目录。 */
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-update-cache-'))
  roots.push(dir)
  return dir
}

const DIGEST = 'a'.repeat(64)

describe('updateCacheDir', () => {
  it('固定为 userData 下的 updates 目录', () => {
    const userData = temp()
    expect(updateCacheDir(userData)).toBe(join(userData, 'updates'))
  })
})

describe('prepareUpdateCache', () => {
  it('建目录并清掉其中的文件（single-slot：目录内最多一份产物）；不是我们放的子目录不递归删', () => {
    const dir = join(temp(), 'updates')
    mkdirSync(join(dir, 'nested'), { recursive: true })
    writeFileSync(join(dir, 'old-setup.exe'), 'old')
    writeFileSync(join(dir, 'nested', 'leftover.partial'), 'partial')
    prepareUpdateCache(dir)
    expect(existsSync(join(dir, 'old-setup.exe'))).toBe(false)
    expect(existsSync(join(dir, 'nested', 'leftover.partial'))).toBe(true)
  })

  it('目录不存在时创建它', () => {
    const dir = join(temp(), 'missing', 'updates')
    prepareUpdateCache(dir)
    expect(existsSync(dir)).toBe(true)
  })
})

describe('promoteVerifiedFile', () => {
  it('改名成功返回 null，最终文件就位、临时文件消失', () => {
    const dir = temp()
    const partial = join(dir, 'setup.exe.partial')
    const verified = join(dir, 'setup.exe')
    writeFileSync(partial, 'verified bytes')
    expect(promoteVerifiedFile(partial, verified)).toBeNull()
    expect(existsSync(verified)).toBe(true)
    expect(existsSync(partial)).toBe(false)
    expect(readFileSync(verified, 'utf8')).toBe('verified bytes')
  })

  it('改名失败时删掉临时文件并返回原因，绝不留下半截产物冒充就绪', () => {
    const dir = temp()
    const partial = join(dir, 'setup.exe.partial')
    // 目标名被一个非空目录占住：改名必然失败。
    const verified = join(dir, 'setup.exe')
    mkdirSync(join(verified, 'occupied'), { recursive: true })
    writeFileSync(partial, 'verified bytes')
    const failure = promoteVerifiedFile(partial, verified)
    expect(failure).not.toBeNull()
    expect(existsSync(partial)).toBe(false)
  })
})

describe('verified 记录', () => {
  it('往返：写进去的事实原样读回', () => {
    const dir = temp()
    const path = join(dir, 'DeepSeekGUI-Setup-1.2.0.exe')
    writeFileSync(path, 'bytes')
    writeVerifiedRecord(dir, { path, sha256: DIGEST, version: '1.2.0' })
    expect(readVerifiedRecord(dir)).toEqual({ path, sha256: DIGEST, version: '1.2.0' })
  })

  it.each([
    ['记录不存在', () => undefined],
    ['不是 JSON', (dir: string) => { writeFileSync(join(dir, VERIFIED_RECORD_FILENAME), '{ oops') }],
    ['顶层是数组', (dir: string) => { writeFileSync(join(dir, VERIFIED_RECORD_FILENAME), '[]') }],
    ['字段类型不符', (dir: string) => { writeFileSync(join(dir, VERIFIED_RECORD_FILENAME), '{"path":1,"sha256":"x","version":"1"}') }],
    ['摘要非法', (dir: string) => { writeFileSync(join(dir, VERIFIED_RECORD_FILENAME), JSON.stringify({ path: join(dir, 'a.exe'), sha256: 'nope', version: '1' })) }],
    ['版本为空', (dir: string) => { writeFileSync(join(dir, VERIFIED_RECORD_FILENAME), JSON.stringify({ path: join(dir, 'a.exe'), sha256: DIGEST, version: '' })) }],
  ])('fail closed：%s 一律当没有记录', (_label, setup) => {
    const dir = temp()
    setup(dir)
    expect(readVerifiedRecord(dir)).toBeNull()
  })

  it('目标文件已不存在时当没有记录（重启后不会恢复一个空壳）', () => {
    const dir = temp()
    writeVerifiedRecord(dir, { path: join(dir, 'gone.exe'), sha256: DIGEST, version: '1.2.0' })
    expect(readVerifiedRecord(dir)).toBeNull()
  })

  it('记录指向缓存目录之外时当没有记录（被改写/手编的记录不得把安装路径指向别处）', () => {
    const root = temp()
    const dir = join(root, 'updates')
    mkdirSync(dir, { recursive: true })
    const outside = join(root, 'evil.exe')
    writeFileSync(outside, 'bytes')
    writeVerifiedRecord(dir, { path: outside, sha256: DIGEST, version: '1.2.0' })
    expect(readVerifiedRecord(dir)).toBeNull()
  })
})
