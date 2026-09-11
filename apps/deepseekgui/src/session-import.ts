/**
 * Importing conversations from a DSH home the user already had.
 *
 * Plenty of people install DeepSeekGUI on a machine that already runs the
 * official DSH. Nothing about that is a problem: DeepSeekGUI ships its own
 * runtime and keeps its own home, so the two never meet. But their history
 * lives over there and a fresh DeepSeekGUI starts empty, so offering to bring
 * the conversations across is worth doing.
 *
 * Two things this module deliberately does NOT do.
 *
 * It never touches credentials. That document holds API keys, and copying
 * someone's keys around to save them one paste is a bad trade.
 *
 * It never deletes the source. Import is a copy. "It imported" is not the
 * same as "it all came through", and the day a user finds that out must not
 * be the day their originals are already gone. Removing the old install is
 * theirs to do, once they trust the new one.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { removeTargetCopy } from './migration.ts'

/**
 * Newest session log format this build reads.
 *
 * Mirrors `SESSION_FORMAT_VERSION` in `@deepseek-ai/dsh-session`. The desktop
 * shell does not depend on that package, so the value is restated here — and
 * upstream bumping it without this following is exactly what the version check
 * below exists to catch: it fails closed rather than importing logs the
 * harness would refuse to open.
 */
export const SUPPORTED_SESSION_FORMAT_VERSION = 3

/** Sessions live at `<home>/sessions/<workspace>/<session-id>/`. */
const SESSIONS_DIRNAME = 'sessions'

/** What a candidate home holds, and whether it can be brought across. */
export interface ImportSurvey {
  /** The home the conversations would come from. */
  sourceHome: string
  /** Conversations found there. */
  count: number
  /** Log format version read from a sample, or null when none could be read. */
  formatVersion: number | null
  /** Newest format version this build opens. */
  supportedVersion: number
  /**
   * True only when there is something to bring and this build can open it.
   *
   * Older logs may come across: dsh 0.1.5 ships a released migration chain
   * (v0 to v1 to v2 to v3) and upgrades a log it can migrate on first write.
   * A log NEWER than this build is still refused up front, because no
   * downgrade exists and importing it would hand the user a pile of
   * conversations that error on open.
   */
  importable: boolean
}

/**
 * Read the log format version out of one session file.
 *
 * The header is the first line of the log; the file is Zstandard-framed, and a
 * whole-file decompress is fine here because this runs once against a single
 * sample, not across the tree.
 * @param file - a `session.jsonl.zstd` or plain `.jsonl` log.
 * @returns the version, or null when the file cannot be read as a session log.
 */
function readFormatVersion(file: string): number | null {
  try {
    const raw = readFileSync(file)
    const text = file.endsWith('.zstd')
      ? zstdDecompressSync(raw).toString('utf8')
      : raw.toString('utf8')
    const firstLine = text.split('\n')[0]
    if (firstLine === undefined || firstLine === '') return null
    const parsed: unknown = JSON.parse(firstLine)
    if (typeof parsed !== 'object' || parsed === null) return null
    const version = (parsed as { version?: unknown }).version
    return typeof version === 'number' ? version : null
  } catch {
    // A truncated, half-written or hand-edited log is not worth a failure:
    // it only means this sample tells us nothing.
    return null
  }
}

/** What one sweep of a home's sessions tree found, and whether it could look. */
export interface SessionDirsResult {
  /** Session directories found, as `[workspace, sessionId]` pairs. */
  dirs: [string, string][]
  /**
   * False only when the sessions root exists but could not be listed.
   *
   * An absent root is a readable answer — the home has no sessions. A root that
   * throws is not: the count that follows is zero because nothing could be
   * seen, not because nothing is there. Callers that persist a decision from
   * the count must refuse to decide on `false`; see `resolveFirstRunState`,
   * where an unreadable sweep would otherwise mark an existing user as new,
   * permanently.
   */
  readable: boolean
}

/** Every session directory under a home, with whether the sweep could read the root. */
export function sessionDirsResult(home: string): SessionDirsResult {
  const root = join(home, SESSIONS_DIRNAME)
  if (!existsSync(root)) return { dirs: [], readable: true }
  const found: [string, string][] = []
  let readable = true
  let workspaces: string[]
  try {
    workspaces = readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return { dirs: [], readable: false }
  }
  for (const workspace of workspaces) {
    try {
      for (const entry of readdirSync(join(root, workspace), { withFileTypes: true })) {
        if (entry.isDirectory()) found.push([workspace, entry.name])
      }
    } catch {
      readable = false
      continue
    }
  }
  return { dirs: found, readable }
}

/** Every session directory under a home, as `[workspace, sessionId]` pairs. */
export function sessionDirs(home: string): [string, string][] {
  return sessionDirsResult(home).dirs
}

/**
 * Survey a home for conversations worth offering to import.
 * @param sourceHome - the home the user already had.
 * @returns the survey, or null when there is nothing there at all.
 */
