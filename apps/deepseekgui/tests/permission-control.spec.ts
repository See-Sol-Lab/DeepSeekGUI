/**
 * Permission 执行面测试。
 *
 * 要钉的只有一条规矩：fail closed。读不到权限设置时不能显示成 Sandbox，
 * 也不能允许任何切换——把「读不到」渲染成「看起来最安全的那个值」，会让
 * 用户以为自己被沙箱保护着。这段逻辑此前住在 main.ts 的闭包里，验证它得
 * 真把 Harness 弄坏一次。
 * @module @see-sol-lab/deepseekgui/tests/permission-control
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPermissionControl, type PermissionControlDeps } from '../src/permission-control.ts'
import { FULL_ACCESS_PRESET, PERMISSION_DEFAULT_FIELD, RECOMMENDED_PRESET } from '../src/permission-view.ts'

type Describe = Awaited<ReturnType<PermissionControlDeps['rpc']['settingsDescribe']>>

/**
 * 一个 describe 结果。刻意不加 `as`：字段名写错时要让编译器当场说话，
 * 而不是让六条用例在运行时一起变红再回头猜。
 */
const describeWith = (preset: string | null): Describe => ({
  writable: true,
  hasDocument: true,
  namespaces: [{
    ns: 'permission',
    applies: 'live',
    revision: 1,
    value: preset === null ? {} : { [PERMISSION_DEFAULT_FIELD]: preset },
  }],
})

function control(overrides: Partial<PermissionControlDeps> = {}) {
  const settingsDescribe = vi.fn(async () => describeWith(RECOMMENDED_PRESET))
  const settingsMutate = vi.fn(async () => ({}) as never)
  const showMessageBox = vi.fn(async (_request: Parameters<PermissionControlDeps['showMessageBox']>[0]) => ({ response: 0 }))
  const broadcast = vi.fn()
  const deps: PermissionControlDeps = {
    rpc: { settingsDescribe, settingsMutate },
    showMessageBox,
    zh: () => true,
    home: () => ({ kind: 'managed', path: 'D:\\home', profile: 'default' }),
    broadcast,
    ...overrides,
  }
  return { api: createPermissionControl(deps), settingsDescribe, settingsMutate, showMessageBox, broadcast }
}

beforeEach(() => { vi.restoreAllMocks() })

describe('createPermissionControl', () => {
  it('describe 失败时进入 unavailable，绝不显示成 Sandbox', async () => {
    const c = control()
    c.settingsDescribe.mockRejectedValue(new Error('harness is down'))
    await c.api.refresh()
    expect(c.api.view().mode).toBe('unavailable')
    expect(c.broadcast).toHaveBeenCalled()
  })

  it('unavailable 时拒绝一切切换，一次都不写', async () => {
    const c = control()
    c.settingsDescribe.mockRejectedValue(new Error('harness is down'))
    await c.api.refresh()
    await c.api.switchMode('full-access')
    await c.api.switchMode('sandbox')
    expect(c.settingsMutate).not.toHaveBeenCalled()
  })

  it('切 Full Access 必须显式确认；取消就不写', async () => {
    const c = control()
    await c.api.refresh()
    c.showMessageBox.mockResolvedValue({ response: 1 })
    await c.api.switchMode('full-access')
    expect(c.settingsMutate).not.toHaveBeenCalled()
    // 确认框必须把风险说出来，不能只问「确定吗」。
    const asked = c.showMessageBox.mock.calls[0]?.[0]
    expect(asked?.detail).toContain('工作区之外')
  })

  it('确认后写的是 Full Access 预设', async () => {
    const c = control()
    await c.api.refresh()
    await c.api.switchMode('full-access')
    expect(c.settingsMutate).toHaveBeenCalledWith('permission', [
      { op: 'set', path: ['defaultPreset'], value: FULL_ACCESS_PRESET },
    ])
  })

  it('Managed Home 切回 Sandbox 不打扰用户', async () => {
    const c = control()
    await c.api.refresh()
    c.showMessageBox.mockClear()
    await c.api.switchMode('sandbox')
    expect(c.showMessageBox).not.toHaveBeenCalled()
    expect(c.settingsMutate).toHaveBeenCalledWith('permission', [
      { op: 'set', path: ['defaultPreset'], value: RECOMMENDED_PRESET },
    ])
  })

  it('Existing Home 切回 Sandbox 要先确认，并把改的是谁摆出来', async () => {
    // 那是用户自己的 Harness 设置，不能静默改写。
    const c = control({ home: () => ({ kind: 'existing', path: 'C:\\Users\\me\\.dsh', profile: 'work' }) })
    await c.api.refresh()
    c.showMessageBox.mockResolvedValue({ response: 1 })
    await c.api.switchMode('sandbox')
    expect(c.settingsMutate).not.toHaveBeenCalled()
    const asked = c.showMessageBox.mock.calls.at(-1)?.[0]
    expect(asked?.detail).toContain('C:\\Users\\me\\.dsh')
    expect(asked?.detail).toContain('work')
  })

  it('写失败时明确报错，并且脱敏', async () => {
    const c = control()
    await c.api.refresh()
    c.settingsMutate.mockRejectedValue(new Error('denied for sk-abcdefghijklmnopqrstuvwx'))
    await c.api.switchMode('full-access')
    const shown = c.showMessageBox.mock.calls.at(-1)?.[0]
    expect(shown?.type).toBe('error')
    expect(shown?.detail).not.toContain('sk-abcdefghijklmnopqrstuvwx')
  })

  it('Managed Home 没有明确预设时写入推荐值', async () => {
    const c = control()
    c.settingsDescribe.mockResolvedValue(describeWith(null))
    await c.api.refresh()
    await c.api.ensureManagedDefault()
    expect(c.settingsMutate).toHaveBeenCalledWith('permission', [
      { op: 'set', path: ['defaultPreset'], value: RECOMMENDED_PRESET },
    ])
  })

  it('Existing Home 绝不被静默写入', async () => {
    const c = control({ home: () => ({ kind: 'existing', path: 'C:\\x', profile: 'p' }) })
    c.settingsDescribe.mockResolvedValue(describeWith(null))
    await c.api.refresh()
    await c.api.ensureManagedDefault()
    expect(c.settingsMutate).not.toHaveBeenCalled()
  })

  it('已有明确预设时不覆盖用户的选择', async () => {
    const c = control()
    c.settingsDescribe.mockResolvedValue(describeWith(FULL_ACCESS_PRESET))
    await c.api.refresh()
    await c.api.ensureManagedDefault()
    expect(c.settingsMutate).not.toHaveBeenCalled()
  })
})
