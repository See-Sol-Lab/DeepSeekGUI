/**
 * 首启导入询问测试。
 *
 * 这段流程碰的是用户电脑上另一套程序的数据，所以要钉住的不是文案好不好
 * 看，而是三件事：拒绝时一个字节都不复制、问过一次就不再问、以及导入失败
 * 时明确告诉用户原件没被动过。它此前住在 main.ts 的闭包里，没有任何自动化
 * 覆盖——真跑一次要一台装过 DSH 的机器。
 * @module @see-sol-lab/deepseekgui/tests/session-import-offer
 */

import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  shouldOfferImport: vi.fn(),
  surveyImportableSessions: vi.fn(),
  importSessions: vi.fn(),
  markImportOffered: vi.fn(),
}))
vi.mock('../src/session-import.ts', () => io)

const { offerSessionImport } = await import('../src/session-import-offer.ts')
type MessageBox = Parameters<Parameters<typeof offerSessionImport>[1]['showMessageBox']>[0]
const HOME = join('C:', 'Users', 'someone')
const TARGET = join('D:', 'deepseekgui-home')

/** 一次询问：默认「机器上有一套可导入的 DSH」，用户点第一个按钮。 */
function deps(response = 0) {
  const showMessageBox = vi.fn(async (_request: MessageBox) => ({ response }))
  return { showMessageBox, zh: () => true, homeDir: HOME }
}

beforeEach(() => {
  vi.clearAllMocks()
  io.shouldOfferImport.mockReturnValue(true)
  io.surveyImportableSessions.mockReturnValue({ importable: true, count: 7, formatVersion: 3, supportedVersion: 3 })
  io.importSessions.mockReturnValue({ copied: 7, skipped: 0 })
})

describe('offerSessionImport', () => {
  it('问过一次就不再问', async () => {
    io.shouldOfferImport.mockReturnValue(false)
    const d = deps()
    await offerSessionImport(TARGET, d)
    expect(d.showMessageBox).not.toHaveBeenCalled()
  })

  it('DeepSeekGUI 本来就指向那个目录时，没有两套，不问', async () => {
    const d = deps()
    await offerSessionImport(join(HOME, '.dsh'), d)
    expect(d.showMessageBox).not.toHaveBeenCalled()
    expect(io.importSessions).not.toHaveBeenCalled()
  })

  it('那边没有对话时安静退出', async () => {
    io.surveyImportableSessions.mockReturnValue(null)
    const d = deps()
    await offerSessionImport(TARGET, d)
    expect(d.showMessageBox).not.toHaveBeenCalled()
  })

  it('用户拒绝时一个字节都不复制，但仍记下问过了', async () => {
    const d = deps(1)
    await offerSessionImport(TARGET, d)
    expect(io.importSessions).not.toHaveBeenCalled()
    expect(io.markImportOffered).toHaveBeenCalledWith(TARGET)
  })

  it('用户同意时复制，并报告跳过的数量', async () => {
    io.importSessions.mockReturnValue({ copied: 5, skipped: 2 })
    const d = deps(0)
    await offerSessionImport(TARGET, d)
    expect(io.importSessions).toHaveBeenCalledWith(join(HOME, '.dsh'), TARGET)
    const last = d.showMessageBox.mock.calls.at(-1)?.[0]
    expect(last?.detail).toContain('2')
    expect(last?.detail).toContain('未做覆盖')
  })

  it('格式对不上时只说明、不导入——搬过来也是一堆点不开的对话', async () => {
    io.surveyImportableSessions.mockReturnValue({ importable: false, count: 4, formatVersion: 4, supportedVersion: 3 })
    const d = deps(0)
    await offerSessionImport(TARGET, d)
    expect(io.importSessions).not.toHaveBeenCalled()
    // 说明框只有一个按钮：这里没有可选的动作。
    const first = d.showMessageBox.mock.calls[0]?.[0]
    expect(first?.buttons).toHaveLength(1)
    expect(first?.detail).toContain('v4')
    expect(first?.detail).toContain('v3')
    // 问过了同样要记下，否则每次启动都会再弹一次。
    expect(io.markImportOffered).toHaveBeenCalledWith(TARGET)
  })

  it('导入失败时明说原件没被动过，并且不泄露凭据', async () => {
    io.importSessions.mockImplementation(() => { throw new Error('EPERM: sk-abcdefghijklmnopqrstuvwx') })
    const d = deps(0)
    await offerSessionImport(TARGET, d)
    const last = d.showMessageBox.mock.calls.at(-1)?.[0]
    expect(last?.type).toBe('error')
    expect(last?.detail).toContain('未被改动')
    expect(last?.detail).not.toContain('sk-abcdefghijklmnopqrstuvwx')
  })

  it('每一次询问都把权责说清楚：原件不删、可以不卸载、别让两个程序写同一份数据', async () => {
    const d = deps(1)
    await offerSessionImport(TARGET, d)
    const asked = d.showMessageBox.mock.calls[0]?.[0]
    expect(asked?.detail).toContain('保持不变')
    expect(asked?.detail).toContain('互不干扰')
    expect(asked?.detail).toContain('请勿让两个程序同时写入同一个 Harness 数据目录')
    expect(asked?.detail).toContain('API key 不会导入')
  })
})