export function surveyImportableSessions(sourceHome: string): ImportSurvey | null {
  const dirs = sessionDirs(sourceHome)
  if (dirs.length === 0) return null
  let formatVersion: number | null = null
  let newestNamedGeneration = 0
  for (const [workspace, id] of dirs) {
    const dir = join(sourceHome, SESSIONS_DIRNAME, workspace, id)
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    const generations = names.map(name => ({ name, version: /^session\.v([1-9][0-9]*)\.jsonl(?:\.zstd)?$/u.exec(name)?.[1] }))
      .filter(entry => entry.version !== undefined).sort((left, right) => Number(right.version) - Number(left.version))
    newestNamedGeneration = Math.max(newestNamedGeneration, Number(generations[0]?.version ?? 0))
    if (formatVersion !== null) continue
    const log = generations[0]?.name ?? names.find(name => name === 'session.jsonl.zstd' || name === 'session.jsonl')
    if (log === undefined) continue
    formatVersion = readFormatVersion(join(dir, log))
  }
  if (newestNamedGeneration > 0) formatVersion = Math.max(formatVersion ?? 0, newestNamedGeneration)
  return {
    sourceHome,
    count: dirs.length,
    formatVersion,
    supportedVersion: SUPPORTED_SESSION_FORMAT_VERSION,
    importable: formatVersion !== null && formatVersion <= SUPPORTED_SESSION_FORMAT_VERSION,
  }
}

/** Where DeepSeekGUI keeps its own notes inside a home (shared with the event log). */
const DEEPSEEKGUI_DIRNAME = 'deepseekgui'

/** Marker recording that the import offer has already been made once. */
const OFFERED_FILENAME = 'session-import-offered'

/**
 * Whether DeepSeekGUI should offer to import into this home.
 *
 * Two conditions, both of them about not nagging. The home must hold no
 * conversations of its own — once someone has started working here, pulling
 * another history in on top is not a favour — and the offer must not have been
 * made before, so that declining it sticks even if they have not started a
 * conversation yet.
 * @param targetHome - the DeepSeekGUI managed home.
 * @returns true when an offer is appropriate.
 */
export function shouldOfferImport(targetHome: string): boolean {
  if (existsSync(join(targetHome, DEEPSEEKGUI_DIRNAME, OFFERED_FILENAME))) return false
  const sweep = sessionDirsResult(targetHome)
  return sweep.readable && sweep.dirs.length === 0
}

/**
 * Record that the offer was made, whichever way the user answered.
 *
 * Declining is an answer too, and it has to survive a restart: being asked the
 * same question on every launch is its own kind of broken.
 * @param targetHome - the DeepSeekGUI managed home.
 */
export function markImportOffered(targetHome: string): void {
  const dir = join(targetHome, DEEPSEEKGUI_DIRNAME)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, OFFERED_FILENAME), new Date().toISOString(), 'utf8')
}

/** Outcome of one import run. */
export interface ImportResult {
  /** Conversations copied across. */
  copied: number
  /** Conversations left alone because the target already had that id. */
  skipped: number
}

/**
 * Copy conversations into the DeepSeekGUI managed home.
 *
 * Never overwrites: a session id already present on the target is left as it
 * is. A fresh install has nothing to collide with, and on a second run the
 * newer work already on the target must outrank the copy being brought in
 * again.
 *
 * The source is only ever read.
 * @param sourceHome - home to import from.
 * @param targetHome - the DeepSeekGUI managed home.
 * @returns how many were copied and how many were left alone.
 */
export function importSessions(sourceHome: string, targetHome: string): ImportResult {
  let copied = 0
  let skipped = 0
  const target = sessionDirsResult(targetHome)
  const source = sessionDirsResult(sourceHome)
  if (!target.readable || !source.readable) throw new Error('A conversation directory could not be read; import was not started')
  const existing = new Set(target.dirs.map(([, id]) => id))
  for (const [workspace, id] of source.dirs) {
    const from = join(sourceHome, SESSIONS_DIRNAME, workspace, id)
    const to = join(targetHome, SESSIONS_DIRNAME, workspace, id)
    if (existing.has(id) || existsSync(to)
      || existsSync(join(targetHome, SESSIONS_DIRNAME, '.deleted', `${id}.json`))
      || existsSync(join(sourceHome, SESSIONS_DIRNAME, '.deleted', `${id}.json`))) {
      skipped += 1
      continue
    }
    mkdirSync(join(targetHome, SESSIONS_DIRNAME, workspace), { recursive: true })
    const stagingRoot = join(targetHome, DEEPSEEKGUI_DIRNAME, 'import-staging')
    mkdirSync(stagingRoot, { recursive: true })
    const staging = mkdtempSync(join(stagingRoot, 'session-'))
    try {
      cpSync(from, staging, { recursive: true, force: false, errorOnExist: true })
      renameSync(staging, to)
    } finally {
      removeTargetCopy(staging)
    }
    existing.add(id)
    copied += 1
  }
  return { copied, skipped }
}
