/**
 * Managed Home 迁移（B6-P7）：目标判定、清单收集、复制校验、清单往返与
 * fail closed、收尾清理与失败保留。全部使用合成临时目录，不触碰任何
 * 真实用户数据。
 * @module @see-sol-lab/deepseekgui/tests/migration
 */
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  awaitingRestartOf, checkMigrationTarget, collectMigrationItems, copyAndVerifyItems,
  deleteOldCopy, fileDigest, manifestAfterCleanup, manifestAfterVerification,
  migrationManifestPath, nodeMigrationFacts, pendingCleanupOf, readMigrationManifest, removeTargetCopy,
  totalBytesOf, verificationFailureOf, verifyMigratedHome, writeMigrationManifest,
  type MigrationItem, type MigrationManifest, type MigrationTargetFacts,
} from '../src/migration.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 一个临时根目录（所有用例都在它内部操作）。 */
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-migration-')); roots.push(dir); return dir
}

/** 清理用清单的目标根：只需是一个与源不重叠的绝对路径，从不创建。 */
const NEVER_TARGET = join(tmpdir(), 'dsgui-migration-target-never-created')

/** 合成一个源 Home：两个文件 + 一个空目录 + 一个中文/空格路径。 */
function makeSource(): string {
  const root = temp()
  const source = join(root, 'source dsh')
  mkdirSync(join(source, 'sessions', '--E-project--'), { recursive: true })
  mkdirSync(join(source, 'profiles', 'web'), { recursive: true })
  mkdirSync(join(source, 'empty 目录'), { recursive: true })
  writeFileSync(join(source, 'sessions', '--E-project--', '会话.jsonl'), 'hello 世界\n', 'utf8')
  writeFileSync(join(source, 'profiles', 'web', 'package.json'), '{"name":"web"}\n', 'utf8')
  writeFileSync(join(source, 'settings.yaml'), 'model: deepseek\n', 'utf8')
  return source
}

/** 目标判定的可控事实（默认一切正常）。 */
function facts(over: Partial<MigrationTargetFacts> = {}): MigrationTargetFacts {
  return {
    exists: () => false,
    isEmpty: () => true,
    isWritable: () => true,
    freeBytes: () => 1_000_000,
    ...over,
  }
}

describe('checkMigrationTarget（拒绝路径）', () => {
  const source = 'C:/data/dsh'

  it('目标与源相同 / 目标在源内部 / 源在目标内部一律拒绝', () => {
    expect(checkMigrationTarget({ sourceHome: source, targetParent: 'C:/data', requiredBytes: 1, facts: facts() }))
      .toMatchObject({ ok: false, reason: 'same-as-source' })
    expect(checkMigrationTarget({ sourceHome: source, targetParent: 'C:/data/dsh/inner', requiredBytes: 1, facts: facts() }))
      .toMatchObject({ ok: false, reason: 'target-inside-source' })
    // 目标 Home（C:\dsh）是源（C:\dsh\inner）的祖先。
    expect(checkMigrationTarget({ sourceHome: 'C:/dsh/inner', targetParent: 'C:/', requiredBytes: 1, facts: facts() }))
      .toMatchObject({ ok: false, reason: 'source-inside-target' })
  })

  it('不可写 / 空间不足 / 非空冲突各自明确拒绝', () => {
    expect(checkMigrationTarget({
      sourceHome: source, targetParent: 'D:/target', requiredBytes: 1,
      facts: facts({ isWritable: () => false }),
    })).toMatchObject({ ok: false, reason: 'target-not-writable' })
    expect(checkMigrationTarget({
      sourceHome: source, targetParent: 'D:/target', requiredBytes: 2_000_000,
      facts: facts({ freeBytes: () => 1_000_000 }),
    })).toMatchObject({ ok: false, reason: 'not-enough-space' })
    expect(checkMigrationTarget({
      sourceHome: source, targetParent: 'D:/target', requiredBytes: 1,
      facts: facts({ exists: path => path === 'D:\\target\\dsh' || path === 'D:/target/dsh', isEmpty: () => false }),
    })).toMatchObject({ ok: false, reason: 'target-not-empty' })
  })

  it('合法目标解析为 <目标>/dsh', () => {
    expect(checkMigrationTarget({ sourceHome: source, targetParent: 'D:/target', requiredBytes: 1, facts: facts() }))
      .toEqual({ ok: true, targetHome: join('D:/target', 'dsh') })
  })
})

