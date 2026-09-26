// @vitest-environment jsdom
/**
 * Settings → Archived sessions (住户 2026-09-23, back from B6-P11 into our
 * plugin): the archive reads, restores, and (in a DeepSeekGUI window) deletes
 * from Settings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ArchivedSessionsSection, archivedRows, type ArchivedSessionsSectionProps } from '../src/client/ArchivedSessionsSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: string) => (zh as Record<string, string>)[key] ?? key) as ArchivedSessionsSectionProps['t']
const sid = (id: string): SessionId => id as SessionId

const summary = (title: string, extra: Record<string, unknown> = {}) => ({ displayTitle: title, blank: false, cwd: 'C:\\work\\alpha', ...extra })

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function mount(overrides: Partial<ArchivedSessionsSectionProps> = {}) {
  const props = {
    t,
    useSessions: hook({ byId: { gone: summary('已归档的会话'), kept: summary('Kept') } }),
    useWorkspaces: hook({
      items: [{ title: 'Alpha', sessionIds: [sid('gone'), sid('kept')] }],
      archivedSessionIds: [sid('gone')],
    }),
    restore: vi.fn(async () => {}),
    open: vi.fn(),
    deleteSession: null,
    ...overrides,
  } as unknown as ArchivedSessionsSectionProps
  return { props, ...render(<ArchivedSessionsSection {...props} />) }
}

describe('archivedRows', () => {
  it('keeps archive order, drops unknown and duplicate ids, falls back to the folder name', () => {
    const rows = archivedRows(
      // A renamed session keeps its name even without a turn (blank).
      { a: summary('A', { blank: true }), b: summary('', { blank: true, cwd: 'C:\\work\\beta\\' }) },
      [{ title: 'Alpha', sessionIds: [sid('a')] }],
      [sid('b'), sid('missing'), sid('a'), sid('b')],
    )
    expect(rows).toEqual([
      { id: 'b', title: 'beta', workspace: '' },
      { id: 'a', title: 'A', workspace: 'Alpha' },
    ])
  })
})

describe('ArchivedSessionsSection', () => {
  it('lists only archived sessions, with the workspace they return to', () => {
    mount()
    expect(screen.getByText('已归档的会话')).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.queryByText('Kept')).toBeNull()
  })

  it('restores through the host write, then opens', async () => {
    const order: string[] = []
    const restore = vi.fn(async () => { order.push('restore') })
    const open = vi.fn(() => { order.push('open') })
    mount({ restore, open })
    fireEvent.click(screen.getByRole('button', { name: '恢复并打开' }))
    await waitFor(() => { expect(open).toHaveBeenCalledWith(sid('gone')) })
    expect(order).toEqual(['restore', 'open'])
  })

  it('says so in one line when nothing is archived', () => {
    mount({ useWorkspaces: hook({ items: [], archivedSessionIds: [] }) } as unknown as Partial<ArchivedSessionsSectionProps>)
    expect(screen.getByText(zh['archived.empty'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: '恢复并打开' })).toBeNull()
  })

  it('has no delete affordance outside a DeepSeekGUI window', () => {
    mount({ deleteSession: null })
    expect(screen.queryByRole('button', { name: '删除会话' })).toBeNull()
  })

  it('asks before deleting, then deletes through the desktop channel', async () => {
    const deleteSession = vi.fn(async () => {})
    mount({ deleteSession })
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    expect(deleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledWith(sid('gone')) })
  })

  it('shows a failed delete on screen and keeps the row', async () => {
    const deleteSession = vi.fn(async () => { throw new Error('bridge gone') })
    mount({ deleteSession })
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('bridge gone') })
    expect(screen.getByText('已归档的会话')).toBeTruthy()
  })
})
