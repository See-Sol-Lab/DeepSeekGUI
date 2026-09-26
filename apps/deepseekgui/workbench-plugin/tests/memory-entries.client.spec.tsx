// @vitest-environment jsdom
/**
 * The entry list (B7-P9): reads the scope through the store, searches,
 * opens a detail with source and history, edits quoting the version it
 * read, shows a stale write as a conflict with a reload and never as done,
 * forgets and undoes, restores from the forgotten list, adds through the
 * same store, re-reads on Host changes without losing an open draft, and
 * drops a late result whose scope moved on.
 * @module @see-sol-lab/deepseekgui-workbench/tests/memory-entries
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MemoryEntry, MemoryForgottenEntry, MemoryScopeFilter } from '@deepseek-ai/dsh-workbench-memory/types'
import { MemoryEntries } from '../src/client/memory/MemoryEntries.tsx'
import type { MemoryRemote } from '../src/client/memory/model.ts'
import { zh } from '../src/client/locales-memory.ts'

afterEach(() => { cleanup() })

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })
const PROJECT = { kind: 'project' as const, projectKey: 'k-proj', path: 'E:/proj' }
const SESSION: MemoryScopeFilter = { kind: 'session', projectKey: 'k-proj' }

function entry(id: string, content: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id, content, kind: 'fact', scope: PROJECT, version: 1,
    source: { kind: 'assistant', sessionId: 's-old', at: '2026-09-13T10:00:00.000Z', evidence: 'package.json' },
    createdAt: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T10:00:00.000Z', ...over,
  }
}

/** A fake store over an in-memory list, answering the Remote result shape. */
function fakeMemory(initial: MemoryEntry[], forgotten: MemoryForgottenEntry[] = []) {
  const entries = new Map(initial.map(item => [item.id, item]))
  const kept = new Map(forgotten.map(item => [item.entry.id, item]))
  const remote = {
    list: vi.fn(async (query: { scope: MemoryScopeFilter; text?: string; kinds?: string[] }) => {
      const found = [...entries.values()].filter(item =>
        (query.text === undefined || item.content.toLowerCase().includes(query.text.toLowerCase()))
        && (query.kinds === undefined || query.kinds.includes(item.kind)))
      return ok({ entries: found, total: found.length })
    }),
    listForgotten: vi.fn(async () => ok([...kept.values()])),
    correct: vi.fn(async (input: { id: string; expectedVersion: number; content?: string; keywords?: string[]; kind?: MemoryEntry['kind'] }) => {
      const current = entries.get(input.id)
      if (current === undefined) return ok({ ok: false as const, error: { code: 'MEMORY_NOT_FOUND' as const, message: 'no entry' } })
      if (current.version !== input.expectedVersion) {
        return ok({ ok: false as const, error: { code: 'MEMORY_CONFLICT' as const, message: 'stale', currentVersion: current.version } })
      }
      const next: MemoryEntry = {
        ...current,
        content: input.content ?? current.content,
        ...input.keywords === undefined ? {} : { keywords: input.keywords },
        kind: input.kind ?? current.kind,
        version: current.version + 1,
        previous: { version: current.version, content: current.content, kind: current.kind, updatedAt: current.updatedAt },
        revised: { action: 'correct', at: '2026-09-13T11:00:00.000Z', source: { kind: 'user', at: '2026-09-13T11:00:00.000Z' } },
      }
      entries.set(input.id, next)
      return ok({ ok: true as const, entry: next })
    }),
    forget: vi.fn(async (input: { id: string; expectedVersion: number }) => {
      const current = entries.get(input.id)
      if (current === undefined || current.version !== input.expectedVersion) {
        return ok({ ok: false as const, error: { code: 'MEMORY_CONFLICT' as const, message: 'stale', currentVersion: current?.version } })
      }
      entries.delete(input.id)
      kept.set(input.id, { entry: current, forgottenAt: '2026-09-13T12:00:00.000Z', forgottenBy: { kind: 'user', at: '2026-09-13T12:00:00.000Z' } })
      return ok({ ok: true as const, entry: current })
    }),
    undo: vi.fn(async (input: { id: string; expectedVersion: number }) => {
      const current = entries.get(input.id)
      if (current?.previous === undefined) return ok({ ok: false as const, error: { code: 'MEMORY_NO_PREVIOUS' as const, message: 'nothing to undo' } })
      const next: MemoryEntry = {
        ...current,
        content: current.previous.content,
        version: current.version + 1,
        previous: { version: current.version, content: current.content, kind: current.kind, updatedAt: current.updatedAt },
      }
      entries.set(input.id, next)
      return ok({ ok: true as const, entry: next })
    }),
    restore: vi.fn(async (input: { id: string }) => {
      const record = kept.get(input.id)
      if (record === undefined) return ok({ ok: false as const, error: { code: 'MEMORY_NOT_FOUND' as const, message: 'no copy' } })
      kept.delete(input.id)
      const next = { ...record.entry, version: record.entry.version + 2 }
      entries.set(input.id, next)
      return ok({ ok: true as const, entry: next })
    }),
    remember: vi.fn(async (input: { kind: MemoryEntry['kind']; content: string }) => {
      const next = entry(`m_new${String(entries.size)}`, input.content, { kind: input.kind, source: { kind: 'user', at: 't' } })
      entries.set(next.id, next)
      return ok({ ok: true as const, entry: next })
    }),
  }
  return { remote: remote as unknown as MemoryRemote, entries, kept, calls: remote }
}

