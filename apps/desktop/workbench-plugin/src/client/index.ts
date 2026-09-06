/** Workbench client registration: brand, cards, official Session messages, and the four DeepSeekGUI conversation views. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's SlotRegistry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the official slot contracts into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: the `tool.call.toolview` SlotMap row the keyed rows register into.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// Type-only: pulls the session-controller's Client Session merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { DeepSeekGUIBrandName } from './Brand.tsx'
import { WorkbenchBadge } from './WorkbenchBadge.tsx'
import { DesktopActions } from './DesktopActions.tsx'
import { NotificationWatcher } from './NotificationWatcher.tsx'
import { ChangesView } from './views/ChangesView.tsx'
import { GitView } from './views/GitView.tsx'
import { WorktreeView } from './views/WorktreeView.tsx'
import { MemoryView } from './views/MemoryView.tsx'
import { instructionSender } from './instructions.ts'
import { readBridge } from './bridge.ts'
import { installPathClicks } from './paths.ts'
import { installSkinStyles } from './skin.ts'
import inspectorRemote from '@deepseek-ai/dsh-workbench-inspector/remote'
// Type-only: pulls the ctx.remote merge (the typed Client Remote mount).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { BrowserToolRow, GitPrToolRow } from './cards/tool-rows.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en as workbenchEn, zh as workbenchZh, type WorkbenchKey } from './locales.ts'
import { NS_TOOLS, en as toolsEn, zh as toolsZh, type ToolsKey } from './locales-tools.ts'
import { NS_INSPECTOR, en as inspectorEn, zh as inspectorZh, type InspectorKey } from './locales-inspector.ts'
import { NS_NOTIFY, en as notifyEn, zh as notifyZh, type NotifyKey } from './locales-notify.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench desktop-action controls copy. */
    'deepseekgui.workbench': WorkbenchKey
    /** B5-P5 tool-result card copy. */
    'deepseekgui.tools': ToolsKey
    /** The four DeepSeekGUI conversation views (D5). */
    'deepseekgui.inspector': InspectorKey
    /** B5-P6 desktop-notification copy. */
    'deepseekgui.notify': NotifyKey
  }
}

/** Wire names the git/pr cards own (keys of the generic-row takeover). */
const GIT_PR_TOOL_KEYS = [
  'git_status', 'git_diff', 'git_stage', 'git_unstage', 'git_revert',
  'git_commit', 'git_push_preview', 'git_push',
  'pr_availability', 'pr_existing', 'pr_create',
] as const

/** Wire names the browser card owns. */
const BROWSER_TOOL_KEYS = [
  'browser_navigate', 'browser_snapshot', 'browser_screenshot', 'browser_wait',
  'browser_tabs', 'browser_click', 'browser_type', 'browser_scroll',
  'browser_keyboard', 'browser_hover', 'browser_submit',
] as const

/** The DeepSeekGUI views beside the official 对话 / 轨迹 tabs, in tab order. */
const VIEWS = [
  { id: 'deepseekgui-changes', order: 20, label: 'view.changes', component: ChangesView },
  { id: 'deepseekgui-git', order: 21, label: 'view.git', component: GitView },
  { id: 'deepseekgui-worktree', order: 22, label: 'view.worktree', component: WorktreeView },
  { id: 'deepseekgui-memory', order: 23, label: 'view.memory', component: MemoryView },
] as const

/** Required services: the UI slot registry and the locale registry. */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'remote']

/**
 * Register the DeepSeekGUI brand, the Workbench marker, the desktop poll,
 * the tool-result card rows, and the four conversation views as
 * declaration-aware contributions that follow their declaring slots.
 * @param ctx - Client root context.
 */
