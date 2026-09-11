/**
 * First-run guide step derivation (B6-P5, reordered in P11).
 *
 * The guide stores no progress: every step is derived from official facts —
 * the workspace list, the current conversation's messages, a pending approval,
 * tool results, and the official credential state. The only durable facts
 * (eligible / completed) live in the desktop's `first-run.json`; this module
 * never writes anything.
 *
 * Order fixed by the 2026-09-10 human acceptance: a fresh install cannot have
 * a Session before a Workspace, so the first step is "choose a workspace" and
 * it must render without any Session (see FirstRunWorkspaceGuide). The API-key
 * step only appears for users who still have no credential — most users fill
 * the official key prompt at first launch and must not be told to do it again.
 * @module @see-sol-lab/deepseekgui-workbench/client/first-run
 */

/** Official facts the current step is derived from. */
export interface FirstRunFacts {
  /** The current conversation has no user message yet. */
  readonly awaitingFirstMessage: boolean
  /** The current conversation has no assistant message yet. */
  readonly awaitingFirstReply: boolean
  /** Tool name of a pending approval in the current conversation, or null. */
  readonly pendingApprovalTool: string | null
  /** The official credential the model needs is already configured. */
  readonly credentialConfigured: boolean
}

/** The step the guide is currently explaining. */
export type FirstRunStepId = 'model' | 'message' | 'waiting' | 'approval'

/** One derived step; the approval step carries the tool it is about. */
export interface FirstRunStep {
  readonly id: FirstRunStepId
  /** Tool requesting the decision, for the approval step; null otherwise. */
  readonly tool: string | null
}

/**
 * Derive the current step from official facts, or null once the guide is done.
 *
 * A pending approval wins: it is the only step where the user is blocked and
 * needs the explanation right now. Then the first missing milestone in order —
 * the credential (only while it is missing), the first message, the first
 * reply.
 *
 * The guide ends at the reply (句芒 2026-09-10 human acceptance). It used to
 * close by pointing at the Changes tab, but plenty of people never open a
 * repository at all — sending them to a Git surface they have no use for is
 * advice about an empty page. Reaching a first answer is the whole point of a
 * first run, so that is where it stops.
 * @param facts - official conversation and credential facts.
 * @returns the step to explain, or null when the guide has nothing left to say.
 */
export function firstRunStep(facts: FirstRunFacts): FirstRunStep | null {
  if (facts.pendingApprovalTool !== null) {
    return { id: 'approval', tool: facts.pendingApprovalTool }
  }
  if (facts.awaitingFirstMessage) {
    return { id: facts.credentialConfigured ? 'message' : 'model', tool: null }
  }
  if (facts.awaitingFirstReply) return { id: 'waiting', tool: null }
  return null
}
