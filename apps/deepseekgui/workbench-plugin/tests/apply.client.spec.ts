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
import { FirstRunGuide } from '../src/client/FirstRunGuide.tsx'
import { FirstRunWorkspaceGuide } from '../src/client/FirstRunWorkspaceGuide.tsx'
import { ChangesView } from '../src/client/views/ChangesView.tsx'
import { GitView } from '../src/client/views/GitView.tsx'
import { MemoryView } from '../src/client/views/MemoryView.tsx'
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
  it('registers the brand seats, the marker, the desktop poll, the tool rows and the four views', async () => {
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
      sessions: { open: vi.fn(), list: { getSnapshot: () => ({ current: undefined }) } },
      remote: { $mount: vi.fn(async () => async () => {}), workbenchInspector: {} },
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

    expect(ctx.remote.$mount).toHaveBeenCalledOnce()
    expect(ctx.provide).toHaveBeenCalledWith('chatTextDisplay', expect.anything())
    // #13: the latch replaced the face's two methods on the same instance.
    expect(typeof ctx.layout.openRightbar).toBe('function')
    expect(ctx.layout.openRightbar).not.toBe(ctx.layout.closeRightbar)
    // The views that call the mounted namespace register inside a scope
    // declaring it (Cordis refuses `ctx.remote.<namespace>` without inject);
    // the session guide waits for `remote.credentials` the same way.
    expect(ctx.inject).toHaveBeenCalledTimes(2)
    expect(ctx.inject.mock.calls[0]?.[0]).toContain('remote.credentials')
    expect(ctx.inject.mock.calls[1]?.[0]).toContain('remote.workbenchInspector')
    // The brand marks stay official (the whale); only the name is ours.
    expect(slots.inject.mock.calls.map(([name]) => name)).toEqual([
      'sidebar.brand.name',
      'conversation.session.header.actions',
      'sidebar.footer.action',
      'sidebar.footer.action',
      'conversation.hero.dock',
      'conversation.input.dock',
      'tool.call.toolview',
      'conversation.view',
    ])
    const staticEntries = registered.filter(entry => entry.name !== 'tool.call.toolview' && entry.name !== 'conversation.view')
    expect(staticEntries.map(entry => entry.component)).toEqual([
      DeepSeekGUIBrandName, WorkbenchBadge, DesktopActions, NotificationWatcher, FirstRunWorkspaceGuide, FirstRunGuide,
    ])
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

    expect(ctx.locale.register).toHaveBeenCalledTimes(4)
    for (const namespace of ['deepseekgui.workbench', 'deepseekgui.tools', 'deepseekgui.inspector', 'deepseekgui.notify']) {
      expect(ctx.locale.register)
        .toHaveBeenCalledWith(namespace, expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    }
  })
})