describe('collectMigrationItems', () => {
  it('收集文件（大小 + 摘要）与空目录，按路径排序', () => {
    const source = makeSource()
    const items = collectMigrationItems(source)
    expect(items.map(item => item.path)).toEqual([
      'empty 目录',
      'profiles/web/package.json',
      'sessions/--E-project--/会话.jsonl',
      'settings.yaml',
    ])
    const file = items.find(item => item.path === 'settings.yaml')
    expect(file).toMatchObject({ kind: 'file', bytes: 16 })
    expect(file?.sha256).toBe(fileDigest(join(source, 'settings.yaml')))
    expect(items.find(item => item.path === 'empty 目录')).toEqual({ path: 'empty 目录', kind: 'dir', bytes: 0, sha256: '' })
    expect(totalBytesOf(items)).toBeGreaterThan(0)
  })
})

describe('copyAndVerifyItems', () => {
  it('逐项复制并通过校验（含中文与空格路径、空目录）', () => {
    const source = makeSource()
    const target = join(temp(), 'target dsh')
    const items = collectMigrationItems(source)
    copyAndVerifyItems(items, source, target)
    expect(readFileSync(join(target, 'sessions', '--E-project--', '会话.jsonl'), 'utf8')).toBe('hello 世界\n')
    expect(existsSync(join(target, 'empty 目录'))).toBe(true)
    expect(existsSync(join(target, 'settings.yaml'))).toBe(true)
  })

  it('摘要不符立即失败，不静默放过', () => {
    const source = makeSource()
    const target = join(temp(), 'target')
    const items = collectMigrationItems(source).map(item => item.path === 'settings.yaml'
      ? { ...item, sha256: 'f'.repeat(64) }
      : item)
    expect(() => { copyAndVerifyItems(items, source, target) })
      .toThrow(/digest mismatch/)
  })

  it('字节数不符立即失败', () => {
    const source = makeSource()
    const target = join(temp(), 'target')
    const items = collectMigrationItems(source).map(item => item.path === 'settings.yaml'
      ? { ...item, bytes: item.bytes + 1 }
      : item)
    expect(() => { copyAndVerifyItems(items, source, target) }).toThrow(/expected 17 bytes, got 16/)
  })

  it('失败回滚删除新副本，旧副本完好', () => {
    const source = makeSource()
    const target = join(temp(), 'target')
    const items = collectMigrationItems(source).map(item => ({ ...item, sha256: 'f'.repeat(64) }))
    expect(() => { copyAndVerifyItems(items, source, target) }).toThrow()
    removeTargetCopy(target)
    expect(existsSync(target)).toBe(false)
    expect(existsSync(join(source, 'settings.yaml'))).toBe(true)
  })
})

