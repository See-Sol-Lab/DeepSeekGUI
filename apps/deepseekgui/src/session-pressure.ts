/**
 * How many sessions a Home is carrying, and whether that is enough to be
 * worth telling the user about.
 *
 * The session projection cache keeps one row per session and never drops one:
 * a deleted conversation leaves its row behind, so the file only grows. At a
 * few kilobytes per row that is invisible for a long time and then is not —
 * upstream has a report of the cache growing until V8 ran out of memory on
 * every boot, which the reporter escaped by renaming the file.
 *
 * DeepSeekGUI does not clean up on the user's behalf. It counts, and when the
 * count crosses the threshold it says so where the user will see it. What to
 * do about it is theirs to decide — these are their conversations.
 */

import { sessionDirs } from './session-import.ts'

/**
 * Session count past which DeepSeekGUI starts warning.
 *
 * Not a cliff — nothing breaks at 50,000. It is the order of magnitude where
 * the cache reaches the hundreds of megabytes that have actually broken
 * someone, chosen to leave room to act rather than to mark the failure point.
 */
export const SESSION_WARNING_THRESHOLD = 50_000

/** How long a count stays good enough to reuse. */
const COUNT_CACHE_MS = 5 * 60 * 1000

/** The pressure reading DeepSeekGUI shows in the settings page. */
export interface SessionPressure {
  /** Sessions counted under this Home. */
  count: number
  /** The threshold that was crossed. */
  threshold: number
}

interface CachedCount {
  count: number
  at: number
}

const counts = new Map<string, CachedCount>()

/**
 * Count session directories under a Home.
 *
 * `sessionDirs` already walks exactly this tree (one directory per session,
 * one level of workspace above it) for the first-boot import offer, and
 * main.ts already counts with it. A home with no sessions directory yet
 * counts zero rather than failing — a fresh install is not an error state.
 * @param homePath - the Home to count under.
 * @returns the number of session directories, or 0 when the tree is absent or unreadable.
 */
export function countSessions(homePath: string): number {
  return sessionDirs(homePath).length
}

/**
 * Read the session pressure for a Home, counting at most once per cache window.
 *
 * The control model refreshes on a timer, and a home holding tens of thousands
 * of sessions is exactly the one where re-counting on every refresh would be
 * felt. The number moves slowly by nature, so a stale reading costs nothing.
 * @param homePath - the Home to read.
 * @param now - clock, injectable for tests.
 * @param threshold - warning threshold; injectable so a test need not create 50,000 directories.
 * @returns the reading when the threshold is crossed, otherwise null.
 */
export function readSessionPressure(
  homePath: string,
  now: () => number = Date.now,
  threshold: number = SESSION_WARNING_THRESHOLD,
): SessionPressure | null {
  const at = now()
  const cached = counts.get(homePath)
  const count = cached !== undefined && at - cached.at < COUNT_CACHE_MS
    ? cached.count
    : countSessions(homePath)
  counts.set(homePath, { count, at })
  if (count < threshold) return null
  return { count, threshold }
}

/** Drop every cached count. Test seam; also correct after a Home switch. */
export function clearSessionPressureCache(): void {
  counts.clear()
}
