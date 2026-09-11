/**
 * DeepSeekGUI first-run guide state (B6-P5).
 *
 * One owner for the guide's durable facts, in one atomically written file
 * under userData: whether this installation is eligible (decided once, at the
 * first resolution — a Managed Home with no conversations of its own) and
 * whether the user finished or skipped the guide. Deciding eligibility once
 * and keeping it is what separates a new user who is halfway through the guide
 * from an upgrade that already had conversations: the former finds the guide
 * where they left it after a restart, the latter is never shown it.
 *
 * The guide's *progress* is never stored. Each step is derived from official
 * facts (Workspaces, the current conversation's messages, pending approvals),
 * so there is no second state machine and no inferred completion.
 * @module @see-sol-lab/deepseekgui/first-run
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write.ts'

/** Guide state filename under the Electron userData directory. */
export const FIRST_RUN_FILENAME = 'first-run.json'

/** Current guide-state schema version. */
const FIRST_RUN_VERSION = 1 as const

/** Durable guide facts: one owner, two fields. */
export interface FirstRunState {
  readonly schemaVersion: 1
  /** True when this installation was a fresh Managed Home at first resolution. */
  readonly eligible: boolean
  /** ISO-8601 instant the user finished or skipped the guide; null while pending. */
  readonly completedAt: string | null
}

/** A read result: the state, or null with the reason it could not be trusted. */
export interface FirstRunRead {
  readonly state: FirstRunState | null
  readonly error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and validate the guide state file.
 * @param content - raw file text.
 * @returns the validated state.
 * @throws Error on any JSON, version, or field problem.
 */
export function parseFirstRunState(content: string): FirstRunState {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    throw new Error(`first-run state: not valid JSON: ${String(error instanceof Error ? error.message : error)}`)
  }
  if (!isRecord(raw)) throw new Error('first-run state: top level must be an object')
  for (const key of Object.keys(raw)) {
    if (key !== 'schemaVersion' && key !== 'eligible' && key !== 'completedAt') {
      throw new Error(`first-run state: unknown field "${key}"`)
    }
  }
  if (raw.schemaVersion !== FIRST_RUN_VERSION) {
    throw new Error(`first-run state: unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}`)
  }
  if (typeof raw.eligible !== 'boolean') throw new Error('first-run state: eligible must be a boolean')
  if (raw.completedAt !== null && typeof raw.completedAt !== 'string') {
    throw new Error('first-run state: completedAt must be a string or null')
  }
  return { schemaVersion: 1, eligible: raw.eligible, completedAt: raw.completedAt }
}

/**
 * Read the guide state. A missing file is "never resolved"; an unreadable or
 * invalid file reports the reason so the caller can fail closed (no guide)
 * instead of nagging an upgrade whose file went bad.
 * @param userDataDir - Electron userData directory.
 * @returns the state (or null) plus an optional damage reason.
 */
export function readFirstRunState(userDataDir: string): FirstRunRead {
  const path = join(userDataDir, FIRST_RUN_FILENAME)
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: null, error: null }
    return { state: null, error: `first-run state: read failed: ${String(error instanceof Error ? error.message : error)}` }
  }
  try {
    return { state: parseFirstRunState(content), error: null }
  } catch (error) {
    return { state: null, error: String(error instanceof Error ? error.message : error) }
  }
}

/**
 * Write the guide state atomically (same-directory temp file + rename).
 * @param userDataDir - Electron userData directory.
 * @param state - the state to persist.
 */
export function writeFirstRunState(userDataDir: string, state: FirstRunState): void {
  atomicWriteFile(
    join(userDataDir, FIRST_RUN_FILENAME),
    `${JSON.stringify(state, null, 2)}\n`,
    message => new Error(`first-run state: write failed: ${message}`),
  )
}

/**
 * Resolve the durable guide facts once per installation.
 *
 * The first resolution decides eligibility and persists it: a Managed Home
 * that holds no conversation of its own is eligible; anything else (an
 * Existing Home, or a Managed Home that already has conversations — the
 * upgrade case) is recorded as ineligible so later launches never re-decide
 * and never show the guide. A damaged file fails closed: no guide.
 *
 * A count that could not actually be taken defers the decision instead of
 * making it: `sessionCount` reads zero both when a home holds no conversation
 * and when its sessions directory refused to list, and this resolution is
 * persisted once and never revisited, so deciding on an unreadable sweep would
 * mark an existing user as new for good. `sessionsReadable: false` therefore
 * returns null — no guide this run, decide again on the next launch.
 * @param input - userData directory, active home kind, its conversation count,
 * and whether that count came from a readable sweep.
 * @returns the persisted state, or null when the guide must not show.
 */
export function resolveFirstRunState(input: {
  userDataDir: string
  homeKind: 'managed' | 'existing'
  sessionCount: number
  sessionsReadable: boolean
}): FirstRunState | null {
  const existing = readFirstRunState(input.userDataDir)
  if (existing.state !== null) return existing.state
  if (existing.error !== null) return null
  if (!input.sessionsReadable) return null
  const eligible = input.homeKind === 'managed' && input.sessionCount === 0
  const state: FirstRunState = { schemaVersion: 1, eligible, completedAt: null }
  try {
    writeFirstRunState(input.userDataDir, state)
  } catch {
    // A state file we cannot persist must not block startup; the guide stays
    // hidden for this run and the next resolution tries again.
    return null
  }
  return state
}

/**
 * Whether the guide should show for this state.
 * @param state - resolved durable facts, or null when unavailable.
 * @returns true only for an eligible, unfinished installation.
 */
export function isFirstRunPending(state: FirstRunState | null): boolean {
  return state !== null && state.eligible && state.completedAt === null
}

/**
 * Record that the user finished or skipped the guide. Idempotent.
 * @param userDataDir - Electron userData directory.
 * @param state - the state resolved for this installation (null when hidden).
 * @param now - completion instant; defaults to the current time.
 * @returns the updated state, or null when there was nothing to complete.
 */
export function markFirstRunCompleted(
  userDataDir: string,
  state: FirstRunState | null,
  now: Date = new Date(),
): FirstRunState | null {
  if (state === null || !state.eligible || state.completedAt !== null) return state
  const next: FirstRunState = { ...state, completedAt: now.toISOString() }
  writeFirstRunState(userDataDir, next)
  return next
}