describe('迁移清单', () => {
  function manifestOf(source: string, target: string): MigrationManifest {
    return {
      schemaVersion: 1,
      completedAt: '2026-09-10T00:00:00.000Z',
      sourceHome: source,
      targetHome: target,
      items: collectMigrationItems(source),
      verification: { status: 'verified', checkedAt: '2026-09-10T00:01:00.000Z', failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
  }

  it('写入后可逐项读回', () => {
    const source = makeSource()
    const target = join(temp(), 'target')
    mkdirSync(target, { recursive: true })
    const manifest = manifestOf(source, target)
    writeMigrationManifest(target, manifest)
    expect(existsSync(migrationManifestPath(target))).toBe(true)
    expect(readMigrationManifest(target)).toEqual({ manifest, error: null })
  })

  it('缺失 = 从未迁移（null 且无错误）', () => {
    expect(readMigrationManifest(join(temp(), 'nowhere'))).toEqual({ manifest: null, error: null })
  })

  it.each([
    ['非法 JSON', '{oops'],
    ['版本不符', JSON.stringify({ schemaVersion: 9 })],
    ['缺字段', JSON.stringify({ schemaVersion: 1, completedAt: 'x' })],
    ['cleanup 非法', JSON.stringify({
      schemaVersion: 1, completedAt: 'x', sourceHome: 'a', targetHome: 'b', items: [],
      cleanup: { status: 'whatever', remaining: [] },
    })],
    ['item 畸形', JSON.stringify({
      schemaVersion: 1, completedAt: 'x', sourceHome: 'a', targetHome: 'b',
      items: [{ path: 'p', kind: 'file' }], cleanup: { status: 'pending', remaining: [] },
    })],
  ])('损坏 fail closed：%s', (_name, content) => {
    const target = temp()
    mkdirSync(join(target, 'deepseekgui'), { recursive: true })
    writeFileSync(migrationManifestPath(target), content, 'utf8')
    const read = readMigrationManifest(target)
    expect(read.manifest).toBeNull()
    expect(read.error).not.toBeNull()
    // 损坏时既不提示也不删除。
    expect(pendingCleanupOf(read.manifest)).toBeNull()
  })
})

describe('pendingCleanupOf（收尾提示的唯一依据）', () => {
  const source = 'C:/old/dsh'
  const base: MigrationManifest = {
    schemaVersion: 1,
    completedAt: '2026-09-10T00:00:00.000Z',
    sourceHome: source,
    targetHome: 'D:/new/dsh',
    items: [{ path: 'a.txt', kind: 'file', bytes: 1, sha256: 'a'.repeat(64) }],
    verification: { status: 'verified', checkedAt: '2026-09-10T00:01:00.000Z', failures: [] },
    cleanup: { status: 'pending', remaining: [] },
  }

  it('清单缺失或已清理完成时不提示', () => {
    expect(pendingCleanupOf(null)).toBeNull()
    expect(pendingCleanupOf({ ...base, cleanup: { status: 'done', remaining: [] } })).toBeNull()
  })

  it('旧路径已不存在时不提示', () => {
    expect(pendingCleanupOf({ ...base, sourceHome: join(temp(), 'gone') })).toBeNull()
  })

  it('未经重启核对时绝不提示删除——这一步不可逆，必须先证明新位置从零启动能用', () => {
    const old = temp()
    expect(pendingCleanupOf({
      ...base,
      sourceHome: old,
      verification: { status: 'awaiting-restart', checkedAt: null, failures: [] },
    })).toBeNull()
    expect(pendingCleanupOf({
      ...base,
      sourceHome: old,
      verification: { status: 'failed', checkedAt: '2026-09-10T00:01:00.000Z', failures: ['a.txt'] },
    })).toBeNull()
  })

  it('核对通过且旧路径仍在时，按清单条数与占用大小提示', () => {
    const old = temp()
    expect(pendingCleanupOf({ ...base, sourceHome: old })).toEqual({ count: 1, sourceHome: old, bytes: 1 })
  })
})

describe('deleteOldCopy（用户确认后由代码删除）', () => {
  it('删除清单里的每一项并清掉源根', () => {
    const source = makeSource()
    const items = collectMigrationItems(source)
    const manifest: MigrationManifest = {
      schemaVersion: 1, completedAt: 'x', sourceHome: source, targetHome: NEVER_TARGET, items,
      verification: { status: 'verified', checkedAt: 'y', failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
    const outcome = deleteOldCopy(manifest)
    expect(outcome.failed).toEqual([])
    expect(outcome.deleted).toHaveLength(items.length)
    expect(existsSync(source)).toBe(false)
    expect(manifestAfterCleanup(manifest, outcome).cleanup.status).toBe('done')
  })

  it('删不掉的项留在清单里，绝不原地重试；已经不在的项当作删过', () => {
    const source = makeSource()
    const items: MigrationItem[] = [
      ...collectMigrationItems(source),
      // 上一次清理已经删掉的项：再跑一遍不算失败（重复清理要能收口）。
      { path: 'never-existed.txt', kind: 'file', bytes: 0, sha256: '' },
    ]
    // 收集之后源文件被改过：摘要对不上就不删、记为失败，用户的改动留着。
    writeFileSync(join(source, 'settings.yaml'), 'model: deepseek\nedited: after-migration\n', 'utf8')
    const manifest: MigrationManifest = {
      schemaVersion: 1, completedAt: 'x', sourceHome: source, targetHome: NEVER_TARGET, items,
      verification: { status: 'verified', checkedAt: 'y', failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
    const outcome = deleteOldCopy(manifest)
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]?.path).toBe(join(source, 'settings.yaml'))
    expect(outcome.failed[0]?.message).toContain('changed after migration')
    expect(readFileSync(join(source, 'settings.yaml'), 'utf8')).toContain('edited: after-migration')
    const after = manifestAfterCleanup(manifest, outcome)
    expect(after.cleanup.status).toBe('partial')
    expect(after.cleanup.remaining).toHaveLength(1)
    // 失败项仍在清单里 → 下次启动仍会提示（源根因失败项保留而存在）。
    expect(pendingCleanupOf(after)).not.toBeNull()
  })
})

describe('清理与回滚绝不跟进链接（2026-09-10 实机：安装目录被掏空）', () => {
  // 注意运行时差异：vitest 跑在系统 Node 上，那一版的 rmSync({recursive})
  // 恰好不跟进 junction；产品跑的 Electron 43 内嵌 Node 24.19 会（已用
  // ELECTRON_RUN_AS_NODE 复现：目标文件被删）。所以下面断言的是新实现自己
  // 的行为——逐项 lstat、链接只摘链接点——而不是与老写法的对比。
  /**
   * 复刻事故现场：清单收集时 `profiles/node_modules/@scope` 只装着 junction，
   * 于是它作为「空目录」进了清单；链接指向 Home 之外的安装目录。官方 heal 每次
   * 启动都会建这些链接，所以收集之后、清理之前它们一定在。
   */
  function homeWithJunction(): { source: string; installed: string; link: string } {
    const root = temp()
    const source = join(root, 'old dsh')
    const installed = join(root, 'Programs', 'DeepSeekGUI', 'resources', 'dsh', 'node_modules', '@scope', 'pkg')
    mkdirSync(installed, { recursive: true })
    writeFileSync(join(installed, 'index.js'), 'module.exports = 1\n', 'utf8')
    writeFileSync(join(installed, 'package.json'), '{"name":"pkg"}\n', 'utf8')
    const scope = join(source, 'profiles', 'node_modules', '@scope')
    mkdirSync(scope, { recursive: true })
    writeFileSync(join(source, 'settings.yaml'), 'model: deepseek\n', 'utf8')
    return { source, installed, link: join(scope, 'pkg') }
  }

  function manifestOf(source: string, items: MigrationItem[]): MigrationManifest {
    return {
      schemaVersion: 1, completedAt: 'x', sourceHome: source, targetHome: NEVER_TARGET, items,
      verification: { status: 'verified', checkedAt: 'y', failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
  }

  it('deleteOldCopy：链接只摘链接点，目标一个字节不动，源根仍被清空', () => {
    const { source, installed, link } = homeWithJunction()
    // 先收集（此时作用域目录是空的 → dir 条目），再建链接——与真实顺序一致。
    const items = collectMigrationItems(source)
    expect(items.some(item => item.kind === 'dir' && item.path === 'profiles/node_modules/@scope')).toBe(true)
    symlinkSync(installed, link, 'junction')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)

    const outcome = deleteOldCopy(manifestOf(source, items))

    expect(outcome.failed).toEqual([])
    expect(readFileSync(join(installed, 'index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(readFileSync(join(installed, 'package.json'), 'utf8')).toBe('{"name":"pkg"}\n')
    expect(existsSync(link)).toBe(false)
    expect(existsSync(source)).toBe(false)
    expect(manifestAfterCleanup(manifestOf(source, items), outcome).cleanup.status).toBe('done')
  })

  it('deleteOldCopy：清单之外的普通文件不动，所在目录记为失败而不是静默留下', () => {
    const source = makeSource()
    const items = collectMigrationItems(source)
    // 收集之后有人往清单里的空目录放了东西：那不是我们的。
    writeFileSync(join(source, 'empty 目录', 'not-ours.txt'), 'keep me\n', 'utf8')
    const outcome = deleteOldCopy(manifestOf(source, items))
    expect(readFileSync(join(source, 'empty 目录', 'not-ours.txt'), 'utf8')).toBe('keep me\n')
    expect(outcome.failed.map(entry => entry.path)).toEqual([join(source, 'empty 目录')])
    expect(manifestAfterCleanup(manifestOf(source, items), outcome).cleanup.status).toBe('partial')
  })

  it('removeTargetCopy：回滚删的是我们复制的那份，链接目标不动', () => {
    const { source, installed, link } = homeWithJunction()
    symlinkSync(installed, link, 'junction')
    removeTargetCopy(source)
    expect(existsSync(source)).toBe(false)
    expect(readFileSync(join(installed, 'index.js'), 'utf8')).toBe('module.exports = 1\n')
  })
})

describe('重启核对（切指向不等于搬家成功）', () => {
  /** 复制一份源到目标，返回清单条目——核对的依据。 */
  function migrated(): { target: string; items: MigrationItem[] } {
    const source = makeSource()
    const target = join(temp(), 'new-home')
    const items = collectMigrationItems(source)
    copyAndVerifyItems(items, source, target)
    return { target, items }
  }

  it('新位置逐项对得上时通过', () => {
    const { target, items } = migrated()
    expect(verifyMigratedHome(target, items)).toEqual({ ok: true, failures: [] })
  })

  it('文件缺失时报出该条目', () => {
    const { target, items } = migrated()
    const victim = items.find(item => item.kind === 'file')
    if (victim === undefined) throw new Error('fixture must contain a file')
    rmSync(join(target, ...victim.path.split('/')), { force: true })
    const result = verifyMigratedHome(target, items)
    expect(result.ok).toBe(false)
    expect(result.failures).toContain(victim.path)
  })

  it('内容变化不算失败——切指向后活跃会话会继续写日志，那是正常使用不是搬坏了', () => {
    const { target, items } = migrated()
    const victim = items.find(item => item.kind === 'file' && item.bytes > 0)
    if (victim === undefined) throw new Error('fixture must contain a non-empty file')
    const path = join(target, ...victim.path.split('/'))
    // 同大小改写 + 追加，两种真实形态都不该判失败：字节级校验属于复制阶段
    // （那时 Harness 已停、数据静止），重启后再算摘要必然对不上。
    writeFileSync(path, 'x'.repeat(victim.bytes))
    expect(verifyMigratedHome(target, items).ok).toBe(true)
    appendFileSync(path, 'appended line\n')
    expect(verifyMigratedHome(target, items).ok).toBe(true)
  })

  it('清单里的文件变成了目录（或反过来）仍判失败', () => {
    const { target, items } = migrated()
    const victim = items.find(item => item.kind === 'file')
    if (victim === undefined) throw new Error('fixture must contain a file')
    const path = join(target, ...victim.path.split('/'))
    rmSync(path, { force: true })
    mkdirSync(path, { recursive: true })
    const result = verifyMigratedHome(target, items)
    expect(result.ok).toBe(false)
    expect(result.failures).toContain(victim.path)
  })

  it('空目录条目丢失时报出', () => {
    const { target, items } = migrated()
    const dir = items.find(item => item.kind === 'dir')
    if (dir === undefined) throw new Error('fixture must contain an empty dir')
    rmSync(join(target, ...dir.path.split('/')), { recursive: true, force: true })
    expect(verifyMigratedHome(target, items).failures).toContain(dir.path)
  })

  it('核对结果写回清单：通过转 verified，失败转 failed 并留下对不上的条目', () => {
    const { target, items } = migrated()
    const base: MigrationManifest = {
      schemaVersion: 1,
      completedAt: 'x',
      sourceHome: 'C:/old',
      targetHome: target,
      items,
      verification: { status: 'awaiting-restart', checkedAt: null, failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
    const passed = manifestAfterVerification(base, { ok: true, failures: [] })
    expect(passed.verification.status).toBe('verified')
    expect(passed.verification.checkedAt).not.toBeNull()
    const failed = manifestAfterVerification(base, { ok: false, failures: ['a.txt'] })
    expect(failed.verification.status).toBe('failed')
    expect(failed.verification.failures).toEqual(['a.txt'])
  })

  it('清单缺 verification 字段时按最保守方式读回：等重启核对，不给删除入口', () => {
    const home = temp()
    mkdirSync(join(home, 'deepseekgui'), { recursive: true })
    writeFileSync(migrationManifestPath(home), JSON.stringify({
      schemaVersion: 1,
      completedAt: 'x',
      sourceHome: 'C:/old',
      targetHome: home,
      items: [],
      cleanup: { status: 'pending', remaining: [] },
    }))
    const { manifest } = readMigrationManifest(home)
    expect(manifest?.verification.status).toBe('awaiting-restart')
    expect(pendingCleanupOf(manifest)).toBeNull()
    expect(awaitingRestartOf(manifest)).toEqual({ targetHome: home })
  })

  it('等重启与核对失败两个提示互斥，各自只在自己的状态下出现', () => {
    const base: MigrationManifest = {
      schemaVersion: 1,
      completedAt: 'x',
      sourceHome: 'C:/old',
      targetHome: 'D:/new',
      items: [],
      verification: { status: 'awaiting-restart', checkedAt: null, failures: [] },
      cleanup: { status: 'pending', remaining: [] },
    }
    expect(awaitingRestartOf(base)).toEqual({ targetHome: 'D:/new' })
    expect(verificationFailureOf(base)).toBeNull()
    const failed = { ...base, verification: { status: 'failed' as const, checkedAt: 'y', failures: ['a.txt'] } }
    expect(awaitingRestartOf(failed)).toBeNull()
    expect(verificationFailureOf(failed)).toEqual({ failures: ['a.txt'], sourceHome: 'C:/old' })
  })
})

describe('nodeMigrationFacts（生产文件系统事实）', () => {
  it('存在性、空目录与可写判定来自真实文件系统', () => {
    const root = temp()
    const empty = join(root, 'empty')
    mkdirSync(empty)
    writeFileSync(join(root, 'a.txt'), 'x')
    expect(nodeMigrationFacts.exists(join(root, 'missing'))).toBe(false)
    expect(nodeMigrationFacts.exists(empty)).toBe(true)
    expect(nodeMigrationFacts.isEmpty(empty)).toBe(true)
    expect(nodeMigrationFacts.isEmpty(join(root, 'missing'))).toBe(true)
    expect(nodeMigrationFacts.isEmpty(root)).toBe(false)
    expect(nodeMigrationFacts.isWritable(root)).toBe(true)
    expect(nodeMigrationFacts.isWritable(join(root, 'missing'))).toBe(false)
  })

  it('空闲字节数是正数（真实卷），足以与清单总字节数比较', () => {
    expect(nodeMigrationFacts.freeBytes(temp())).toBeGreaterThan(0)
  })
})
