/**
 * Workbench client registration: brand, cards, official Session messages,
 * the DeepSeekGUI conversation views, and (B7-P9) the memory pages — the
 * Memory view over the entry store and the Settings → Global memory section
 * that replaces the JS settings plugin's section of the same id.
 */
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
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: the `settings.section` slot contract (B7-P9 memory section).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: ctx.layout (frame panel face) and ctx.sidebarRight (right Sidebar
// controller) for the #13 exclusion.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DeepSeekGUIBrandName } from './Brand.tsx'
import { WorkbenchBadge } from './WorkbenchBadge.tsx'
import { DesktopActions } from './DesktopActions.tsx'
import { WelcomeOverlay } from './welcome/WelcomeOverlay.tsx'
import { createWelcomeController, type OnboardingCarrier } from './welcome/welcome-controller.ts'
import { NotificationWatcher } from './NotificationWatcher.tsx'
import { ChangesView } from './views/ChangesView.tsx'
import { GitView } from './views/GitView.tsx'
import { MemoryView } from './views/MemoryView.tsx'
import { instructionSender } from './instructions.ts'
import { readBridge } from './bridge.ts'
import { DeleteSessionDialog, DeleteSessionMenuItem, readSessionDeleter } from './session-delete.tsx'
import { ExportSessionDialog, ExportSessionMenuItem, readSessionExporter } from './session-export.tsx'
import { DeveloperModeRow } from './developer-mode.tsx'
import { SandboxMarksRow } from './sandbox-marks.tsx'
import { ArchivedSessionsSection } from './ArchivedSessionsSection.tsx'
import { installSkinStyles } from './skin.ts'
import { installTextDisplay } from './text-display.ts'
import inspectorRemote from '@deepseek-ai/dsh-workbench-inspector/remote'
// Type-only: pulls the ctx.remote merge (the typed Client Remote mount).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { MemorySettingsSection } from './memory/MemorySettingsSection.tsx'
import { BrowserToolRow, GitPrToolRow } from './cards/tool-rows.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { en as workbenchEn, zh as workbenchZh, type WorkbenchKey } from './locales.ts'
import { NS_TOOLS, en as toolsEn, zh as toolsZh, type ToolsKey } from './locales-tools.ts'
import { NS_INSPECTOR, en as inspectorEn, zh as inspectorZh, type InspectorKey } from './locales-inspector.ts'
import { NS_NOTIFY, en as notifyEn, zh as notifyZh, type NotifyKey } from './locales-notify.ts'
import { NS_MEMORY, en as memoryEn, zh as memoryZh, type MemoryKey } from './locales-memory.ts'
import { en as welcomeEn, zh as welcomeZh, type WelcomeKey } from './locales-welcome.ts'
import type { AccountView } from '@deepseek-ai/dsh-deepseek-account/types'

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
    /** B7-P9 memory pages copy. */
    'deepseekgui.memory': MemoryKey
    /** The welcome overlay ported from the official Desktop (2026-09-25). */
    'deepseekgui.welcome': WelcomeKey
  }
}

/** Settings nav position of the memory section: the JS settings plugin's former slot (40–44 are DeepSeekGUI's). */
export const MEMORY_SECTION_ORDER = 43
/** Settings order of the archived-sessions page: after the official sections, ahead of ours. */
export const ARCHIVED_SECTION_ORDER = 30

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

/** The inspector-only DeepSeekGUI views beside the official 对话 / 轨迹 tabs, in tab order. */
const VIEWS = [
  { id: 'deepseekgui-changes', order: 20, label: 'view.changes', component: ChangesView },
  { id: 'deepseekgui-git', order: 21, label: 'view.git', component: GitView },
  // Parallel work trees live inside the Git view since 2026-09-11 (#5).
] as const

/** Tab position of the Memory view: after Project management (22). */
const MEMORY_VIEW_ORDER = 23

