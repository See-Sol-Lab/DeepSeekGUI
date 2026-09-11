/**
 * First-run guide, session steps (B6-P5; reordered in P11).
 *
 * A compact strip above the composer that explains the one thing the user has
 * to do right now, in order: add the API key (only while it is still missing),
 * send the first message, wait for the reply, decide the first approval, then
 * look at the result and open the Changes tab. The workspace step lives in the
 * Hero (`FirstRunWorkspaceGuide`) because it must show before any Session.
 *
 * Every step is derived from official facts — the conversation's messages, a
 * pending approval, tool results, and the official credential state — so
 * nothing here stores progress; the desktop owns the only durable facts
 * (eligible / completed) and this component asks it whether to show at all.
 *
 * The user can skip at any time; the strip never blocks the composer and
 * never speaks in internal vocabulary (Profile, Bundle, Cordis, Remote,
 * Session JSONL).
 * @module @see-sol-lab/deepseekgui-workbench/client/FirstRunGuide
 */
import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the Session pending-interaction map (the approval entry).
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
// Type-only: pulls the Conversation and Session standard props.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ControlBridgeClient } from './bridge.ts'
import { firstRunStep, type FirstRunStepId } from './first-run.ts'
import { GuideStrip, GUIDE_POLL_MS, useFirstRunPending } from './first-run-guide-chrome.tsx'
import type { WorkbenchKey } from './locales.ts'

/** Step → localized copy key. */
const STEP_KEYS: Record<FirstRunStepId, WorkbenchKey> = {
  model: 'firstRun.model',
  message: 'firstRun.message',
  waiting: 'firstRun.waiting',
  approval: 'firstRun.approval',
}

export type FirstRunGuideProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'deepseekgui.workbench'>
  & {
    /** Desktop control bridge injected by the plugin entry. */
    bridge: ControlBridgeClient | null
    /** Whether the official credential the model needs is configured. */
    credentialConfigured: () => Promise<boolean>
  }

/**
 * Ask the official credential domain whether the DeepSeek key is configured.
 *
 * Only asked while the guide still expects a first message — the one state
 * where the answer changes the copy. An unreadable or refused answer reports
 * "not configured" (fail closed: never claim a key the user may still need to
 * add), and the value is re-read on the same cadence as the desktop poll so a
 * key filled in while the guide is up moves it on.
 * @param enabled - whether the question currently matters.
 * @param configured - official credential probe injected by the entry.
 * @returns true while the official credential reports configured.
 */
function useCredentialConfigured(enabled: boolean, configured: () => Promise<boolean>): boolean {
  const [value, setValue] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = (): void => {
      configured().then(
        (next) => { if (alive) setValue(next) },
        () => { if (alive) setValue(false) },
      )
    }
    refresh()
    const timer = setInterval(refresh, GUIDE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled, configured])
  return value
}

/**
 * Render the guide strip, or nothing when the desktop does not report a
 * pending first run (Existing Home, an upgrade with conversations, or a user
 * who already finished or skipped it).
 * @param props - slot runtime shares, locale seat, and the desktop bridge.
 * @returns the strip, or null.
 */
export function FirstRunGuide({
  bridge, credentialConfigured, useConversation, useSessionPendingInteraction, sessionId, t,
}: FirstRunGuideProps) {
  const pending = useFirstRunPending(bridge)
  const chat = useConversation(snapshot => snapshot.views.get('chat'))
  const interaction = useSessionPendingInteraction(snapshot => snapshot.get(sessionId))
  const facts = useMemo(() => {
    let spoke = false
    let answered = false
    for (const node of chat?.nodes.values() ?? []) {
      if (node.kind === 'user' || node.kind === 'steering') spoke = true
      else if (node.kind === 'assistant-step') answered = true
    }
    const approval = interaction?.kind === 'approval' ? interaction : null
    return {
      awaitingFirstMessage: !spoke,
      awaitingFirstReply: !answered,
      pendingApprovalTool: approval === null ? null : approval.toolName,
    }
  }, [chat, interaction])
  const configured = useCredentialConfigured(pending && facts.awaitingFirstMessage, credentialConfigured)
  const step = pending ? firstRunStep({ ...facts, credentialConfigured: configured }) : null
  // A first answer means the guide did its job. Writing the completion fact
  // here is not inference: the user really did walk workspace → (key) →
  // message → reply. Without it the strip would return on the next new
  // session, which is exactly the nagging the guide is supposed to avoid.
  const finished = pending && step === null
  useEffect(() => {
    if (!finished) return
    void bridge?.run({ type: 'first-run-dismiss' }).catch(() => undefined)
  }, [finished, bridge])
  if (step === null) return null
  const dismiss = (): void => {
    void bridge?.run({ type: 'first-run-dismiss' }).catch(() => undefined)
  }
  return (
    <GuideStrip
      ariaLabel={t('firstRun.aria')}
      text={t(STEP_KEYS[step.id], step.tool === null ? {} : { tool: step.tool })}
      skipLabel={t('firstRun.skip')}
      onSkip={dismiss}
    />
  )
}