/** A change subscription the test can fire. */
function changeSource() {
  const listeners = new Set<() => void>()
  return {
    onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    fire: () => { for (const listener of [...listeners]) listener() },
  }
}

describe('MemoryEntries', () => {
  it('lists the scope, searches, opens the detail with source and evidence, and never writes on its own', async () => {
    const store = fakeMemory([entry('m_1', 'Port is 3000', { keywords: ['port'] }), entry('m_2', 'Answer in Chinese', { kind: 'preference', scope: { kind: 'global' } })])
    const { onChange } = changeSource()
    render(<MemoryEntries memory={store.remote} scope={SESSION} writeScope={PROJECT} sessionId="s-1" onChange={onChange} sessionPresent={() => false} t={t} title="T" />)
    await screen.findByText('Port is 3000')
    expect(store.calls.list).toHaveBeenCalledWith(expect.objectContaining({ scope: SESSION, limit: 100 }), expect.any(AbortSignal))
    expect(screen.getByText(zh['list.count'].replace('{total}', '2'))).toBeTruthy()
    // Detail: source, evidence, keywords; the source session is not on the list.
    fireEvent.click(screen.getByText('Port is 3000'))
    const detail = document.querySelector('[data-deepseekgui="memory-entry-detail"]') as HTMLElement
    expect(detail.textContent).toContain('package.json')
    expect(detail.textContent).toContain('s-old')
    expect(detail.textContent).toContain(zh['entry.sourceSessionMissing'])
    expect(detail.textContent).toContain('port')
    // Search narrows through the store.
    fireEvent.change(screen.getByLabelText(zh['list.search']), { target: { value: 'chinese' } })
    await waitFor(() => { expect(store.calls.list).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'chinese' }), expect.any(AbortSignal)) })
    await screen.findByText('Answer in Chinese')
    expect(screen.queryByText('Port is 3000')).toBeNull()
    expect(store.calls.correct).not.toHaveBeenCalled()
    expect(store.calls.forget).not.toHaveBeenCalled()
  })

  it('edits quoting the read version, shows a conflict with a reload instead of done, and keeps the draft when the store changes underneath', async () => {
    const store = fakeMemory([entry('m_1', 'Port is 3000')])
    const { onChange, fire } = changeSource()
    render(<MemoryEntries memory={store.remote} scope={SESSION} writeScope={PROJECT} onChange={onChange} t={t} title="T" />)
    fireEvent.click(await screen.findByText('Port is 3000'))
    fireEvent.click(screen.getByText(zh['entry.edit']))
    const box = screen.getByLabelText(zh['edit.content']) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Port is 3100' } })
    fireEvent.change(screen.getByLabelText(zh['edit.keywords']), { target: { value: 'port, api' } })
    // Another window corrects the entry first.
    const live = store.entries.get('m_1') as MemoryEntry
    store.entries.set('m_1', { ...live, content: 'Port is 3200', version: 2 })
    await act(async () => { fire() })
    expect(await screen.findByText(zh['entry.changedElsewhere'], { exact: false })).toBeTruthy()
    expect(box.value).toBe('Port is 3100')
    // Saving with the stale version is refused: a conflict, no "saved".
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-entry-save"]') as HTMLButtonElement)
    expect(await screen.findByText(zh['entry.conflict'].replace('{version}', '2'), { exact: false })).toBeTruthy()
    expect(store.calls.correct).toHaveBeenCalledWith({ id: 'm_1', expectedVersion: 1, content: 'Port is 3100', keywords: ['port', 'api'], kind: 'fact', source: { kind: 'user' } })
    expect(screen.queryByText(zh['entry.saved'])).toBeNull()
    // Reload, edit again with the current version: saved.
    fireEvent.click(screen.getAllByText(zh['entry.reload'])[0] as HTMLElement)
    await screen.findByRole('button', { name: 'Port is 3200' })
    // The row stays open after the reload; edit from its detail.
    if (screen.queryByText(zh['entry.edit']) === null) fireEvent.click(screen.getByRole('button', { name: 'Port is 3200' }))
    fireEvent.click(screen.getByText(zh['entry.edit']))
    fireEvent.change(screen.getByLabelText(zh['edit.content']), { target: { value: 'Port is 3300' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-entry-save"]') as HTMLButtonElement)
    await screen.findByText(zh['entry.saved'])
    expect(store.calls.correct).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm_1', expectedVersion: 2, content: 'Port is 3300' }))
    expect(screen.getByRole('button', { name: 'Port is 3300' })).toBeTruthy()
    // An empty edit is refused before any call.
    fireEvent.click(screen.getByText(zh['entry.edit']))
    fireEvent.change(screen.getByLabelText(zh['edit.content']), { target: { value: '  ' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-entry-save"]') as HTMLButtonElement)
    expect(await screen.findByText(zh['entry.failed'].replace('{message}', zh['edit.empty']))).toBeTruthy()
    expect(store.calls.correct).toHaveBeenCalledTimes(2)
  })

  it('undoes the latest change, forgets with the read version, and restores from the forgotten list', async () => {
    const corrected = entry('m_1', 'Port is 3100', { version: 2, previous: { version: 1, content: 'Port is 3000', kind: 'fact', updatedAt: 't' }, revised: { action: 'correct', at: '2026-09-13T11:00:00.000Z', source: { kind: 'assistant', sessionId: 's-old', sessionDeleted: true, at: 't' } } })
    const store = fakeMemory([corrected, entry('m_2', 'Deploy with deploy.sh')])
    const { onChange } = changeSource()
    render(<MemoryEntries memory={store.remote} scope={SESSION} writeScope={PROJECT} sessionId="s-1" onChange={onChange} t={t} title="T" />)
    fireEvent.click(await screen.findByText('Port is 3100'))
    const detail = document.querySelector('[data-deepseekgui="memory-entry-detail"]') as HTMLElement
    expect(detail.textContent).toContain(zh['entry.sourceSessionDeleted'])
    expect(detail.textContent).toContain(zh['entry.previous'].replace('{version}', '1'))
    fireEvent.click(screen.getByText(zh['entry.undo']))
    await screen.findByText(zh['entry.undone'])
    expect(store.calls.undo).toHaveBeenCalledWith({ id: 'm_1', expectedVersion: 2, source: { kind: 'user', sessionId: 's-1' } })
    expect(screen.getByRole('button', { name: 'Port is 3000' })).toBeTruthy()
    // Forget the other one: gone from the list, present under forgotten, restorable.
    fireEvent.click(screen.getByRole('button', { name: 'Deploy with deploy.sh' }))
    fireEvent.click(screen.getByText(zh['entry.forget']))
    await waitFor(() => { expect(screen.queryByText('Deploy with deploy.sh')).toBeNull() })
    expect(store.calls.forget).toHaveBeenCalledWith({ id: 'm_2', expectedVersion: 1, source: { kind: 'user', sessionId: 's-1' } })
    const details = document.querySelector('[data-deepseekgui="memory-forgotten"]') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
    await screen.findByText('Deploy with deploy.sh')
    fireEvent.click(screen.getByText(zh['forgotten.restore']))
    await waitFor(() => { expect(store.calls.restore).toHaveBeenCalledWith({ id: 'm_2', source: { kind: 'user', sessionId: 's-1' } }) })
    await waitFor(() => { expect(document.querySelectorAll('[data-deepseekgui="memory-entry"]').length).toBe(2) })
  })

  it('adds through the store and reports a refused add without claiming success', async () => {
    const store = fakeMemory([])
    const { onChange } = changeSource()
    render(<MemoryEntries memory={store.remote} scope={{ kind: 'global' }} writeScope={{ kind: 'global' }} onChange={onChange} t={t} title="T" />)
    await screen.findByText(zh['list.empty'])
    const submit = document.querySelector('[data-deepseekgui="memory-add-submit"]') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(zh['add.title']), { target: { value: 'Reply briefly' } })
    fireEvent.click(submit)
    await screen.findByText(zh['add.added'].replace('{id}', 'm_new0'))
    expect(store.calls.remember).toHaveBeenCalledWith({ scope: { kind: 'global' }, kind: 'fact', content: 'Reply briefly', source: { kind: 'user' } })
    await screen.findByText('Reply briefly')
    store.calls.remember.mockImplementationOnce(async () => ok({ ok: false as const, error: { code: 'MEMORY_IO' as const, message: 'disk full' } }))
    fireEvent.change(screen.getByLabelText(zh['add.title']), { target: { value: 'never lands' } })
    fireEvent.click(submit)
    expect(await screen.findByText(zh['entry.failed'].replace('{message}', 'MEMORY_IO: disk full'))).toBeTruthy()
    expect([...document.querySelectorAll('[data-deepseekgui="memory-entry"]')].map(node => node.textContent)).toEqual([expect.stringContaining('Reply briefly')])
  })

  it('drops a late read whose scope moved on and hides the add form without a write scope', async () => {
    let release: (value: unknown) => void = () => {}
    const store = fakeMemory([entry('m_1', 'From the first project')])
    store.calls.list.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const { onChange } = changeSource()
    const { rerender } = render(<MemoryEntries memory={store.remote} scope={{ kind: 'project', projectKey: 'k-a' }} writeScope={null} onChange={onChange} t={t} title="T" />)
    rerender(<MemoryEntries memory={store.remote} scope={{ kind: 'project', projectKey: 'k-b' }} writeScope={null} onChange={onChange} t={t} title="T" />)
    await screen.findByText('From the first project')
    await act(async () => { release(ok({ entries: [entry('m_9', 'Stale answer')], total: 1 })) })
    expect(screen.queryByText('Stale answer')).toBeNull()
    expect(document.querySelector('[data-deepseekgui="memory-add"]')).toBeNull()
  })
})
