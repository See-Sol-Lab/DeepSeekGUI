// @vitest-environment jsdom
/**
 * FirstRunGuide (B6-P5): shows only when the desktop reports a pending first
 * run, explains the current step in plain language, and writes the completion
 * fact only through the user's own action.
 * @module @see-sol-lab/deepseekgui-workbench/tests/first-run-guide
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FirstRunGuide } from '../src/client/FirstRunGuide.tsx'
import type { ControlBridgeClient } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const sessionId = 'first-run-session' as SessionId

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

interface NodeLike { readonly kind: string }

function mount(options: {
  pending: boolean
  nodes?: readonly NodeLike[]
  approval?: { toolName: string } | null
  bridge?: ControlBridgeClient | null
  credentialConfigured?: () => Promise<boolean>
}) {
  const bridge = options.bridge === undefined ? bridgeStub(options.pending) : options.bridge
  const nodes = options.nodes ?? []
  const chat = { nodes: new Map(nodes.map((node, index) => [`n${String(index)}`, node])) }
  const interaction = options.approval === undefined || options.approval === null
    ? new Map()
    : new Map([[sessionId, { kind: 'approval', key: 'approval:1', sessionId, toolName: options.approval.toolName }]])
  const useConversation = ((select: (snapshot: unknown) => unknown) =>
    select({ views: new Map([['chat', chat]]) })) as never
  const useSessionPendingInteraction = ((select: (snapshot: unknown) => unknown) => select(interaction)) as never
  return {
    bridge,
    ...render(
      <FirstRunGuide
        bridge={bridge}
        credentialConfigured={options.credentialConfigured ?? (async () => false)}
        useConversation={useConversation}
        useSessionPendingInteraction={useSessionPendingInteraction}
        sessionId={sessionId}
        t={t}
      />,
    ),
  }
}

describe('FirstRunGuide', () => {
  it('renders nothing when the desktop reports no pending first run', async () => {
    const { bridge } = mount({ pending: false })
    await waitFor(() => { expect(bridge.model).toHaveBeenCalled() })
    expect(screen.queryByText(zh['firstRun.skip'])).toBeNull()
  })

  it('renders nothing without a desktop bridge', () => {
    mount({ pending: true, bridge: null })
    expect(screen.queryByText(zh['firstRun.skip'])).toBeNull()
  })

  it('explains the model step before the first message, with a skip control', async () => {
    mount({ pending: true })
    expect(await screen.findByText(zh['firstRun.model'])).toBeTruthy()
    expect(screen.getByRole('button', { name: zh['firstRun.skip'] })).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh['firstRun.skip'] })).toBeTruthy()
  })

  it('skips the key step when the official credential is already configured', async () => {
    mount({ pending: true, credentialConfigured: async () => true })
    expect(await screen.findByText(zh['firstRun.message'])).toBeTruthy()
    expect(screen.queryByText(zh['firstRun.model'])).toBeNull()
  })

  it('treats a refused credential read as not configured (never claims a key)', async () => {
    mount({ pending: true, credentialConfigured: async () => { throw new Error('offline') } })
    expect(await screen.findByText(zh['firstRun.model'])).toBeTruthy()
  })

  it('waits for the reply after the first message', async () => {
    mount({ pending: true, nodes: [{ kind: 'user' }] })
    expect(await screen.findByText(zh['firstRun.waiting'])).toBeTruthy()
  })

  it('names the tool a pending approval is about and keeps the decision in the official UI', async () => {
    mount({ pending: true, nodes: [{ kind: 'user' }, { kind: 'assistant-step' }], approval: { toolName: 'write_file' } })
    const text = zh['firstRun.approval'].replace('{tool}', 'write_file')
    expect(await screen.findByText(text)).toBeTruthy()
    // No approve/deny control here: the user decides in the official card.
    expect(screen.queryByRole('button', { name: /允许|拒绝|Allow|Deny/ })).toBeNull()
  })

  it('ends at the first answer and writes the completion itself', async () => {
    // 句芒 2026-09-10: the guide used to close by pointing at the Changes tab.
    // Plenty of users never open a repository, so that was advice about an
    // empty page — reaching a first answer is where a first run is done.
    const { bridge } = mount({ pending: true, nodes: [{ kind: 'user' }, { kind: 'assistant-step' }] })
    await waitFor(() => {
      expect(bridge.run).toHaveBeenCalledWith({ type: 'first-run-dismiss' })
    })
    expect(screen.queryByRole('button', { name: zh['firstRun.skip'] })).toBeNull()
  })

  it('still ends at the first answer when the turn used tools', async () => {
    const { bridge } = mount({ pending: true, nodes: [{ kind: 'user' }, { kind: 'assistant-step' }, { kind: 'tool-call' }] })
    await waitFor(() => {
      expect(bridge.run).toHaveBeenCalledWith({ type: 'first-run-dismiss' })
    })
  })

  it('skips through the same single completion command', async () => {
    const { bridge } = mount({ pending: true })
    const skip = await screen.findByRole('button', { name: zh['firstRun.skip'] })
    skip.focus()
    expect(document.activeElement).toBe(skip)
    fireEvent.click(skip)
    await waitFor(() => {
      expect(bridge.run).toHaveBeenCalledWith({ type: 'first-run-dismiss' })
    })
  })
})