/**
 * Required services. Cordis 4.0.4 (dsh 0.1.7-alpha.2) throws on reading an
 * undeclared one, so `jobs` (notification watcher) and `uiWorkspace`
 * (notification-click navigation) must be listed here too.
 */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'remote', 'layout', 'sidebarRight', 'jobs', 'uiWorkspace']

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
  ctx.effect(
    () => ctx.locale.register(NS_MEMORY, { zh: memoryZh, en: memoryEn }),
    'deepseekgui: memory dictionaries',
  )
  ctx.effect(
    () => ctx.locale.register('deepseekgui.welcome', { zh: welcomeZh, en: welcomeEn }),
    'deepseekgui: welcome dictionaries',
  )
  const t = ctx.locale.bind(NS_INSPECTOR)
  const tm = ctx.locale.bind(NS_MEMORY)
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
          ctx.uiWorkspace.openSession(sessionId) // 0.1.7: uiWorkspace owns opening, Sessions only retain
        },
        // #13: the pane just slid out on the desktop side; give the right
        // Sidebar back its column by collapsing it (only when expanded).
        onBrowserPaneOpen: (): void => {
          if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
        },
      }),
    }, DesktopActions))
  // #13 (2026-09-11): the official right Sidebar and the desktop's browser
  // pane share the window's right edge, so only one of them is open at a
  // time. This is the Sidebar → pane direction: the Sidebar reports its
  // presentation through ctx.layout.openRightbar / closeRightbar (the same
  // controller instance we hold), so a latch on that pair hides the pane on
  // the not-shown → shown transition and nothing else. The other direction
  // (pane opens → Sidebar collapses) rides the desktop poll above.
  ctx.effect(() => {
    const layout = ctx.layout
    const openRightbar = layout.openRightbar.bind(layout)
    const closeRightbar = layout.closeRightbar.bind(layout)
    let shown = false
    layout.openRightbar = (track, fullscreen) => {
      openRightbar(track, fullscreen)
      if (shown) return
      shown = true
      void readBridge()?.run({ type: 'browser-pane-hide' }).catch(() => undefined)
    }
    layout.closeRightbar = () => {
      closeRightbar()
      shown = false
    }
    return () => {
      layout.openRightbar = openRightbar
      layout.closeRightbar = closeRightbar
    }
  }, 'deepseekgui: sidebar / browser pane exclusion')
  // B5-P6 desktop-notification consumer: invisible footer watcher that
  // renders nothing and forwards official interaction/job facts to the
  // stateless desktop notify command (dedup at this side, per official id).
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'deepseekgui-notifier',
      locale: NS_NOTIFY,
      order: 20,
      inject: () => ({ jobs: ctx.jobs.state }),
    }, NotificationWatcher))
  // Delete session (住户 2026-09-22): upstream 0.1.7 moved the archive back
  // into the sidebar and its row menu has no delete, so the entry lands in
  // that official menu — one row for archived sessions only, plus the
  // confirmation it raises. Both are no-ops outside a DeepSeekGUI window,
  // where the control bridge (the only thing that can erase Home files)
  // does not exist. See session-delete.tsx.
  {
    const deleteSession = readSessionDeleter()
    ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
      ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'deepseekgui-delete',
        locale: 'deepseekgui.workbench',
        // After the shipped archive row (400), which this one follows in meaning.
        order: 500,
        inject: () => ({ deleteSession }),
      }, DeleteSessionMenuItem))
    // The dialog outlives the menu the row sat in, so it hangs in the
    // frame-wide layer rather than in the menu.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'deepseekgui-session-delete',
        locale: 'deepseekgui.workbench',
        inject: () => ({ deleteSession }),
      }, DeleteSessionDialog))
    // Settings → Archived sessions (住户 2026-09-23): the sidebar's "Show
    // archived" is hard to find, so the B6-P11 page comes back — now in our
    // plugin, out of the official ui-workspace package's way.
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register({
        name: 'settings.section',
        id: 'deepseekgui-archived',
        order: ARCHIVED_SECTION_ORDER,
        locale: 'deepseekgui.workbench',
        label: () => ctx.locale.bind('deepseekgui.workbench')('archived.nav'),
        inject: () => ({
          restore: (sessionId: SessionId) => ctx.uiWorkspace.unarchiveSession(sessionId),
          open: (sessionId: SessionId): void => { ctx.uiWorkspace.openSession(sessionId) },
          deleteSession,
        }),
      }, ArchivedSessionsSection))
  }
  // Developer mode (住户 2026-09-29): the single switch for both official
  // uploads, in Settings → General just above the version (order 90, the seat
  // the disabled official session-log row used). Absent outside a DeepSeekGUI
  // window, where the desktop that owns the preference is not reachable.
  if (bridge !== null) {
    ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register({
        name: 'settings.general.item',
        id: 'deepseekgui-developer-mode',
        order: 90,
        locale: 'deepseekgui.workbench',
        inject: () => ({ bridge }),
      }, DeveloperModeRow))
    // Clean sandbox marks (住户 2026-09-29): the manual exit for the Windows
    // sandbox's Low label on folders an older build or a crash left marked.
    // Just above developer mode; Windows only (see sandbox-marks.tsx).
    ctx.slots.inject('settings.general.item', () =>
      ctx.slots.register({
        name: 'settings.general.item',
        id: 'deepseekgui-sandbox-marks',
        order: 85,
        locale: 'deepseekgui.workbench',
        inject: () => ({ bridge, windows: /Windows/u.test(navigator.userAgent) }),
      }, SandboxMarksRow))
  }
  // Session export as Markdown (B8-P1, 2026-09-28): the same official row
  // menu, shown for every session — exporting is read-only. The renderer
  // runs in the workbenchInspector Remote and the save dialog lives in the
  // desktop, so this pair is a no-op outside a DeepSeekGUI window, where the
  // control bridge does not exist. See session-export.tsx.
  {
    const exporter = readSessionExporter()
    ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
      ctx.slots.register({
        name: 'sidebar.workspaces.session.menu.item',
        id: 'deepseekgui-export',
        locale: 'deepseekgui.workbench',
        // Between the shipped archive row (400) and our delete row (500).
        order: 450,
        inject: () => ({ exporter }),
      }, ExportSessionMenuItem))
    // The dialog outlives the menu the row sat in, so it hangs in the
    // frame-wide layer rather than in the menu.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'deepseekgui-session-export',
        locale: 'deepseekgui.workbench',
        inject: () => ({ exporter }),
      }, ExportSessionDialog))
  }
  // Welcome overlay (住户 2026-09-25: 首次引导全换官方的). The official Desktop
  // shows a native welcome window — sign in, add an API key, or set up later —
  // while neither a DeepSeek account nor any key is configured, then its in-page
  // onboarding takes over after sign-in. That window lives in the official
  // Desktop app, which DeepSeekGUI does not ship, so it is ported into this
  // page's frame-wide layer. It exists only in a DeepSeekGUI window, where the
  // Host shim installed `dshDesktop` and `dshOnboarding`; the account calls wait
  // for the official account Remote instead of making it a hard dependency.
  const onboarding = (globalThis as { dshOnboarding?: OnboardingCarrier }).dshOnboarding
  if (bridge !== null && 'dshDesktop' in globalThis && onboarding !== undefined) {
    await ctx.inject(['slots', 'remote.account'], (scoped) => {
      const storage = ((): Storage | null => { try { return window.sessionStorage } catch { return null } })()
      const controller = createWelcomeController(onboarding, storage)
      const stream = scoped.remote.$stream<AccountView>({
        name: 'deepseekgui-welcome-account',
        open: signal => scoped.remote.account.watch(signal),
        ended: () => new Error('account stream ended'),
      })
      scoped.effect(() => () => stream.dispose(), 'deepseekgui: welcome account stream')
      void (async () => {
        for await (const frame of stream) {
          controller.setView(frame.value)
          frame.accept()
        }
      })().catch(() => { /* A dropped stream leaves the page as it was; the official account UI reports it. */ })
      scoped.effect(() => {
        const invalidate = (): void => { controller.invalidateKey() }
        const disposers = [
          scoped.remote.$on('deepseek-account/session-expired', () => { controller.sessionExpired() }),
          scoped.remote.$on('credentials/reference-updated', invalidate),
          scoped.remote.$on('llm/adapters-updated', invalidate),
        ]
        return () => { for (const dispose of disposers) dispose() }
      }, 'deepseekgui: welcome key readiness')
      // The official account UI's client identity, read at call time.
      const client = () => {
        const version = process.env.DSH_CLIENT_VERSION
        if (version === undefined || version === '') throw new Error('account: this client build carries no DSH_CLIENT_VERSION')
        return { version, locale: ctx.locale.getSnapshot().active, timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 }
      }
      const account = {
        async start(): Promise<AccountView> {
          const transport = (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__
          const origin = transport?.streamBaseUrl !== undefined ? new URL(transport.streamBaseUrl).origin : window.location.origin
          const result = await scoped.remote.account.startSignIn(client(), origin, 'desktop')
          if (!result.ok) throw new Error('account start failed')
          return result.value
        },
        async cancel(id: NonNullable<AccountView['attempt']>['id']): Promise<AccountView> {
          const result = await scoped.remote.account.cancelSignIn(id)
          if (!result.ok) throw new Error('account cancel failed')
          return result.value
        },
      }
      scoped.slots.inject('shell.overlay', () =>
        scoped.slots.register({
          name: 'shell.overlay',
          id: 'deepseekgui-welcome',
          locale: 'deepseekgui.welcome',
          inject: () => ({ controller, account }),
        }, WelcomeOverlay))
    })
  }
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
  // B6-P4: the official chat view resolves this optional service once per
  // frame while assistant prose streams; composing it out restores the
  // authoritative-text path.
  ctx.effect(() => installTextDisplay(ctx), 'deepseekgui: streaming prose display')
  // D6's path-click delegation is retired at dsh 0.1.5: ui-deliverables links
  // the closing prose's inline-code references itself, and its vocabulary is
  // the mutation tools' own `locations` rather than a regular expression over
  // span text, so it never mistakes a shell fragment for a file. Both surfaces
  // acting on the same spans would also fire twice on one click.
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
      // The Memory view: the project memory file, edited through the desktop.
      yield scoped.slots.register({
        name: 'conversation.view',
        id: 'deepseekgui-memory',
        order: MEMORY_VIEW_ORDER,
        locale: NS_INSPECTOR,
        label: () => t('view.memory'),
        inject: (sessionId: SessionId) => ({
          ...instructions(sessionId),
          inspector: scoped.remote.workbenchInspector,
          bridge,
          tm,
        }),
      }, MemoryView)
    })
    // Settings → Global memory (B7-P9; 2026-09-29): the `<home>/memory.md`
    // editor — the JS settings plugin no longer registers this id.
    scoped.slots.inject('settings.section', () =>
      scoped.slots.register({
        name: 'settings.section',
        id: 'deepseekgui-memory',
        order: MEMORY_SECTION_ORDER,
        locale: NS_MEMORY,
        label: () => tm('nav.memory'),
        inject: () => ({ bridge }),
      }, MemorySettingsSection))
  })
}
