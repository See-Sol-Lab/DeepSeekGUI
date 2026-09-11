/**
 * Pure B5-P6 notifier model: which official facts become one-shot desktop
 * notifications, and how they deduplicate. Everything is derived from
 * official interaction/job facts only — no local queue, no persistence, no
 * inference from retired task tables. Deduplication keys are
 * `session + official event id`; the desktop side stays stateless.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Minimal official job row read from the sessions snapshot (JobView wire subset). */
export interface NotifyJobLike {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: string
}

/** One job transition worth a notification. */
export interface JobNotice {
  readonly sessionId: SessionId
  readonly jobId: string
  readonly status: 'completed' | 'failed'
  readonly label: string
  readonly kind: string
}

/**
 * Advance the page-lifetime job memory for one session's job list and return
 * the transitions worth notifying. Baseline suppression: a job seen for the
 * first time only establishes memory (a reconnect/refresh replay of an
 * already-finished job must not notify); only a *change* into completed or
 * failed notifies, once per job because the memory then holds the terminal
 * status.
 * @param memory - page-lifetime memory keyed `${sessionId}\u0000${jobId}`.
 * @param sessionId - owning session.
 * @param jobs - the session's current official job list.
 * @returns notifications for changed jobs; memory updated in place.
 */
export function advanceJobMemory(
  memory: Map<string, string>,
  sessionId: SessionId,
  jobs: readonly NotifyJobLike[],
): JobNotice[] {
  const prefix = `${sessionId}\u0000`
  const seen = new Set<string>()
  const notices: JobNotice[] = []
  for (const job of jobs) {
    const key = `${prefix}${job.id}`
    seen.add(key)
    const previous = memory.get(key)
    if (previous !== undefined && previous !== job.status
      && (job.status === 'completed' || job.status === 'failed')) {
      notices.push({
        sessionId,
        jobId: job.id,
        status: job.status,
        label: job.label,
        kind: job.kind,
      })
    }
    memory.set(key, job.status)
  }
  // Prune jobs that left the official list (their next arrival is again a
  // baseline, so a stale memory cannot suppress a legitimate future notice).
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix) && !seen.has(key)) memory.delete(key)
  }
  return notices
}

/** Narrow approval fields the notifier reads off the official pending fact. */
export interface ApprovalPendingLike {
  readonly kind: 'approval'
  /** Official pending-request identity, unique within the page lifetime. */
  readonly key: string
  /** Correlated tool call when the asker supplied one — the stable official id. */
  readonly callId?: string | undefined
  readonly toolName?: string | undefined
  readonly reason?: string | undefined
}

/** Narrow question fields the notifier reads off the official pending fact. */
export interface QuestionPendingLike {
  readonly kind: 'question' | 'plan-review'
  /** Official pending-request identity, distinct from question item ids. */
  readonly key: string
  readonly questions?: readonly { id?: string; question?: string }[] | undefined
}

/**
 * Approvals use their correlated call id; other requests use the owner's
 * pending-request key. Question item ids may repeat in a later request.
 * @param pending - the official pending fact.
 * @returns the identity to combine with the Session for page-lifetime deduplication.
 */
export function officialEventIdOf(pending: ApprovalPendingLike | QuestionPendingLike): string {
  if (pending.kind === 'approval') {
    if (pending.callId !== undefined && pending.callId !== '') return pending.callId
    return pending.key
  }
  return pending.key
}

/** Collapse whitespace and bound a notification body line. */
export function compactLine(text: string, max = 400): string {
  const oneLine = text.replace(/\s+/gu, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max)}…`
}

/**
 * Read the shared fields of an official pending interaction defensively.
 * Pending approvals/questions are session-scoped official facts; consumers
 * that only need to identify and summarize them read this narrow shape
 * instead of importing the owning feature packages.
 * @param value - one entry of the session pending-interaction snapshot.
 * @returns the narrow read, or null when the value is not a pending fact.
 */
export function readPending(value: unknown): PendingRead | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.key !== 'string') return null
  if (typeof record.kind !== 'string') return null
  const read: PendingRead = { kind: record.kind, key: record.key }
  if (typeof record.callId === 'string' && record.callId !== '') read.callId = record.callId
  if (typeof record.toolName === 'string') read.toolName = record.toolName
  if (typeof record.reason === 'string') read.reason = record.reason
  if (Array.isArray(record.questions)) {
    const questions: { id?: string; question?: string }[] = []
    for (const item of record.questions) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      questions.push({
        ...(typeof row.id === 'string' ? { id: row.id } : {}),
        ...(typeof row.question === 'string' ? { question: row.question } : {}),
      })
    }
    read.questions = questions
  }
  return read
}

/** Narrow shape the notifier reads off official pending interactions. */
export interface PendingRead {
  kind: string
  key: string
  callId?: string
  toolName?: string
  reason?: string
  questions?: readonly { id?: string; question?: string }[]
}
