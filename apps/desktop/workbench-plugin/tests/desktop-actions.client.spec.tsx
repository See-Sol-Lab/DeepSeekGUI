// @vitest-environment jsdom
/**
 * DesktopActions component specs (invisible since D1, 2026-09-05): the
 * component paints nothing visible, keeps the phase on a data attribute,
 * polls the desktop model with revision gating, and opens each
 * notification-click navigation nonce exactly once. Without the bridge the
 * component renders nothing at all.
 * @module @see-sol-lab/deepseekgui-workbench/tests/desktop-actions
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopActions } from '../src/client/DesktopActions.tsx'
import type { ControlBridgeClient, ControlModelSnapshot } from '../src/client/bridge.ts'

const runningModel = { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1 } as ControlModelSnapshot

function bridgeStub(overrides: Partial<ControlBridgeClient> = {}): ControlBridgeClient {
  return {
    model: vi.fn().mockResolvedValue({ changed: true, revision: 1, model: runningModel }),
    run: vi.fn().mockResolvedValue(runningModel),
    ...overrides,
  }
}

const t = (key: string) => key
// B4-P8: the notification-click navigation lands on this injected open.
const openSession = vi.fn()
/** The phase the invisible marker carries. */
const phaseOf = (container: HTMLElement): string | undefined =>
  container.querySelector<HTMLElement>('[data-deepseekgui-phase]')?.dataset.deepseekguiPhase

beforeEach(() => { openSession.mockClear() })

// 仓库惯例（见 ui-sidebar/tests/sidebar-root.client.spec.tsx）：全局 setup 不做
// testing-library cleanup，组件测试文件自带——否则 DOM 跨用例残留，
// screen 查询命中前一个用例的元素。
afterEach(() => { cleanup() })

describe('DesktopActions', () => {
  it('renders nothing without the control bridge', () => {
    const { container } = render(<DesktopActions wide t={t as never} bridge={null} openSession={openSession} />)
    expect(container.childElementCount).toBe(0)
  })

  it('paints nothing visible (D1) while the poll runs and the phase rides a data attribute', async () => {
    const bridge = bridgeStub()
    const { container } = render(<DesktopActions wide t={t as never} bridge={bridge} openSession={openSession} />)
    await vi.waitFor(() => { expect(phaseOf(container)).toBe('status.running') })
    expect(container.querySelector('button')).toBeNull()
    expect(container.textContent).toBe('')
    expect(bridge.model).toHaveBeenCalled()
  })

  it('records the bridge error state when the model fetch fails', async () => {
    const bridge = bridgeStub({ model: vi.fn().mockRejectedValue(new Error('down')) })
    const { container } = render(<DesktopActions wide t={t as never} bridge={bridge} openSession={openSession} />)
    await vi.waitFor(() => { expect(phaseOf(container)).toBe('actions.bridge.error') })
  })
})

describe('DesktopActions revision gating (P9-2)', () => {
  it('first fetch is unconditional, idle ticks send since, changed:false leaves state alone, failure recovers with a full fetch', async () => {
    vi.useFakeTimers()
    try {
      const model = vi.fn()
        .mockResolvedValueOnce({ changed: true, revision: 5, model: { ...runningModel, revision: 5 } })
        .mockResolvedValueOnce({ changed: false, revision: 5 })
        .mockRejectedValueOnce(new Error('bridge down'))
        .mockResolvedValueOnce({ changed: true, revision: 7, model: { ...runningModel, revision: 7, status: { phase: 'recovered' } } })
      const bridge = { model, run: vi.fn() } as unknown as ControlBridgeClient
      const { container } = render(<DesktopActions wide t={(k: string) => k} bridge={bridge} openSession={openSession} />)

      // 1. First fetch carries no since (null = unconditional full model).
      await vi.waitFor(() => { expect(model).toHaveBeenCalledTimes(1) })
      expect(model.mock.calls[0]?.[0]).toBeNull()
      await vi.waitFor(() => { expect(phaseOf(container)).toBe('status.running') })

      // 2. The idle tick sends the seen revision; changed:false keeps state.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(model).toHaveBeenCalledTimes(2)
      expect(model.mock.calls[1]?.[0]).toBe(5)
      expect(phaseOf(container)).toBe('status.running')

      // 3. The next tick fails: error state renders and the revision resets,
      //    so recovery re-fetches the full model unconditionally.
      await vi.advanceTimersByTimeAsync(2_000)
      expect(model.mock.calls[2]?.[0]).toBe(5)
      await vi.waitFor(() => { expect(phaseOf(container)).toBe('actions.bridge.error') })
      await vi.advanceTimersByTimeAsync(2_000)
      expect(model.mock.calls[3]?.[0]).toBeNull()
      await vi.waitFor(() => { expect(phaseOf(container)).toBe('status.recovered') })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('Notification-click navigation (B4-P8)', () => {
  it('a new nonce navigates again; absent navigateRequest never navigates', async () => {
    vi.useFakeTimers()
    try {
      const model = vi.fn()
        .mockResolvedValueOnce({ changed: true, revision: 1, model: { ...runningModel, navigateRequest: { sessionId: 's1', nonce: 1 } } })
        .mockResolvedValueOnce({ changed: false, revision: 1 })
        .mockResolvedValueOnce({ changed: true, revision: 2, model: { ...runningModel, navigateRequest: { sessionId: 's2', nonce: 2 } } })
        .mockResolvedValue({ changed: false, revision: 2 })
      const bridge = { model, run: vi.fn() } as unknown as ControlBridgeClient
      render(<DesktopActions wide t={(k: string) => k} bridge={bridge} openSession={openSession} />)
      await vi.waitFor(() => { expect(openSession).toHaveBeenCalledWith('s1') })
      await vi.advanceTimersByTimeAsync(4_000)
      await vi.waitFor(() => { expect(openSession).toHaveBeenCalledWith('s2') })
      expect(openSession).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
