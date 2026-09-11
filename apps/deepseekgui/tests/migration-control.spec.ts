/**
 * Managed Home 迁移执行面的事务顺序。
 *
 * 这里验证的全是「出错之后用户的数据还在不在」：复制失败要删掉新副本并把
 * 服务恢复、切换起不来要删掉新副本、成功也**不在同一个进程里**宣布成功，
 * 以及删旧副本前那道不可绕过的闸。此前这段住在 main.ts 的闭包里，验证它
 * 得真搬一次家再制造一次失败。
 * @module @see-sol-lab/deepseekgui/tests/migration-control
 */

import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMigrationControl, type MigrationControlDeps } from '../src/migration-control.ts'
import { readMigrationManifest, writeMigrationManifest } from '../src/migration.ts'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** 一个带内容的 Managed Home，外加一个空的目标父目录。 */
function stage() {
  const root = mkdtempSync(join(tmpdir(), 'deepseekgui-migrate-'))
  roots.push(root)
  const sourceHome = join(root, 'source-home')
  mkdirSync(join(sourceHome, 'sessions'), { recursive: true })
  writeFileSync(join(sourceHome, 'memory.md'), '# memory\n')
  writeFileSync(join(sourceHome, 'sessions', 'a.jsonl'), 'line\n')
  const targetParent = join(root, 'target-parent')
  mkdirSync(targetParent, { recursive: true })
  return { root, sourceHome, targetParent }
}

function control(sourceHome: string, targetParent: string | undefined, over: Partial<MigrationControlDeps> = {}) {
  const stopHarness = vi.fn(async () => {})
  const startHarness = vi.fn(async () => {})
  const switchHome = vi.fn(async (_target: string, _profile: string) => true)
  const markLastKnownGood = vi.fn()
  const broadcast = vi.fn()
  const deps: MigrationControlDeps = {
    home: () => ({ homeKind: 'managed', homePath: sourceHome, profile: 'web' }),
    markLastKnownGood,
    switchHome,
    stopHarness,
    startHarness,
    pickTargetParent: async () => targetParent,
    text: (key, vars) => `${key}${vars === undefined ? '' : `:${Object.values(vars).join(',')}`}`,
    broadcast,
    zh: () => true,
    ...over,
  }
  return { api: createMigrationControl(deps), stopHarness, startHarness, switchHome, markLastKnownGood, broadcast }
}

describe('createMigrationControl.migrate', () => {
  it('Existing Home 一律拒绝——那是用户自己的目录', async () => {
    const { sourceHome, targetParent } = stage()
    const c = control(sourceHome, targetParent, {
      home: () => ({ homeKind: 'existing', homePath: sourceHome, profile: 'web' }),
    })
    await expect(c.api.migrate()).rejects.toThrow('error.migration-existing-home')
    expect(c.stopHarness).not.toHaveBeenCalled()
  })

  it('源目录不存在时明确拒绝，不停服务', async () => {
    const { root, targetParent } = stage()
    const c = control(join(root, 'no-such-home'), targetParent)
    await expect(c.api.migrate()).rejects.toThrow('error.migration-source-missing')
    expect(c.stopHarness).not.toHaveBeenCalled()
  })

  it('用户取消目录选择时什么都不做', async () => {
    const { sourceHome } = stage()
    const c = control(sourceHome, undefined)
    await c.api.migrate()
    expect(c.stopHarness).not.toHaveBeenCalled()
    expect(c.switchHome).not.toHaveBeenCalled()
  })

  it('目标就是源目录时按理由报错，不合并成一句「失败」', async () => {
    const { sourceHome } = stage()
    const c = control(sourceHome, sourceHome)
    await expect(c.api.migrate()).rejects.toThrow(/error\.migration-(same-as-source|target-inside-source)/u)
    expect(c.stopHarness).not.toHaveBeenCalled()
  })

  it('成功后停在 awaiting-restart——同一个进程里绝不宣布迁移成功', async () => {
    const { sourceHome, targetParent } = stage()
    const c = control(sourceHome, targetParent)
    await c.api.migrate()
    const target = join(targetParent, 'dsh')
    const { manifest } = readMigrationManifest(target)
    expect(manifest?.verification.status).toBe('awaiting-restart')
    // 旧位置原样保留：这一刻还没有任何东西被删。
    expect(existsSync(join(sourceHome, 'memory.md'))).toBe(true)
    expect(c.markLastKnownGood).toHaveBeenCalled()
    expect(c.stopHarness).toHaveBeenCalled()
    // 给会话里的助手留了事实：落在新 Home，说清楚 pending 的含义（#17）。
    const events = readFileSync(join(target, 'deepseekgui', 'events.md'), 'utf8')
    expect(events).toContain('数据目录已迁移')
    expect(events).toContain('cleanup.status = pending')
  })

  it('切过去起不来时删掉新副本，旧位置不动', async () => {
    const { sourceHome, targetParent } = stage()
    const c = control(sourceHome, targetParent, { switchHome: vi.fn(async () => false) })
    await expect(c.api.migrate()).rejects.toThrow('error.migration-switch-failed')
    expect(existsSync(join(targetParent, 'dsh'))).toBe(false)
    expect(existsSync(join(sourceHome, 'memory.md'))).toBe(true)
  })
})

