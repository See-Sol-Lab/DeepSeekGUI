// @vitest-environment jsdom
/**
 * apply() registration spec for the skills client plugin: the Remote mount,
 * the dictionaries, the Host change fan-out, and the two contributions —
 * the settings section and the session-top project view — registered from
 * a scope that declares `remote.skillManager`.
 * @module @see-sol-lab/deepseekgui-skills/tests/apply
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, PROJECT_VIEW_ORDER, SKILLS_SECTION_ORDER } from '../src/client/index.ts'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import { ProjectView } from '../src/client/ProjectView.tsx'
import { NS_SKILLS } from '../src/client/locales.ts'

interface RegisteredEntry {
  name: string
  id?: string
  order?: number
  locale?: string
  label?: () => string
  inject?: (sessionId?: string) => Record<string, unknown>
  component: unknown
}

function fakeContext() {
  const registered: RegisteredEntry[] = []
  const slots = {
    inject: vi.fn((_name: string, contribution: () => unknown) => { contribution(); return undefined }),
    register: (options: RegisteredEntry, component: unknown) => {
      registered.push({ ...options, component })
      return {}
    },
  }
  const unmount = vi.fn(async () => {})
  const skillManager = { inventory: vi.fn() }
  const hostListeners: Array<(...args: unknown[]) => void> = []
  const off = vi.fn()
  const ctx = {
    locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => `t:${key}`) },
    remote: {
      $mount: vi.fn(async () => unmount),
      $on: vi.fn((_event: string, listener: (...args: unknown[]) => void) => { hostListeners.push(listener); return off }),
      skillManager,
    },
    effect: vi.fn((fn: () => unknown) => { fn() }),
    inject: vi.fn((_deps: string[], callback: (scoped: unknown) => void) => {
      callback(ctx)
      return Promise.resolve()
    }),
    slots,
  }
  return { ctx, registered, slots, skillManager, hostListeners }
}

describe('skills client apply', () => {
  it('mounts the namespace, registers the dictionaries, the settings section and the project view', async () => {
    const { ctx, registered, slots, skillManager } = fakeContext()
    window.history.replaceState(null, '', '/?deepseekgui-control=4321.tok')
    await apply(ctx as never)
    window.history.replaceState(null, '', '/')

    expect(inject).toEqual(['slots', 'locale', 'remote'])
    expect(ctx.remote.$mount).toHaveBeenCalledOnce()
    expect(ctx.locale.register).toHaveBeenCalledWith(NS_SKILLS, expect.objectContaining({ zh: expect.anything(), en: expect.anything() }))
    expect(ctx.remote.$on).toHaveBeenCalledWith('skill-manager/change', expect.any(Function))
    expect(ctx.inject).toHaveBeenCalledOnce()
    expect(ctx.inject.mock.calls[0]?.[0]).toEqual(['slots', 'remote.skillManager'])
    expect(slots.inject.mock.calls.map(([name]) => name)).toEqual(['settings.section', 'conversation.view'])
    expect(registered).toHaveLength(2)
    const section = registered[0]!
    expect(section).toMatchObject({ name: 'settings.section', id: 'deepseekgui-skills', order: SKILLS_SECTION_ORDER, locale: NS_SKILLS })
    expect(section.component).toBe(SkillsSection)
    expect(section.label?.()).toBe('t:nav.skills')
    const injected = section.inject?.()
    expect(injected?.skills).toBe(skillManager)
    // The bridge was read while the page carried the desktop query.
    expect(injected?.bridge).not.toBeNull()
    expect(typeof injected?.onChange).toBe('function')
    const view = registered[1]!
    expect(view).toMatchObject({ name: 'conversation.view', id: 'deepseekgui-skills-project', order: PROJECT_VIEW_ORDER, locale: NS_SKILLS })
    expect(view.component).toBe(ProjectView)
    expect(view.label?.()).toBe('t:view.project')
    const viewInjected = view.inject?.('session-1')
    expect(viewInjected?.skills).toBe(skillManager)
    expect(viewInjected?.onChange).toBe(injected?.onChange)
  })

  it('fans one Host change subscription out to every page and honours unsubscribe', async () => {
    const { ctx, registered, hostListeners } = fakeContext()
    await apply(ctx as never)
    const onChange = registered[1]!.inject?.('s')?.onChange as (listener: () => void) => () => void
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onChange(first)
    onChange(second)
    expect(hostListeners).toHaveLength(1)
    hostListeners[0]!({ kind: 'selection', projectKey: 'p' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst()
    hostListeners[0]!({ kind: 'install', installId: 'a-00000001' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('leaves the bridge null outside the DeepSeekGUI window', async () => {
    const { ctx, registered } = fakeContext()
    window.history.replaceState(null, '', '/')
    await apply(ctx as never)
    expect(registered[0]!.inject?.()?.bridge).toBeNull()
  })
})