export async function apply(ctx: ClientContext): Promise<void> {
  // The views' generated Remote namespace: the official carrier, cookie
  // session, cancellation and result schemas all live in the mounted client,
  // so the views call typed methods instead of shaping HTTP themselves.
  const unmountInspector = await ctx.remote.$mount(inspectorRemote)
  ctx.effect(() => () => { void unmountInspector() }, 'deepseekgui: inspector remote')
  const bridge = readBridge()
  const instructions = (sessionId: SessionId) => ({ submitInstruction: instructionSender(ctx, sessionId) })
  ctx.effect(
    () => ctx.locale.register('deepseekgui.workbench', { zh: workbenchZh, en: workbenchEn }),
    'deepseekgui: workbench dictionaries',
  )
  ctx.effect(
    () => ctx.locale.register(NS_TOOLS, { zh: toolsZh, en: toolsEn }),
    'deepseekgui: tool dictionaries',
  )
  ctx.effect(
    () => ctx.locale.register(NS_INSPECTOR, { zh: inspectorZh, en: inspectorEn }),
    'deepseekgui: inspector dictionaries',
  )
  ctx.effect(
    () => ctx.locale.register(NS_NOTIFY, { zh: notifyZh, en: notifyEn }),
    'deepseekgui: notify dictionaries',
  )
  const t = ctx.locale.bind(NS_INSPECTOR)
  // The official whale mark stays (2026-09-06 ruling: DeepSeekGUI is a
  // non-commercial open-source DSH plugin set, so it keeps the official
  // mark); only the brand name reads DeepSeekGUI.
  ctx.slots.inject('sidebar.brand.name', () =>
    ctx.slots.register({ name: 'sidebar.brand.name' }, DeepSeekGUIBrandName))
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'deepseekgui-workbench',
      // Static identity preceding interactive actions.
      order: -10,
    }, WorkbenchBadge))
  // D7 lives in each view's toolbar; the header-level copy was removed as a
  // visual duplicate (acceptance 2026-09-06).
  // The desktop poll that consumes notification-click navigation (B4-P8);
  // it renders nothing since D1 removed the duplicate status light.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'deepseekgui-desktop',
      locale: 'deepseekgui.workbench',
      order: 10,
      inject: () => ({
        openSession: (sessionId: SessionId): void => {
          ctx.sessions.open(sessionId)
        },
      }),
    }, DesktopActions))
  // B5-P6 desktop-notification consumer: invisible footer watcher that
  // renders nothing and forwards official interaction/job facts to the
  // stateless desktop notify command (dedup at this side, per official id).
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'deepseekgui-notifier',
      locale: NS_NOTIFY,
      order: 20,
    }, NotificationWatcher))
  // Keyed tool-result cards (B5-P5): one registered row per owned wire key.
  ctx.slots.inject('tool.call.toolview', function* () {
    for (const key of GIT_PR_TOOL_KEYS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS_TOOLS, inject: instructions }, GitPrToolRow)
    }
    for (const key of BROWSER_TOOL_KEYS) {
      yield ctx.slots.register({ name: 'tool.call.toolview', key, locale: NS_TOOLS, inject: instructions }, BrowserToolRow)
    }
  })
  // Visual patches over official components without token hooks (stats line pill).
  ctx.effect(() => installSkinStyles(), 'deepseekgui: skin styles')
  // D6: path-like code spans in the conversation reveal the file on click.
  if (bridge !== null) {
    ctx.effect(
      () => installPathClicks(bridge, () => ctx.sessions.list.getSnapshot().current, t('paths.reveal')),
      'deepseekgui: path clicks',
    )
  }
  // The four views (D5): they read the namespace mounted above, and Cordis
  // only hands out a `remote.<namespace>` child service to a scope that
  // declares it — the declaration cannot sit on this plugin's own `inject`
  // because the mount happens inside apply(). Same shape as the official
  // Team UI mount (packages/experimental/client-ui-agent-team/src/client/mount.ts).
  await ctx.inject(['slots', 'remote.workbenchInspector'], (scoped) => {
    scoped.slots.inject('conversation.view', function* () {
      for (const entry of VIEWS) {
        yield scoped.slots.register({
          name: 'conversation.view',
          id: entry.id,
          order: entry.order,
          locale: NS_INSPECTOR,
          label: () => t(entry.label),
          inject: (sessionId: SessionId) => ({
            ...instructions(sessionId),
            inspector: scoped.remote.workbenchInspector,
            bridge,
          }),
        }, entry.component)
      }
    })
  })
}
