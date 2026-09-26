/**
 * Skills client registration (B7-P4/P5): the Settings → Skills
 * section and the session-top Project management view, both over the
 * mounted `skillManager` Remote namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's SlotRegistry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the `settings.section` slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the `conversation.view` slot contract.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.remote merge (the typed Client Remote mount) and
// the forwarded `skill-manager/change` event declaration.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import skillRemote from '@deepseek-ai/dsh-skill-manager/remote'
import { readBridge } from './bridge.ts'
import { SkillsSection } from './SkillsSection.tsx'
import { ProjectView } from './ProjectView.tsx'
import { en, NS_SKILLS, zh, type SkillsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Settings → Skills and Project management copy. */
    'deepseekgui.skills': SkillsKey
  }
}

/** Nav position: right below Archived sessions (30) — Skill is a daily
 * entry and must not sit at the bottom of the rail (user, 2026-09-14). */
export const SKILLS_SECTION_ORDER = 31

/** View tab position: between the Workbench Git view (21) and Memory (23). */
export const PROJECT_VIEW_ORDER = 22

/** Required services: the UI slot registry, the locale registry, and the Remote gateway. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the `skillManager` namespace and register the settings section and
 * the project view as declaration-aware contributions that follow their
 * slots. Both pages subscribe to the forwarded `skill-manager/change` event
 * so a change made in another window (or another session of the same
 * folder) shows up without a manual refresh.
 * @param ctx - Client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  const unmount = await ctx.remote.$mount(skillRemote)
  ctx.effect(() => () => { void unmount() }, 'deepseekgui: skill manager remote')
  ctx.effect(() => ctx.locale.register(NS_SKILLS, { zh, en }), 'deepseekgui: skills dictionaries')
  const t = ctx.locale.bind(NS_SKILLS)
  const bridge = readBridge()
  // One Host subscription fans out to every mounted page; pages subscribe
  // and unsubscribe with their own lifetime.
  const listeners = new Set<() => void>()
  const onChange = (listener: () => void): () => void => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  ctx.effect(
    () => ctx.remote.$on('skill-manager/change', () => { for (const listener of [...listeners]) listener() }),
    'deepseekgui: skill change fan-out',
  )
  // Cordis only hands out a `remote.<namespace>` child service to a scope
  // that declares it, and the mount happens inside apply(), so the pages
  // register from a fork (same shape as the Workbench views).
  await ctx.inject(['slots', 'remote.skillManager'], (scoped) => {
    scoped.slots.inject('settings.section', () =>
      scoped.slots.register({
        name: 'settings.section',
        id: 'deepseekgui-skills',
        order: SKILLS_SECTION_ORDER,
        locale: NS_SKILLS,
        label: () => t('nav.skills'),
        inject: () => ({ skills: scoped.remote.skillManager, bridge, onChange }),
      }, SkillsSection))
    scoped.slots.inject('conversation.view', () =>
      scoped.slots.register({
        name: 'conversation.view',
        id: 'deepseekgui-skills-project',
        order: PROJECT_VIEW_ORDER,
        locale: NS_SKILLS,
        label: () => t('view.project'),
        inject: (_sessionId: SessionId) => ({ skills: scoped.remote.skillManager, onChange }),
      }, ProjectView))
  })
}
