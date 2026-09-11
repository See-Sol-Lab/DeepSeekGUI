// @vitest-environment jsdom
/**
 * FirstRunWorkspaceGuide (P11): the guide's first step must show with no
 * Session at all — a fresh install has no workspace, and without one no
 * Session can be created. It renders only while the desktop reports a pending
 * first run and no workspace exists, and its skip writes the same single
 * completion fact as the session steps.
 * @module @see-sol-lab/deepseekgui-workbench/tests/first-run-workspace-guide
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FirstRunWorkspaceGuide } from '../src/client/FirstRunWorkspaceGuide.tsx'
import type { ControlBridgeClient } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never

function bridgeStub(pending: boolean): ControlBridgeClient {
  return {
    model: vi.fn(async () => ({
      changed: true as const,
      revision: 1,
      model: {
        status: { phase: 'running' as const },
        activeProfile: 'web',
        homeKind: 'managed' as const,
        revision: 1,
        firstRun: { pending },
      },
    })),
    run: vi.fn(async () => ({}) as never),
  }
}

function mount(options: {
  pending: boolean
  workspaceCount?: number
  bridge?: ControlBridgeClient | null
}) {
  const bridge = options.bridge === undefined ? bridgeStub(options.pending) : options.bridge
  const useWorkspaces = ((select: (snapshot: unknown) => unknown) =>
    select({ items: Array.from({ length: options.workspaceCount ?? 0 }, (_, index) => ({ workspaceId: `w${String(index)}` })) })) as never
  return {
    bridge,
    ...render(
      <FirstRunWorkspaceGuide
        bridge={bridge}
        useWorkspaces={useWorkspaces}
        t={t}
      />,
    ),
  }
}

describe('FirstRunWorkspaceGuide', () => {
  it('explains the workspace step before any workspace exists', async () => {
    mount({ pending: true })
    expect(await screen.findByText(zh['firstRun.workspace'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['firstRun.skip'] })).toBeTruthy()
  })

  it('renders nothing once a workspace exists (the step is done)', async () => {
    const { bridge } = mount({ pending: true, workspaceCount: 1 })
    await waitFor(() => { expect(bridge.model).toHaveBeenCalled() })
    expect(screen.queryByText(zh['firstRun.workspace'])).toBeNull()
  })

  it('renders nothing when the desktop reports no pending first run', async () => {
    const { bridge } = mount({ pending: false })
    await waitFor(() => { expect(bridge.model).toHaveBeenCalled() })
    expect(screen.queryByText(zh['firstRun.workspace'])).toBeNull()
  })

  it('renders nothing without a desktop bridge', () => {
    mount({ pending: true, bridge: null })
    expect(screen.queryByText(zh['firstRun.workspace'])).toBeNull()
  })

  it('skips through the same single completion command', async () => {
    const { bridge } = mount({ pending: true })
    fireEvent.click(await screen.findByRole('button', { name: zh['firstRun.skip'] }))
    await waitFor(() => {
      expect(bridge.run).toHaveBeenCalledWith({ type: 'first-run-dismiss' })
    })
  })
})
