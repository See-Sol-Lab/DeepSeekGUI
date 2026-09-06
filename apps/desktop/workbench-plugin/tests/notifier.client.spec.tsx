// @vitest-environment jsdom

/**
 * Notification-watcher specs (B5-P6): official pending interactions and job
 * transitions become one-shot `notify` bridge commands, deduplicated per
 * session + official event id; the component renders nothing.
 * @module @see-sol-lab/deepseekgui-workbench/tests/notifier
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { zh as notifyZh } from '../src/client/locales-notify.ts'
import { NotificationWatcher, type NotificationWatcherProps } from '../src/client/NotificationWatcher.tsx'

afterEach(cleanup)

const run = vi.fn(async () => ({}))

beforeEach(() => { run.mockClear() })

const tNotify = (key: string, params?: Record<string, string | number>): string => {
  let text = (notifyZh as unknown as Record<string, string>)[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

const baseProps = (over: Record<string, unknown> = {}): NotificationWatcherProps => ({
  t: tNotify,
  bridge: { model: vi.fn(), run },
  useSessions: vi.fn((select: (s: unknown) => unknown) => select({
    current: undefined,
    byId: {},
    ids: [],
    jobsBySession: {},
  })),
  useSessionPendingInteraction: vi.fn((select: (s: unknown) => unknown) => select(new Map())),
  sessionId: 's1',
  useConversation: vi.fn(() => undefined),
  useWorkspaces: vi.fn(),
  ...over,
} as unknown as NotificationWatcherProps)

/** Host that re-renders the watcher with each step's snapshot value. */
function StepHost({
  snapshots,
  select,
}: {
  snapshots: readonly unknown[]
  select: (value: unknown) => NotificationWatcherProps
}) {
  const [step, setStep] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setStep(value => Math.min(value + 1, snapshots.length - 1))}>step</button>
      <NotificationWatcher {...select(snapshots[step])} />
    </>
  )
}

const sessionList = (jobs: unknown): unknown => ({
  current: undefined,
  byId: {},
  ids: [],
  jobsBySession: jobs,
})

describe('NotificationWatcher', () => {
  it('renders nothing and sends one notify per approval, keyed by session + official call id', () => {
    const approval = {
      kind: 'approval',
      key: 'approval:1',
      sessionId: 's1',
      callId: 'call-9',
      toolName: 'git_commit',
      reason: 'commit staged',
    }
    const maps = [
      new Map([['s1', approval]]),
      // Same official approval re-rendered under a new page key must stay silent.
      new Map([['s1', { ...approval, key: 'approval:2' }]]),
    ]
    const view = render(
      <StepHost
        snapshots={maps}
        select={value => baseProps({
          useSessionPendingInteraction: vi.fn((select: (s: unknown) => unknown) => select(value)),
        })}
      />,
    )
    // The watcher itself renders nothing: the host only contributes its step button.
    expect(view.container.textContent).toBe('step')
    expect(run).toHaveBeenCalledTimes(1)
    const command = run.mock.calls[0]?.[0] as Record<string, unknown>
    expect(command).toMatchObject({
      type: 'notify',
      kind: 'approval',
      sessionId: 's1',
      id: 's1/approval/call-9',
      title: '需要审批',
    })
    expect(String(command.body)).toContain('git_commit')
    fireEvent.click(view.getByText('step'))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('notifies job transitions only after a baseline sighting and never twice', () => {
    const running = sessionList({ s1: [{ id: 'job-1', kind: 'service', label: 'dev server', status: 'running' }] })
    const completed = sessionList({ s1: [{ id: 'job-1', kind: 'service', label: 'dev server', status: 'completed' }] })
    const view = render(
      <StepHost
        snapshots={[running, completed, completed]}
        select={value => baseProps({
          useSessions: vi.fn((select: (s: unknown) => unknown) => select(value)),
        })}
      />,
    )
    // Baseline running: memory only, no notification.
    expect(run).toHaveBeenCalledTimes(0)
    fireEvent.click(view.getByText('step'))
    expect(run).toHaveBeenCalledTimes(1)
    const command = run.mock.calls[0]?.[0] as Record<string, unknown>
    expect(command).toMatchObject({ type: 'notify', kind: 'job', sessionId: 's1', title: '后台工作完成' })
    expect(String(command.body)).toContain('dev server')
    // Replay of the terminal state must stay silent.
    fireEvent.click(view.getByText('step'))
    expect(run).toHaveBeenCalledTimes(1)
  })
})
