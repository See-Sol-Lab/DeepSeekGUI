// @vitest-environment jsdom
/**
 * Archived-sessions settings section (B6-P11): the archive reads, restores and
 * (on the desktop) deletes from Settings now, not from a group pinned under
 * the sidebar tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ArchivedSessionsSection, type ArchivedSessionsSectionProps } from '../src/client/ArchivedSessionsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as ArchivedSessionsSectionProps['t']
const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

const summary = (id: string, title: string): SessionSummary => ({
  id: sid(id), displayTitle: title, running: false, blank: false, updatedAt: 1,
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {},
  currentAddress: undefined,
})
const workspace = (id: string, sessionIds: string[], title = id): WorkspaceView => ({
  workspaceId: wid(id), path: `/projects/${id}`, title,
  sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const workspaceState = (
  items: readonly WorkspaceView[],
  archivedSessionIds: readonly SessionId[] = [],
): WorkspaceSnapshot => ({ items, archivedSessionIds, state: 'idle', phase: 'ready', error: null })

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(overrides: Partial<ArchivedSessionsSectionProps> = {}) {
  const props = {
    t,
    close: vi.fn(),
    useSessions: hook(sessionState([summary('gone', '已归档的会话'), summary('kept', 'Kept')])),
    useWorkspaces: hook(workspaceState([workspace('alpha', ['gone', 'kept'], 'Alpha')], [sid('gone')])),
    restore: vi.fn(async () => {}),
    open: vi.fn(),
    ...overrides,
  } as unknown as ArchivedSessionsSectionProps
  return { props, ...render(<ArchivedSessionsSection {...props} />) }
}

describe('ArchivedSessionsSection', () => {
  it('lists one row per archived session with the workspace it returns to', () => {
    mount()
    expect(screen.getByText('已归档的会话')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    // Sessions that are not archived never appear here.
    expect(screen.queryByText('Kept')).toBeNull()
  })

  it('restores through the host write, then opens — never the other way round', async () => {
    const order: string[] = []
    const restore = vi.fn(async () => { order.push('restore') })
    const open = vi.fn(() => { order.push('open') })
    mount({ restore, open })
    fireEvent.click(screen.getByRole('button', { name: '恢复并打开' }))
    await waitFor(() => { expect(open).toHaveBeenCalledWith(sid('gone')) })
    expect(restore).toHaveBeenCalledWith(sid('gone'))
    expect(order).toEqual(['restore', 'open'])
  })

  it('says so in one line when nothing is archived', () => {
    mount({ useWorkspaces: hook(workspaceState([workspace('alpha', ['kept'])])) })
    expect(screen.getByText(zh['settings.archived.empty'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: '恢复并打开' })).toBeNull()
  })

  it('shows no trash at all when the page has no desktop bridge', () => {
    // A browser tab reaches the same harness; erasing files is the desktop
    // host's authority, so the archive reads and restores there and no more.
    mount()
    expect(screen.queryByRole('button', { name: '删除会话' })).toBeNull()
  })

  it('asks before deleting, and the row follows the session list rather than local memory', async () => {
    const deleteSession = vi.fn(async () => {})
    const { rerender, props } = mount({ deleteSession })
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    // Arming says what is about to happen; nothing is erased yet.
    expect(screen.getByText(zh['archived.deleteWarning'])).toBeTruthy()
    expect(deleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['archived.deleteConfirm'] }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledWith(sid('gone')) })
    // The erase alone changes nothing on screen: the harness announces the
    // removal and the session leaves the list. Hiding it here instead is what
    // made the row come back on the next tab switch (2026-09-11 #20).
    expect(screen.getByText('已归档的会话')).toBeTruthy()
    rerender(<ArchivedSessionsSection {...props} useSessions={hook(sessionState([summary('kept', 'Kept')]))} />)
    expect(screen.queryByText('已归档的会话')).toBeNull()
    expect(screen.getByText(zh['settings.archived.empty'])).toBeTruthy()
  })

  it('cancels back to the row without erasing anything', () => {
    const deleteSession = vi.fn(async () => {})
    mount({ deleteSession })
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: zh['archived.deleteCancel'] }))
    expect(deleteSession).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '恢复并打开' })).toBeTruthy()
  })

  it('keeps the row and says why when the erase fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deleteSession = vi.fn(async () => { throw new Error('EBUSY: file is open') })
    mount({ deleteSession })
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: zh['archived.deleteConfirm'] }))
    // A delete that erased nothing must be visible, not console-only.
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('EBUSY: file is open') })
    expect(screen.getByText('已归档的会话')).toBeTruthy()
    warn.mockRestore()
  })

  it('keeps the row when the restore write rejects, and does not open', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const open = vi.fn()
    const restore = vi.fn(async () => { throw new Error('restore exploded') })
    mount({ restore, open })
    fireEvent.click(screen.getByRole('button', { name: '恢复并打开' }))
    await waitFor(() => { expect(warn).toHaveBeenCalled() })
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByText('已归档的会话')).toBeTruthy()
    warn.mockRestore()
  })
})
