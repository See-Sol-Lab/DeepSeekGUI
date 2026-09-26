// @vitest-environment jsdom
/**
 * Settings → Global memory and its blocks (B7-P9): the mode panel switches
 * only on an explicit confirm and only shows "switched" when the store
 * answered; the legacy editor saves with the text it started from and
 * refuses a file changed underneath; the import previews without writing,
 * ticks off duplicates, applies the ticked segments and reports where it
 * stopped; the export produces text and copies it; the used-memory block
 * names what the session's model was shown and whether it changed since.
 * @module @see-sol-lab/deepseekgui-workbench/tests/memory-settings
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MemoryEntry, MemoryImportPreview, MemoryStatus } from '@deepseek-ai/dsh-workbench-memory/types'
import { ImportBlock } from '../src/client/memory/ImportBlock.tsx'
import { LegacyGlobalEditor } from '../src/client/memory/LegacyGlobalEditor.tsx'
import { MemorySettingsSection } from '../src/client/memory/MemorySettingsSection.tsx'
import { ExportBlock, ModePanel } from '../src/client/memory/ModePanel.tsx'
import { UsedMemory } from '../src/client/memory/UsedMemory.tsx'
import type { MemoryRemote } from '../src/client/memory/model.ts'
import type { ControlBridgeClient } from '../src/client/bridge.ts'
import { zh } from '../src/client/locales-memory.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never
const ok = <T,>(value: T) => ({ ok: true as const, value })
const failed = (message: string) => ({ ok: false as const, error: new Error(message) as never })
const status = (injection: MemoryStatus['injection'], over: Partial<MemoryStatus> = {}): MemoryStatus => ({ injection, active: 2, forgotten: 1, globalFile: 'E:\\home\\memory.md', ...over })
const noChange = (): (() => void) => () => {}

function entry(id: string, content: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id, content, kind: 'fact', scope: { kind: 'global' }, version: 1, source: { kind: 'user', at: 't' }, createdAt: 't', updatedAt: 't', ...over }
}

function fakeMemory(over: Partial<Record<keyof MemoryRemote, (...args: never[]) => unknown>> = {}): MemoryRemote {
  return {
    status: vi.fn(async () => ok(status('markdown'))),
    setInjection: vi.fn(async (mode: MemoryStatus['injection']) => ok(status(mode))),
    list: vi.fn(async () => ok({ entries: [], total: 0 })),
    listForgotten: vi.fn(async () => ok([])),
    get: vi.fn(async () => ok(null)),
    previewImport: vi.fn(async () => ok({ source: { kind: 'global' }, path: 'E:\\home\\memory.md', scope: { kind: 'global' }, candidates: [], problem: 'missing' } as MemoryImportPreview)),
    applyImport: vi.fn(async () => ok({ written: [], skipped: [] })),
    ...over,
  } as unknown as MemoryRemote
}

describe('ModePanel', () => {
  it('switches only after an explicit confirm, tells the store, and reports the answer', async () => {
    const memory = fakeMemory()
    const onStatus = vi.fn()
    render(<ModePanel memory={memory} status={status('markdown')} onStatus={onStatus} t={t} />)
    // R15: the title IS the mode; no "current: …" line, no stats caption.
    expect(screen.getByText(zh['mode.title.markdown'])).toBeTruthy()
    expect(screen.getByText(zh['mode.upgradeNote'])).toBeTruthy()
    expect(screen.getByText(zh['mode.markdownHint'])).toBeTruthy()
    // Exactly one switch button: to enhanced memory. No off entry anywhere.
    expect(document.querySelector('[data-deepseekgui="memory-mode-markdown"]')).toBeNull()
    expect(document.querySelector('[data-deepseekgui="memory-mode-off"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-mode-entries"]') as HTMLButtonElement)
    expect(screen.getByText(zh['mode.confirmEntries'])).toBeTruthy()
    expect(memory.setInjection).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(zh['mode.cancel']))
    expect(document.querySelector('[data-deepseekgui="memory-mode-confirm"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-mode-entries"]') as HTMLButtonElement)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-mode-confirm-button"]') as HTMLButtonElement)
    await screen.findByText(zh['mode.switched'])
    expect(memory.setInjection).toHaveBeenCalledWith('entries', expect.any(AbortSignal))
    expect(onStatus).toHaveBeenCalledWith(status('entries'))
  })

  it('shows a refused switch as a failure, never as switched', async () => {
    const memory = fakeMemory({ setInjection: vi.fn(async () => failed('domain closed')) })
    const onStatus = vi.fn()
    render(<ModePanel memory={memory} status={status('entries')} onStatus={onStatus} t={t} />)
    // R15: entries mode offers exactly one way back — the legacy files.
    expect(screen.getByText(zh['mode.title.entries'])).toBeTruthy()
    expect(document.querySelector('[data-deepseekgui="memory-mode-off"]')).toBeNull()
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-mode-markdown"]') as HTMLButtonElement)
    expect(screen.getByText(zh['mode.confirmMarkdown'])).toBeTruthy()
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-mode-confirm-button"]') as HTMLButtonElement)
    expect(await screen.findByText(zh['mode.switchFailed'].replace('{message}', 'domain closed'))).toBeTruthy()
    expect(onStatus).not.toHaveBeenCalled()
    expect(screen.queryByText(zh['mode.switched'])).toBeNull()
  })
})

describe('MemorySettingsSection', () => {
  it('shows the legacy editor and the import in markdown mode, the global entries and export in entries mode, and only the statement when off', async () => {
    const memory = fakeMemory({ status: vi.fn(async () => ok(status('markdown'))) })
    const bridge: ControlBridgeClient = {
      model: vi.fn(async () => ({ changed: true as const, revision: 1, model: { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1, dshHome: 'E:\\home', globalMemory: 'I write novels' } as never })),
      run: vi.fn(async () => ({} as never)),
    }
    const section = (store: MemoryRemote) => (
      <MemorySettingsSection memory={store} bridge={bridge} onChange={noChange} sessionPresent={() => undefined} close={() => {}} t={t} />
    )
    const { rerender } = render(section(memory))
    expect((await screen.findByLabelText(zh['nav.memory']) as HTMLTextAreaElement).value).toBe('I write novels')
    expect(screen.getByText(zh['import.title'])).toBeTruthy()
    expect(screen.queryByText(zh['list.title.global'])).toBeNull()
    // Entries mode: the global entries list and the export appear, the editor goes.
    const entries = fakeMemory({
      status: vi.fn(async () => ok(status('entries'))),
      list: vi.fn(async () => ok({ entries: [entry('m_1', 'Answer in Chinese')], total: 1 })),
    })
    rerender(section(entries))
    await screen.findByText(zh['list.title.global'])
    await screen.findByText('Answer in Chinese')
    expect(screen.getByText(zh['export.title'])).toBeTruthy()
    expect(screen.queryByLabelText(zh['nav.memory'])).toBeNull()
    // Off: the statement, nothing else, and no read of the entries.
    const off = fakeMemory({ status: vi.fn(async () => ok(status('off'))) })
    rerender(section(off))
    await screen.findByRole('note')
    expect(screen.queryByText(zh['list.title.global'])).toBeNull()
    expect(screen.queryByText(zh['import.title'])).toBeNull()
    expect(screen.queryByText(zh['export.title'])).toBeNull()
  })

  it('reports an unreachable store instead of showing a stale mode', async () => {
    const memory = fakeMemory({ status: vi.fn(async () => failed('gateway down')) })
    render(
      <MemorySettingsSection memory={memory} bridge={null} onChange={noChange} sessionPresent={() => undefined} close={() => {}} t={t} />,
    )
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh['common.failed'].replace('{message}', 'gateway down'))
    expect(document.querySelector('[data-deepseekgui="memory-mode"]')).toBeNull()
  })
})

describe('LegacyGlobalEditor', () => {
  it('keeps text typed while a previous save is pending', async () => {
    let finish!: (value: never) => void
    const bridge: ControlBridgeClient = {
      model: vi.fn(async () => ({ changed: true as const, revision: 1, model: { dshHome: 'E:\\home', globalMemory: 'old' } as never })),
      run: vi.fn(() => new Promise<never>((resolve) => { finish = resolve })),
    }
    render(<LegacyGlobalEditor bridge={bridge} t={t} />)
    const box = await screen.findByLabelText(zh['nav.memory']) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'submitted' } })
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-legacy-save"]')!)
    fireEvent.change(box, { target: { value: 'still editing' } })
    finish({} as never)
    await screen.findByText(zh['legacy.saved'])
    expect(box.value).toBe('still editing')
    expect((document.querySelector('[data-deepseekgui="memory-legacy-save"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('saves with the text the edit started from, and shows the desktop refusal when the file changed underneath', async () => {
    const run = vi.fn(async () => ({} as never))
    const bridge: ControlBridgeClient = {
      model: vi.fn(async () => ({ changed: true as const, revision: 1, model: { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1, dshHome: 'E:\\home', globalMemory: 'old text' } as never })),
      run,
    }
    render(<LegacyGlobalEditor bridge={bridge} t={t} />)
    const box = await screen.findByLabelText(zh['nav.memory']) as HTMLTextAreaElement
    expect(box.value).toBe('old text')
    const save = document.querySelector('[data-deepseekgui="memory-legacy-save"]') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'new text' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await screen.findByText(zh['legacy.saved'])
    expect(run).toHaveBeenCalledWith({ type: 'save-global-memory', content: 'new text', home: 'E:\\home', expected: 'old text' })
    // The next save quotes the saved text; a refusal is shown, not "saved".
    run.mockImplementationOnce(async () => { throw new Error('file changed') })
    fireEvent.change(box, { target: { value: 'newer' } })
    fireEvent.click(save)
    expect(await screen.findByText(zh['legacy.failed'].replace('{message}', 'file changed'))).toBeTruthy()
    expect(run).toHaveBeenLastCalledWith({ type: 'save-global-memory', content: 'newer', home: 'E:\\home', expected: 'new text' })
    expect(screen.getByText(zh['legacy.location'].replace('{path}', 'E:\\home\\memory.md'))).toBeTruthy()
    fireEvent.click(screen.getByText(zh['legacy.open']))
    expect(run).toHaveBeenLastCalledWith({ type: 'open-memory', which: 'global' })
  })

  it('disables saving for an unreadable file and says why; no bridge means no editor', async () => {
    const bridge: ControlBridgeClient = {
      model: vi.fn(async () => ({ changed: true as const, revision: 1, model: { status: { phase: 'running' }, activeProfile: 'web', homeKind: 'managed', revision: 1, dshHome: 'E:\\home', globalMemory: null } as never })),
      run: vi.fn(async () => ({} as never)),
    }
    render(<LegacyGlobalEditor bridge={bridge} t={t} />)
    expect(await screen.findByText(zh['legacy.unreadable'])).toBeTruthy()
    expect((screen.getByLabelText(zh['nav.memory']) as HTMLTextAreaElement).disabled).toBe(true)
    cleanup()
    render(<LegacyGlobalEditor bridge={null} t={t} />)
    expect(screen.getByText(zh['common.noDesktop'])).toBeTruthy()
  })
})

describe('ImportBlock', () => {
  const preview: MemoryImportPreview = {
    source: { kind: 'global' },
    path: 'E:\\home\\memory.md',
    scope: { kind: 'global' },
    candidates: [
      { key: 'c1', headings: ['About me'], line: 3, text: 'I write novels', kind: 'preference', duplicateOf: null },
      { key: 'c2', headings: ['About me'], line: 4, text: 'I know Python', kind: 'preference', duplicateOf: 'm_000000000001' },
      { key: 'c3', headings: [], line: 9, text: 'Reply in Chinese', kind: 'preference', duplicateOf: null },
    ],
  }

  it('previews without writing, unticks duplicates, applies the ticked segments and reports where it stopped', async () => {
    const memory = fakeMemory({
      previewImport: vi.fn(async () => ok(preview)),
      applyImport: vi.fn(async () => ok({ written: ['m_2'], skipped: [], failedAt: { key: 'c3', error: { code: 'MEMORY_IO', message: 'disk full' } } })),
    })
    render(<ImportBlock memory={memory} source={{ kind: 'global' }} sessionId="s-1" t={t} />)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-import-preview"]') as HTMLButtonElement)
    await screen.findByText('I write novels')
    expect(memory.applyImport).not.toHaveBeenCalled()
    expect(screen.getByText(zh['import.candidates'].replace('{count}', '3'))).toBeTruthy()
    expect(screen.getByText(zh['import.duplicate'].replace('{id}', 'm_000000000001'))).toBeTruthy()
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(box => box.checked)).toEqual([true, false, true])
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-import-apply"]') as HTMLButtonElement)
    expect(await screen.findByRole('status')).toHaveProperty('textContent', zh['import.stopped']
      .replace('{line}', zh['import.line'].replace('{line}', '9'))
      .replace('{message}', 'MEMORY_IO: disk full')
      .replace('{written}', '1'))
    expect(memory.applyImport).toHaveBeenCalledWith({ source: { kind: 'global' }, selections: [{ key: 'c1' }, { key: 'c3' }], sessionId: 's-1' }, expect.any(AbortSignal))
    // The preview re-read after the apply.
    expect(memory.previewImport).toHaveBeenCalledTimes(2)
    // Select none disables the apply; select all re-ticks only the non-duplicates.
    fireEvent.click(screen.getByText(zh['import.selectNone']))
    expect((document.querySelector('[data-deepseekgui="memory-import-apply"]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText(zh['import.selectAll']))
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map(box => box.checked)).toEqual([true, false, true])
  })

  it('names a file problem and reports a preview failure', async () => {
    const memory = fakeMemory({ previewImport: vi.fn(async () => ok({ ...preview, candidates: [], problem: 'too-large' })) })
    render(<ImportBlock memory={memory} source={{ kind: 'project', cwd: 'E:\\proj' }} t={t} />)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-import-preview"]') as HTMLButtonElement)
    expect(await screen.findByRole('note')).toHaveProperty('textContent', zh['import.problem.too-large'])
    expect(document.querySelector('[data-deepseekgui="memory-import-apply"]')).toBeNull()
    cleanup()
    const broken = fakeMemory({ previewImport: vi.fn(async () => failed('gateway down')) })
    render(<ImportBlock memory={broken} source={{ kind: 'global' }} t={t} />)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-import-preview"]') as HTMLButtonElement)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', zh['import.failed'].replace('{message}', 'gateway down'))
  })
})

describe('ExportBlock', () => {
  it('generates Markdown from the store, copies it, and says when there is nothing', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const memory = fakeMemory({ list: vi.fn(async () => ok({ entries: [entry('m_1', 'Answer in Chinese', { kind: 'preference' })], total: 1 })) })
    render(<ExportBlock memory={memory} scope={{ kind: 'global' }} t={t} />)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-export-run"]') as HTMLButtonElement)
    const box = await screen.findByLabelText(zh['export.title']) as HTMLTextAreaElement
    expect(box.value).toContain('- Answer in Chinese (#m_1 v1, 全局)')
    expect(memory.list).toHaveBeenCalledWith({ scope: { kind: 'global' }, limit: 10_000 }, expect.any(AbortSignal))
    fireEvent.click(screen.getByText(zh['export.copy']))
    await screen.findByText(zh['export.copied'])
    expect(writeText).toHaveBeenCalledWith(box.value)
    cleanup()
    render(<ExportBlock memory={fakeMemory()} scope={{ kind: 'global' }} t={t} />)
    fireEvent.click(document.querySelector('[data-deepseekgui="memory-export-run"]') as HTMLButtonElement)
    expect(await screen.findByText(zh['export.empty'])).toBeTruthy()
  })
})

describe('UsedMemory', () => {
  it('names the entries the model was shown with their versions, and whether each changed or went since', async () => {
    const memory = fakeMemory({
      get: vi.fn(async (id: string) => ok(id === 'm_1' ? entry('m_1', 'Port is 3100', { version: 2 }) : null)),
    })
    const used = { seq: 7, query: 'which port?', omitted: 1, update: true, entries: [
      { id: 'm_1', version: 1, scope: 'project' as const, kind: 'fact' as const },
      { id: 'm_2', version: 1, scope: 'global' as const, kind: 'preference' as const },
    ] }
    render(<UsedMemory memory={memory} used={used} onChange={noChange} t={t} />)
    const summary = screen.getByText(zh['used.title'], { exact: false })
    expect(summary.textContent).toContain(zh['used.summary'].replace('{count}', '2').replace('{omitted}', zh['used.omitted'].replace('{omitted}', '1')))
    const details = document.querySelector('[data-deepseekgui="memory-used"]') as HTMLDetailsElement
    details.open = true
    await act(async () => { fireEvent(details, new Event('toggle')) })
    await screen.findByText('Port is 3100')
    expect(screen.getByText(zh['used.changed'].replace('{version}', '2'))).toBeTruthy()
    expect(screen.getByText(zh['used.gone'])).toBeTruthy()
    expect(screen.getByText(zh['used.query'].replace('{query}', 'which port?'), { exact: false }).textContent).toContain(zh['used.replaced'])
    cleanup()
    render(<UsedMemory memory={memory} used={undefined} onChange={noChange} t={t} />)
    expect(screen.getByText(zh['used.none'])).toBeTruthy()
  })
})
