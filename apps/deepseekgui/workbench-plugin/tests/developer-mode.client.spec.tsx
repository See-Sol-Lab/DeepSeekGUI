// @vitest-environment jsdom
/**
 * 开发者模式那一行（住户 2026-09-29）：钉住四件事——不是 DeepSeekGUI 窗口就不
 * 渲染；开关显示的是桌面给的当前值，读到之前不能点；切换发的是
 * `developer-mode-set`，显示应答里的值（用户在确认框里取消时应答仍是旧值，
 * 开关跟着回去）；失败把原因写出来。说明文字三句都在开关旁边。
 * @module @see-sol-lab/deepseekgui-workbench/tests/developer-mode
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeveloperModeRow } from '../src/client/developer-mode.tsx'
import type { ControlBridgeClient, ControlModelSnapshot } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh) => zh[key]) as never

/** 开关是否不可点（原生 disabled 或 aria-disabled，二者之一）。 */
function disabled(element: HTMLElement): boolean {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
}

function snapshot(developerMode: boolean): ControlModelSnapshot {
  return { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1, developerMode }
}

function bridgeOf(initial: boolean, run: ControlBridgeClient['run']): ControlBridgeClient {
  return {
    model: vi.fn(async () => ({ changed: true as const, revision: 1, model: snapshot(initial) })),
    run,
  }
}

describe('DeveloperModeRow', () => {
  it('不是 DeepSeekGUI 窗口时不渲染', () => {
    const { container } = render(<DeveloperModeRow bridge={null} t={t} />)
    expect(container.textContent).toBe('')
  })

  it('显示桌面给的当前值与三句说明，读到之前开关不可点', async () => {
    let resolveModel: (value: Awaited<ReturnType<ControlBridgeClient['model']>>) => void = () => {}
    const bridge: ControlBridgeClient = {
      model: () => new Promise((resolve) => { resolveModel = resolve }),
      run: vi.fn(),
    }
    render(<DeveloperModeRow bridge={bridge} t={t} />)
    const toggle = screen.getByRole('switch', { name: zh['developerMode.title'] })
    expect(disabled(toggle)).toBe(true)
    expect(screen.getByText(zh['developerMode.off'])).toBeTruthy()
    expect(screen.getByText(zh['developerMode.on'])).toBeTruthy()
    expect(screen.getByText(zh['developerMode.restart'])).toBeTruthy()
    resolveModel({ changed: true, revision: 1, model: snapshot(false) })
    await waitFor(() => { expect(disabled(toggle)).toBe(false) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('打开发 developer-mode-set，显示应答里的值', async () => {
    const run = vi.fn(async () => snapshot(true))
    render(<DeveloperModeRow bridge={bridgeOf(false, run)} t={t} />)
    const toggle = screen.getByRole('switch', { name: zh['developerMode.title'] })
    await waitFor(() => { expect(disabled(toggle)).toBe(false) })
    fireEvent.click(toggle)
    expect(run).toHaveBeenCalledWith({ type: 'developer-mode-set', enabled: true })
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
  })

  it('用户在确认框里取消：应答仍是旧值，开关回到关', async () => {
    const run = vi.fn(async () => snapshot(false))
    render(<DeveloperModeRow bridge={bridgeOf(false, run)} t={t} />)
    const toggle = screen.getByRole('switch', { name: zh['developerMode.title'] })
    await waitFor(() => { expect(disabled(toggle)).toBe(false) })
    fireEvent.click(toggle)
    await waitFor(() => { expect(run).toHaveBeenCalled() })
    await waitFor(() => { expect(disabled(toggle)).toBe(false) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('失败时把原因写出来，值不变', async () => {
    const run = vi.fn(async () => { throw new Error('UI 状态写入失败') })
    render(<DeveloperModeRow bridge={bridgeOf(true, run)} t={t} />)
    const toggle = screen.getByRole('switch', { name: zh['developerMode.title'] })
    await waitFor(() => { expect(disabled(toggle)).toBe(false) })
    fireEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'UI 状态写入失败')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })
})
