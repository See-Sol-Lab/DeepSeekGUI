/**
 * First-run guide, workspace step (P11).
 *
 * The guide's first step must show before any Session exists: a fresh install
 * has no workspace, and without one no Session can be created — exactly the
 * state where the user needs the instruction. It therefore renders in the
 * Hero column (`conversation.hero.dock`), not in the Session-scoped composer
 * dock, and disappears as soon as a workspace exists.
 *
 * Progress is never stored: the desktop owns `first-run.json` (the only
 * durable fact), the workspace list is the official Client projection, and the
 * user can skip at any time.
 * @module @see-sol-lab/deepseekgui-workbench/client/FirstRunWorkspaceGuide
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Hero slot declaration and the root standard hooks.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ControlBridgeClient } from './bridge.ts'
import { GuideStrip, useFirstRunPending } from './first-run-guide-chrome.tsx'

export type FirstRunWorkspaceGuideProps = PropsRuntime<'conversation.hero.dock'>
  & PropsLocale<'deepseekgui.workbench'>
  & {
    /** Desktop control bridge injected by the plugin entry. */
    bridge: ControlBridgeClient | null
  }

/**
 * Render the workspace step in the Hero, or nothing when the desktop does not
 * report a pending first run or a workspace already exists.
 * @param props - slot runtime shares, locale seat, and the desktop bridge.
 * @returns the strip, or null.
 */
export function FirstRunWorkspaceGuide({ bridge, useWorkspaces, t }: FirstRunWorkspaceGuideProps) {
  const pending = useFirstRunPending(bridge)
  const hasWorkspace = useWorkspaces(state => state.items.length > 0)
  // 工作区一旦选定，这一步就没有内容可说了。
  if (!pending || hasWorkspace) return null
  const dismiss = (): void => {
    void bridge?.run({ type: 'first-run-dismiss' }).catch(() => undefined)
  }
  return (
    <GuideStrip
      ariaLabel={t('firstRun.aria')}
      text={t('firstRun.workspace')}
      skipLabel={t('firstRun.skip')}
      onSkip={dismiss}
    />
  )
}
