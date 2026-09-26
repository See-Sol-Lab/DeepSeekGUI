// @vitest-environment jsdom
/**
 * apply() registration spec for the workbench client plugin: every slot
 * contribution this phase ships, and the component each one registers.
 * D5 (2026-09-06) replaced the header inspector popover with four
 * conversation views beside the official Chat/Trajectory tabs; the brand
 * seats, the session-header marker, the open-workspace action, the desktop
 * poll, and the keyed tool rows stay.
 * @module @see-sol-lab/deepseekgui-workbench/tests/apply
 */

import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'
import { DeepSeekGUIBrandName } from '../src/client/Brand.tsx'
import { WorkbenchBadge } from '../src/client/WorkbenchBadge.tsx'
import { DesktopActions } from '../src/client/DesktopActions.tsx'
import { NotificationWatcher } from '../src/client/NotificationWatcher.tsx'
import { DeleteSessionDialog, DeleteSessionMenuItem } from '../src/client/session-delete.tsx'
import { WelcomeOverlay } from '../src/client/welcome/WelcomeOverlay.tsx'
import { ChangesView } from '../src/client/views/ChangesView.tsx'
import { GitView } from '../src/client/views/GitView.tsx'
import { MemoryView } from '../src/client/views/MemoryView.tsx'
import { MemorySettingsSection } from '../src/client/memory/MemorySettingsSection.tsx'
import { ArchivedSessionsSection } from '../src/client/ArchivedSessionsSection.tsx'
import { BrowserToolRow, GitPrToolRow } from '../src/client/cards/tool-rows.tsx'

/** Git/pr and browser wire keys the rows own. */
const TOOL_KEYS = [
  'git_status', 'git_diff', 'git_stage', 'git_unstage', 'git_revert',
  'git_commit', 'git_push_preview', 'git_push',
  'pr_availability', 'pr_existing', 'pr_create',
  'browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_wait',
  'browser_tabs', 'browser_click', 'browser_type', 'browser_scroll',
  'browser_keyboard', 'browser_hover', 'browser_submit',
]

interface RegisteredEntry {
  name: string
  id?: string
  key?: string
  order?: number
  locale?: string
  label?: () => string
  component: unknown
}

