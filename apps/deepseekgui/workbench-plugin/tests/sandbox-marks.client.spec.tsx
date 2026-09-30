// @vitest-environment jsdom
/**
 * 清理沙箱标记那一行（住户 2026-09-29）：不是 DeepSeekGUI 的 Windows 窗口不渲染；
 * 按钮发 `sandbox-clean-marks`，把应答里的结果写成一句话（取消时什么也不写，
 * 标记来自上层文件夹时说明是哪一层）；失败把原因写出来。
 * @module @see-sol-lab/deepseekgui-workbench/tests/sandbox-marks
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SandboxMarksRow } from '../src/client/sandbox-marks.tsx'
import type { ControlBridgeClient, ControlModelSnapshot, SandboxCleanSnapshot } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh) => zh[key]) as never

function snapshot(sandboxClean: SandboxCleanSnapshot | null): ControlModelSnapshot {
  return { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1, sandboxClean }
}

function bridgeOf(run: ControlBridgeClient['run']): ControlBridgeClient {
  return { model: vi.fn(async () => ({ changed: false as const, revision: 1 })), run }
}

/** 点一次按钮，等结果那一句出现。 */
async function clickAndRead(result: SandboxCleanSnapshot | null): Promise<string | null> {
  const run = vi.fn(async () => snapshot(result))
  render(<SandboxMarksRow bridge={bridgeOf(run)} windows t={t} />)
  fireEvent.click(screen.getByRole('button', { name: zh['sandboxMarks.action'] }))
  expect(run).toHaveBeenCalledWith({ type: 'sandbox-clean-marks' })
  expect(screen.getByRole('status').textContent).toBe(zh['sandboxMarks.pending'])
  await vi.waitFor(() => { expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false) })
  return screen.queryByRole('status')?.textContent ?? null
}

describe('SandboxMarksRow', () => {
  it('不是 DeepSeekGUI 窗口、或不是 Windows 时不渲染', () => {
    expect(render(<SandboxMarksRow bridge={null} windows t={t} />).container.textContent).toBe('')
    cleanup()
    expect(render(<SandboxMarksRow bridge={bridgeOf(vi.fn())} windows={false} t={t} />).container.textContent).toBe('')
  })

  it('说明写在按钮旁边', () => {
    render(<SandboxMarksRow bridge={bridgeOf(vi.fn())} windows t={t} />)
    expect(screen.getByText(zh['sandboxMarks.title'])).toBeTruthy()
    expect(screen.getByText(zh['sandboxMarks.description'])).toBeTruthy()
  })

  it('清掉了：写出所在文件夹；标记来自上层时说明是哪一层', async () => {
    expect(await clickAndRead({ nonce: 1, status: 'cleaned', path: 'E:\\Priest', root: 'E:\\Priest' })).toBe(`${zh['sandboxMarks.cleaned']}E:\\Priest`)
    cleanup()
    expect(await clickAndRead({ nonce: 2, status: 'cleaned', path: 'E:\\Priest\\app', root: 'E:\\Priest' })).toBe(`${zh['sandboxMarks.cleanedInherited']}E:\\Priest`)
  })

  it('没有标记、正在使用、不支持各有一句；取消什么也不写', async () => {
    expect(await clickAndRead({ nonce: 1, status: 'clean', path: 'E:\\a', root: 'E:\\a' })).toBe(`${zh['sandboxMarks.clean']}E:\\a`)
    cleanup()
    expect(await clickAndRead({ nonce: 2, status: 'busy', path: 'E:\\a\\b', root: 'E:\\a' })).toBe(`${zh['sandboxMarks.busy']}E:\\a`)
    cleanup()
    expect(await clickAndRead({ nonce: 3, status: 'unsupported', path: 'E:\\a', root: 'E:\\a' })).toBe(zh['sandboxMarks.unsupported'])
    cleanup()
    expect(await clickAndRead({ nonce: 4, status: 'canceled', path: null, root: null })).toBeNull()
    cleanup()
    expect(await clickAndRead(null)).toBeNull()
  })

  it('失败时把原因写出来', async () => {
    const run = vi.fn(async () => { throw new Error('Harness 未运行') })
    render(<SandboxMarksRow bridge={bridgeOf(run)} windows t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['sandboxMarks.action'] }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Harness 未运行')
  })
})