describe('createMigrationControl.cleanup', () => {
  /** 走完一次迁移，返回新 Home 路径。 */
  async function migrated() {
    const { sourceHome, targetParent } = stage()
    const target = join(targetParent, 'dsh')
    const c = control(sourceHome, targetParent, {
      home: () => ({ homeKind: 'managed', homePath: existsSync(target) ? target : sourceHome, profile: 'web' }),
    })
    await c.api.migrate()
    return { api: c.api, sourceHome, target }
  }

  it('没经过重启核对就不许删——这是第二道闸，命令可以从别处进来', async () => {
    const { api, sourceHome } = await migrated()
    expect(() => { api.cleanup() }).toThrow('error.migration-not-verified')
    expect(existsSync(join(sourceHome, 'memory.md'))).toBe(true)
  })

  it('核对失败同样不许删', async () => {
    const { api, sourceHome, target } = await migrated()
    const { manifest } = readMigrationManifest(target)
    writeMigrationManifest(target, {
      ...manifest!,
      verification: { status: 'failed', checkedAt: new Date().toISOString(), failures: ['memory.md'] },
    })
    expect(() => { api.cleanup() }).toThrow('error.migration-not-verified')
    expect(existsSync(join(sourceHome, 'memory.md'))).toBe(true)
  })

  it('核对通过后才真的删旧副本', async () => {
    const { api, sourceHome, target } = await migrated()
    api.verifyOnStartup()
    expect(readMigrationManifest(target).manifest?.verification.status).toBe('verified')
    api.cleanup()
    expect(existsSync(sourceHome)).toBe(false)
  })

  it('清单缺失时不提示也不删——fail closed', async () => {
    const { sourceHome, targetParent } = stage()
    const c = control(sourceHome, targetParent)
    // 从没迁移过：没有清单可读。
    expect(() => { c.api.cleanup() }).not.toThrow()
    expect(existsSync(join(sourceHome, 'memory.md'))).toBe(true)
  })
})

describe('createMigrationControl.view', () => {
  it('没有清单时报告当前位置，不谎称有待清理的副本', () => {
    const { sourceHome, targetParent } = stage()
    const view = control(sourceHome, targetParent).api.view()
    expect(view.homePath).toBe(sourceHome)
    expect(view.homeKind).toBe('managed')
    expect(view.pendingCleanup).toBeNull()
  })

  it('迁移之后立刻报告「等重启」，而不是「可以删了」', async () => {
    const { sourceHome, targetParent } = stage()
    const target = join(targetParent, 'dsh')
    const c = control(sourceHome, targetParent, {
      home: () => ({ homeKind: 'managed', homePath: existsSync(target) ? target : sourceHome, profile: 'web' }),
    })
    await c.api.migrate()
    const view = c.api.view()
    // awaitingRestart 带着目标路径，面板要把它显示给用户看。
    expect(view.awaitingRestart).toEqual({ targetHome: target })
    // 关键：这一刻绝不能出现删除入口。
    expect(view.pendingCleanup).toBeNull()
  })
})