describe('workbench client apply', () => {
  it('registers the official-style welcome overlay only in a DeepSeekGUI window carrying the Host shim', async () => {
    const registered: RegisteredEntry[] = []
    const slots = {
      inject: vi.fn((_name: string, contribution: () => unknown) => { contribution(); return undefined }),
      register: (options: RegisteredEntry, component: unknown) => { registered.push({ ...options, component }); return {} },
    }
    const page = globalThis as Record<string, unknown>
    window.history.replaceState(null, '', '/?deepseekgui-control=5555.tok')
    page.dshDesktop = { shell: 'deepseekgui' }
    page.dshOnboarding = { hasApiKey: vi.fn(async () => false), saveApiKey: vi.fn(async () => true) }
    const ctx = {
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key), getSnapshot: () => ({ active: 'zh' }) },
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: undefined, phase: 'ready', byId: {} }) } },
      remote: {
        $mount: vi.fn(async () => async () => {}), $on: vi.fn(() => () => {}), workbenchInspector: {}, workbenchMemory: {},
        $stream: vi.fn(() => ({ dispose: vi.fn(), async *[Symbol.asyncIterator]() { /* no frames */ } })),
        account: { watch: vi.fn(), startSignIn: vi.fn(), cancelSignIn: vi.fn() },
      },
      layout: { openRightbar: vi.fn(), closeRightbar: vi.fn() },
      sidebarRight: { isExpanded: vi.fn(() => false), toggleExpanded: vi.fn() },
      effect: vi.fn((fn: () => unknown) => { fn() }),
      provide: vi.fn(),
      inject: vi.fn((_deps: string[], callback: (scoped: unknown) => void) => { callback(ctx); return Promise.resolve() }),
      slots,
    }
    try {
      await apply(ctx as never)
      expect(ctx.inject.mock.calls[0]?.[0]).toEqual(['slots', 'remote.account'])
      const welcome = registered.find(entry => entry.id === 'deepseekgui-welcome')
      expect(welcome).toMatchObject({ name: 'shell.overlay', locale: 'deepseekgui.welcome', component: WelcomeOverlay })
      // The expired-sign-in notice and both key-readiness events are wired.
      const events = ctx.remote.$on.mock.calls.map(([name]) => name)
      expect(events).toEqual(expect.arrayContaining(['deepseek-account/session-expired', 'credentials/reference-updated', 'llm/adapters-updated']))
    } finally {
      delete page.dshDesktop
      delete page.dshOnboarding
      window.history.replaceState(null, '', '/')
    }
  })

  it('registers the brand seats, the marker, the desktop poll, the tool rows, the views and the memory section', async () => {
    const registered: RegisteredEntry[] = []
    const drive = (result: unknown): void => {
      if (result !== undefined && typeof (result as { next?: unknown }).next === 'function') {
        // Generators register as they run; drive them to completion.
        let step = (result as Iterator<unknown>).next()
        while (!step.done) step = (result as Iterator<unknown>).next()
      }
    }
    const slots = {
      inject: vi.fn((_name: string, contribution: () => unknown) => { drive(contribution()); return undefined }),
      register: (options: RegisteredEntry, component: unknown) => {
        registered.push({ ...options, component })
        return {}
      },
    }
    const ctx = {
      locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: undefined, phase: 'ready', byId: { 's-1': {} } }) } },
      remote: { $mount: vi.fn(async () => async () => {}), $on: vi.fn(() => () => {}), workbenchInspector: {}, workbenchMemory: {} },
      // #13: the frame's panel face the exclusion latches onto, and the
      // Sidebar controller it collapses.
      layout: { openRightbar: vi.fn(), closeRightbar: vi.fn() },
      sidebarRight: { isExpanded: vi.fn(() => false), toggleExpanded: vi.fn() },
      effect: vi.fn((fn: () => unknown) => { fn() }),
      // B6-P4: the prose-display service is published through ctx.provide.
      provide: vi.fn(),
      // The mounted-namespace consumer runs in a fork that declares
      // `remote.workbenchInspector`; the stub applies it on the same ctx.
      inject: vi.fn((_deps: string[], callback: (scoped: unknown) => void) => {
        callback(ctx)
        return Promise.resolve()
      }),
      slots,
    }
    await apply(ctx as never)

    // The inspector namespace and (B7-P9) the memory namespace.
    expect(ctx.remote.$mount).toHaveBeenCalledTimes(2)
    // One fan-out subscription to the forwarded store change.
    expect(ctx.remote.$on).toHaveBeenCalledWith('workbench-memory/change', expect.any(Function))
    expect(ctx.provide).toHaveBeenCalledWith('chatTextDisplay', expect.anything())
    // #13: the latch replaced the face's two methods on the same instance.
    expect(typeof ctx.layout.openRightbar).toBe('function')
    expect(ctx.layout.openRightbar).not.toBe(ctx.layout.closeRightbar)
    // The views that call the mounted namespace register inside a scope
    // declaring it (Cordis refuses `ctx.remote.<namespace>` without inject);
    // Outside a DeepSeekGUI window (no control bridge) the welcome overlay is not registered.
    expect(ctx.inject).toHaveBeenCalledTimes(1)
    expect(ctx.inject.mock.calls[0]?.[0]).toContain('remote.workbenchInspector')
    expect(ctx.inject.mock.calls[0]?.[0]).toContain('remote.workbenchMemory')
    // The brand marks stay official (the whale); only the name is ours.
    expect(slots.inject.mock.calls.map(([name]) => name)).toEqual([
      'sidebar.brand.name',
      'conversation.session.header.actions',
      'sidebar.footer.action',
      'sidebar.footer.action',
      'sidebar.workspaces.session.menu.item',
      'shell.overlay',
      // Settings → Archived sessions (住户 2026-09-23).
      'settings.section',
      'tool.call.toolview',
      'conversation.view',
      'settings.section',
    ])
    const staticEntries = registered.filter(entry => !['tool.call.toolview', 'conversation.view', 'settings.section'].includes(entry.name))
    expect(staticEntries.map(entry => entry.component)).toEqual([
      DeepSeekGUIBrandName, WorkbenchBadge, DesktopActions, NotificationWatcher,
      DeleteSessionMenuItem, DeleteSessionDialog,
    ])
    // Delete session (住户 2026-09-22): the row follows the shipped archive row (400)
    // in the official session menu, and its confirmation hangs in the frame-wide layer.
    expect(staticEntries[4]).toMatchObject({ id: 'deepseekgui-delete', order: 500, locale: 'deepseekgui.workbench' })
    expect(staticEntries[5]).toMatchObject({ id: 'deepseekgui-session-delete', locale: 'deepseekgui.workbench' })
    expect(staticEntries[1]).toMatchObject({ id: 'deepseekgui-workbench', order: -10 })
    expect(staticEntries[2]).toMatchObject({ id: 'deepseekgui-desktop', order: 10, locale: 'deepseekgui.workbench' })
    expect(staticEntries[3]).toMatchObject({ id: 'deepseekgui-notifier', order: 20, locale: 'deepseekgui.notify' })
    // The skin style element is installed once.
    expect(document.getElementById('deepseekgui-skin')).not.toBeNull()

    const rows = registered.filter(entry => entry.name === 'tool.call.toolview')
    expect(rows.map(entry => entry.key)).toEqual(TOOL_KEYS)
    expect(rows.every(row => row.locale === 'deepseekgui.tools')).toBe(true)
    expect(rows.filter(entry => entry.key?.startsWith('browser_')).every(row => row.component === BrowserToolRow)).toBe(true)
    expect(rows.filter(entry => !entry.key?.startsWith('browser_')).every(row => row.component === GitPrToolRow)).toBe(true)

    // The three views beside 对话 / 轨迹, in tab order, all on the inspector dictionary
    // (work trees live inside Git since #5).
    const views = registered.filter(entry => entry.name === 'conversation.view')
    expect(views.map(entry => [entry.id, entry.order, entry.component])).toEqual([
      ['deepseekgui-changes', 20, ChangesView],
      ['deepseekgui-git', 21, GitView],
      ['deepseekgui-memory', 23, MemoryView],
    ])
    expect(views.every(entry => entry.locale === 'deepseekgui.inspector')).toBe(true)
    expect(views.map(entry => entry.label?.())).toEqual(['view.changes', 'view.git', 'view.memory'])
    // The Memory view carries the store beside the inspector; the session-presence probe reads the list snapshot.
    const memoryView = views[2] as RegisteredEntry & { inject: (sessionId: string) => Record<string, unknown> }
    const injected = memoryView.inject('s-1')
    expect(injected.memory).toBe(ctx.remote.workbenchMemory)
    expect(typeof injected.onMemoryChange).toBe('function')
    expect((injected.sessionPresent as (id: string) => boolean | undefined)('s-1')).toBe(true)
    expect((injected.sessionPresent as (id: string) => boolean | undefined)('s-9')).toBe(false)

    // Settings → Global memory (B7-P9): the JS settings plugin's former id and slot, now the TS section.
    const sections = registered.filter(entry => entry.name === 'settings.section')
    // Settings → Archived sessions (住户 2026-09-23) comes first, ahead of our 40s.
    expect(sections.map(entry => [entry.id, entry.order, entry.locale, entry.component])).toEqual([
      ['deepseekgui-archived', 30, 'deepseekgui.workbench', ArchivedSessionsSection],
      ['deepseekgui-memory', 43, 'deepseekgui.memory', MemorySettingsSection],
    ])
    expect(sections[1]?.label?.()).toBe('nav.memory')

    expect(ctx.locale.register).toHaveBeenCalledTimes(6)
    for (const namespace of ['deepseekgui.workbench', 'deepseekgui.tools', 'deepseekgui.inspector', 'deepseekgui.notify', 'deepseekgui.memory', 'deepseekgui.welcome']) {
      expect(ctx.locale.register)
        .toHaveBeenCalledWith(namespace, expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    }
  })
})
