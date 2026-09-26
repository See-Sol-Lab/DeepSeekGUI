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

/** 0.1.7: a pending-interaction map becomes the per-session status map the watcher now reads. */
const statusesOf = (pending: ReadonlyMap<string, unknown>): ReadonlyMap<string, unknown> =>
  new Map([...pending].map(([id, interaction]) => [id, { running: true, pendingInteraction: interaction, completionUnread: false }]))
/** 0.1.7: jobs come from the job controller's client store, injected as `jobs`. */
// The fake returns one stable snapshot object, as the real store guarantees (a fresh object per call spins useSyncExternalStore).
const jobsStore = (rows: unknown) => {
  const snapshot = { rows: rows as Record<string, never> }
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

const baseProps = (over: Record<string, unknown> = {}): NotificationWatcherProps => ({
  t: tNotify,
  bridge: { model: vi.fn(), run },
  useSessions: vi.fn((select: (s: unknown) => unknown) => select({ byId: {}, ids: [] })),
  usePanelInfo: vi.fn((select: (s: unknown) => unknown) => select({ activePanelId: null })),
  useSessionStatus: vi.fn((select: (s: unknown) => unknown) => select(new Map())),
  jobs: jobsStore({}),
  sessionId: 's1',
  useConversation: vi.fn(() => undefined),
  useWorkspaces: vi.fn(),
  ...over,
} as never)

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

const sessionList = (jobs: unknown): unknown => jobs

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
          useSessionStatus: vi.fn((select: (s: unknown) => unknown) => select(statusesOf(value as ReadonlyMap<string, unknown>))),
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
        select={value => baseProps({ jobs: jobsStore(value) })}
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

  it('reads a class-instance jobs store through the instance, as the real ClientJobsModel is', () => {
    // Methods read `this` like the official model; a detached call would throw.
    class ClassStore {
      private readonly snapshot = { rows: { s1: [{ id: 'job-1', kind: 'service', label: 'dev server', status: 'running' }] } }
      getSnapshot() { return this.snapshot }
      subscribe(_listener: () => void) { return () => { void this.snapshot } }
    }
    const view = render(<NotificationWatcher {...baseProps({ jobs: new ClassStore() })} />)
    expect(view.container.textContent).toBe('')
    expect(run).toHaveBeenCalledTimes(0)
  })

  describe('while the window has focus', () => {
    const approval = (sessionId: string, callId: string) => ({ kind: 'approval', key: `approval:${callId}`, sessionId, callId, toolName: 'pwsh', reason: 'run' })
    /** Props for: the main view retains `viewing`, panel `panel` covers the main area (null = none), and these pendings. */
    const focusedProps = (viewing: string | undefined, pending: ReadonlyMap<string, unknown>, panel: string | null = null) => baseProps({
      useSessions: vi.fn((select: (s: unknown) => unknown) => select({
        byId: Object.fromEntries(['a', 'b'].map(id => [id, { id, retainedBy: id === viewing ? { mainView: 1 } : {} }])),
        ids: ['a', 'b'],
      })),
      usePanelInfo: vi.fn((select: (s: unknown) => unknown) => select({ activePanelId: panel })),
      useSessionStatus: vi.fn((select: (s: unknown) => unknown) => select(statusesOf(pending))),
    })
    beforeEach(() => { vi.spyOn(document, 'hasFocus').mockReturnValue(true) })
    afterEach(() => { vi.restoreAllMocks() })

    it('notifies another session once while the user looks at one session', () => {
      const pending = new Map([['b', approval('b', 'call-b')]])
      const view = render(<StepHost snapshots={[pending, new Map(pending)]} select={value => focusedProps('a', value as ReadonlyMap<string, unknown>)} />)
      expect(run).toHaveBeenCalledTimes(1)
      expect(run.mock.calls[0]?.[0]).toMatchObject({ type: 'notify', sessionId: 'b', kind: 'approval' })
      fireEvent.click(view.getByText('step'))
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('stays quiet for the session being looked at, and does not replay it after switching away', () => {
      const pending = new Map([['b', approval('b', 'call-b')]])
      const view = render(<StepHost snapshots={['b', 'a']} select={value => focusedProps(value as string, pending)} />)
      expect(run).toHaveBeenCalledTimes(0)
      fireEvent.click(view.getByText('step'))
      expect(run).toHaveBeenCalledTimes(0)
    })

    it('notifies the viewed session when a panel covers the main area', () => {
      render(<NotificationWatcher {...focusedProps('b', new Map([['b', approval('b', 'call-b')]]), 'settings')} />)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('notifies on the home screen, where no session is in the main view', () => {
      render(<NotificationWatcher {...focusedProps(undefined, new Map([['b', approval('b', 'call-b')]]))} />)
      expect(run).toHaveBeenCalledTimes(1)
    })

    it('notifies the viewed session when the window loses focus', () => {
      vi.spyOn(document, 'hasFocus').mockReturnValue(false)
      render(<NotificationWatcher {...focusedProps('b', new Map([['b', approval('b', 'call-b')]]))} />)
      expect(run).toHaveBeenCalledTimes(1)
    })
  })
})
