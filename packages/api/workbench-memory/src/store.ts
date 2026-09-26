/**
 * Entry operations over the two domain tables. Every write quotes the
 * version it read and refuses a stale one (`MEMORY_CONFLICT`), so two windows
 * writing one entry cannot lose an update: the second writer sees the first
 * writer's version and re-reads. A write resolves only after the backend
 * made it durable; a backend failure answers `MEMORY_IO` and changes nothing.
 * Reads, searches and undo consult the `entries` table alone; a forgotten
 * entry is out of every read the moment its tombstone lands, and comes back
 * only through the explicit restore.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { EntriesTable, ForgottenTable, MemoryRecord, StoredEntry, StoredForgotten } from './spec.ts'
import { toEntry, toForgotten } from './spec.ts'
import type {
  MemoryActionInput,
  MemoryCorrectInput,
  MemoryEntry,
  MemoryError,
  MemoryForgottenEntry,
  MemoryKind,
  MemoryList,
  MemoryQuery,
  MemoryRememberInput,
  MemoryRestoreInput,
  MemoryScope,
  MemoryScopeFilter,
  MemorySource,
  MemoryWriteResult,
} from './types.ts'

/** Clock and id minting, injectable for deterministic tests. */
export interface StoreClock {
  now: () => Date
  /** Twelve lowercase hex characters. */
  hex: () => string
}

/** Limits a write must respect. */
export interface StoreLimits {
  /** Inclusive UTF-8 byte cap on `content`. */
  contentMaxBytes: number
  /** Inclusive cap on the number of keywords. */
  maxKeywords: number
}

/** Default clock: wall time and random ids. */
export const realClock: StoreClock = {
  now: () => new Date(),
  hex: () => randomBytes(6).toString('hex'),
}

const KINDS: ReadonlySet<string> = new Set<MemoryKind>(['fact', 'preference', 'continuation'])
const DEFAULT_LIMIT = 100

/**
 * Normalize content for duplicate detection: trimmed, whitespace collapsed, case folded.
 * @param text - content.
 * @returns the normalized text.
 */
export function normalizeContent(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * Hash of the normalized content.
 * @param text - content.
 * @returns sha256 hex.
 */
export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeContent(text)).digest('hex')
}

/**
 * Whether two scopes are the same scope.
 * @param left - one scope.
 * @param right - the other.
 * @returns true for two globals or two projects with one key.
 */
export function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  if (left.kind === 'global') return right.kind === 'global'
  return right.kind === 'project' && right.projectKey === left.projectKey
}

/**
 * Whether a scope filter admits a scope.
 * @param filter - the read's scope selector.
 * @param scope - an entry's scope.
 * @returns true when the entry belongs to the read.
 */
export function scopeMatches(filter: MemoryScopeFilter, scope: MemoryScope): boolean {
  switch (filter.kind) {
    case 'all': return true
    case 'global': return scope.kind === 'global'
    case 'project': return scope.kind === 'project' && scope.projectKey === filter.projectKey
    case 'session': return scope.kind === 'global' || scope.projectKey === filter.projectKey
  }
}

/** Live entries only, as stored. */
function liveEntries(entries: EntriesTable): StoredEntry[] {
  const live: StoredEntry[] = []
  for (const record of entries.entries()) {
    const [, value] = record
    if (value.state === 'active') live.push(value.entry)
  }
  return live
}

/**
 * Read live entries: scope, kinds, origin session and text filtered, newest first.
 * @param entries - the entries table.
 * @param query - the read.
 * @returns the page and the total before the limit.
 */
export function listEntries(entries: EntriesTable, query: MemoryQuery): MemoryList {
  const kinds = query.kinds === undefined || query.kinds.length === 0 ? undefined : new Set(query.kinds)
  const terms = (query.text ?? '').toLowerCase().split(/\s+/u).filter(term => term !== '')
  const matched = liveEntries(entries).filter((entry) => {
    if (!scopeMatches(query.scope, entry.scope)) return false
    if (kinds !== undefined && !kinds.has(entry.kind)) return false
    if (query.sessionId !== undefined && entry.source.sessionId !== query.sessionId) return false
    if (terms.length === 0) return true
    const haystack = `${entry.id}\n${entry.content}\n${(entry.keywords ?? []).join('\n')}`.toLowerCase()
    return terms.every(term => haystack.includes(term))
  })
  matched.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  const limit = query.limit ?? DEFAULT_LIMIT
  return { entries: matched.slice(0, Math.max(0, limit)).map(toEntry), total: matched.length }
}

/**
 * Read one live entry.
 * @param entries - the entries table.
 * @param id - entry id.
 * @returns the entry, or undefined when absent or forgotten.
 */
export function getEntry(entries: EntriesTable, id: string): MemoryEntry | undefined {
  const record = entries.get(id)
  return record?.state === 'active' ? toEntry(record.entry) : undefined
}

/**
 * Read the forgotten entries of a scope, newest forgotten first.
 * @param forgotten - the forgotten table.
 * @param filter - scope selector.
 * @returns the records.
 */
export function listForgotten(forgotten: ForgottenTable, filter: MemoryScopeFilter): MemoryForgottenEntry[] {
  const matched: StoredForgotten[] = []
  for (const [, record] of forgotten.entries()) {
    if (scopeMatches(filter, record.entry.scope)) matched.push(record)
  }
  matched.sort((left, right) => right.forgottenAt.localeCompare(left.forgottenAt) || left.entry.id.localeCompare(right.entry.id))
  return matched.map(toForgotten)
}

/**
 * The live entry of a scope whose normalized content equals the text.
 * @param entries - the entries table.
 * @param scope - scope to search.
 * @param text - content to compare.
 * @returns the duplicate's id, or undefined.
 */
export function findDuplicate(entries: EntriesTable, scope: MemoryScope, text: string): string | undefined {
  const hash = contentHash(text)
  return liveEntries(entries).find(entry => sameScope(entry.scope, scope) && contentHash(entry.content) === hash)?.id
}

/** Validated content and keywords. */
type Validated = { ok: true; content: string; keywords: string[] | undefined } | { ok: false; error: MemoryError }

function validate(content: string | undefined, keywords: string[] | undefined, limits: StoreLimits, required: boolean): Validated {
  const trimmed = content?.trim()
  if (required && (trimmed === undefined || trimmed === '')) return { ok: false, error: invalid('content must not be empty') }
  if (trimmed !== undefined && trimmed === '') return { ok: false, error: invalid('content must not be empty') }
  if (trimmed !== undefined && Buffer.byteLength(trimmed) > limits.contentMaxBytes) {
    return { ok: false, error: invalid(`content exceeds ${limits.contentMaxBytes} bytes`) }
  }
  let cleaned: string[] | undefined
  if (keywords !== undefined) {
    cleaned = [...new Set(keywords.map(keyword => keyword.trim()).filter(keyword => keyword !== ''))]
    if (cleaned.length > limits.maxKeywords) return { ok: false, error: invalid(`more than ${limits.maxKeywords} keywords`) }
  }
  return { ok: true, content: trimmed ?? '', keywords: cleaned }
}

function invalid(message: string): MemoryError {
  return { code: 'MEMORY_INVALID', message }
}

function ioError(action: string, error: unknown): MemoryError {
  return { code: 'MEMORY_IO', message: `${action} was not persisted: ${String(error)}` }
}

function stamp(source: Omit<MemorySource, 'at'>, at: string): MemorySource {
  return { ...source, at }
}

/** The live record a versioned write addresses, or the error that stops it. */
type Located = { ok: true; entry: StoredEntry } | { ok: false; error: MemoryError }

function locate(entries: EntriesTable, id: string, expectedVersion: number): Located {
  const record = entries.get(id)
  if (record === undefined) return { ok: false, error: { code: 'MEMORY_NOT_FOUND', message: `no entry ${id}` } }
  if (record.state === 'forgotten') {
    return { ok: false, error: { code: 'MEMORY_FORGOTTEN', message: `entry ${id} was forgotten; restore it explicitly`, currentVersion: record.version } }
  }
  if (record.entry.version !== expectedVersion) {
    return {
      ok: false,
      error: {
        code: 'MEMORY_CONFLICT',
        message: `entry ${id} is at version ${record.entry.version}, the write quoted ${expectedVersion}`,
        currentVersion: record.entry.version,
      },
    }
  }
  return { ok: true, entry: record.entry }
}

/**
 * Add an entry.
 * @param entries - the entries table.
 * @param input - the entry.
 * @param clock - time and ids.
 * @param limits - write limits.
 * @returns the persisted entry, or the error.
 */
export async function remember(
  entries: EntriesTable,
  input: MemoryRememberInput,
  clock: StoreClock,
  limits: StoreLimits,
): Promise<MemoryWriteResult> {
  if (!KINDS.has(input.kind)) return { ok: false, error: invalid(`unknown kind "${input.kind}"`) }
  if (input.scope.kind === 'project' && (input.scope.projectKey === '' || input.scope.path === '')) {
    return { ok: false, error: invalid('a project scope needs its key and path') }
  }
  const checked = validate(input.content, input.keywords, limits, true)
  if (!checked.ok) return checked
  let id = `m_${clock.hex()}`
  while (entries.get(id) !== undefined) id = `m_${clock.hex()}`
  const at = clock.now().toISOString()
  const entry: StoredEntry = {
    id,
    scope: input.scope,
    kind: input.kind,
    content: checked.content,
    ...checked.keywords === undefined ? {} : { keywords: checked.keywords },
    source: stamp(input.source, at),
    version: 1,
    createdAt: at,
    updatedAt: at,
  }
  try {
    await entries.put(id, { state: 'active', entry })
  } catch (error) {
    return { ok: false, error: ioError('remember', error) }
  }
  return { ok: true, entry: toEntry(entry) }
}

/**
 * Correct an entry: the new content replaces the old, the old state moves to
 * `previous`, the origin source stays and the correction's source is appended.
 * @param entries - the entries table.
 * @param input - the correction.
 * @param clock - time.
 * @param limits - write limits.
 * @returns the persisted entry, or the error.
 */
export async function correct(
  entries: EntriesTable,
  input: MemoryCorrectInput,
  clock: StoreClock,
  limits: StoreLimits,
): Promise<MemoryWriteResult> {
  if (input.content === undefined && input.keywords === undefined && input.kind === undefined) {
    return { ok: false, error: invalid('a correction changes content, keywords or kind') }
  }
  if (input.kind !== undefined && !KINDS.has(input.kind)) return { ok: false, error: invalid(`unknown kind "${input.kind}"`) }
  const checked = validate(input.content, input.keywords, limits, false)
  if (!checked.ok) return checked
  const located = locate(entries, input.id, input.expectedVersion)
  if (!located.ok) return located
  const current = located.entry
  const at = clock.now().toISOString()
  const keywords = input.keywords === undefined ? current.keywords : checked.keywords
  const next: StoredEntry = {
    ...current,
    kind: input.kind ?? current.kind,
    content: input.content === undefined ? current.content : checked.content,
    ...keywords === undefined ? { keywords: undefined } : { keywords },
    version: current.version + 1,
    revised: { action: 'correct', at, source: stamp(input.source, at) },
    previous: snapshot(current),
    updatedAt: at,
  }
  return await write(entries, next, 'correct')
}

/**
 * Undo the latest change: the entry returns to `previous`, and the undone
 * state becomes the new `previous` so a second undo redoes it.
 * @param entries - the entries table.
 * @param input - the action.
 * @param clock - time.
 * @returns the persisted entry, or the error.
 */
export async function undo(entries: EntriesTable, input: MemoryActionInput, clock: StoreClock): Promise<MemoryWriteResult> {
  const located = locate(entries, input.id, input.expectedVersion)
  if (!located.ok) return located
  const current = located.entry
  const previous = current.previous
  if (previous === undefined) return { ok: false, error: { code: 'MEMORY_NO_PREVIOUS', message: `entry ${input.id} has no earlier state to return to` } }
  const at = clock.now().toISOString()
  const next: StoredEntry = {
    ...current,
    kind: previous.kind,
    content: previous.content,
    ...previous.keywords === undefined ? { keywords: undefined } : { keywords: previous.keywords },
    version: current.version + 1,
    revised: { action: 'undo', at, source: stamp(input.source, at) },
    previous: snapshot(current),
    updatedAt: at,
  }
  return await write(entries, next, 'undo')
}

/**
 * Forget an entry: the whole entry moves to the forgotten table and a
 * tombstone takes its place, so reads stop matching it and a stale write
 * conflicts instead of reviving it.
 * @param entries - the entries table.
 * @param forgotten - the forgotten table.
 * @param input - the action.
 * @param clock - time.
 * @returns the entry as it was, or the error.
 */
export async function forget(
  entries: EntriesTable,
  forgotten: ForgottenTable,
  input: MemoryActionInput,
  clock: StoreClock,
): Promise<MemoryWriteResult> {
  const located = locate(entries, input.id, input.expectedVersion)
  if (!located.ok) return located
  const current = located.entry
  const at = clock.now().toISOString()
  const forgottenBy = stamp(input.source, at)
  try {
    await forgotten.put(current.id, { entry: current, forgottenAt: at, forgottenBy })
  } catch (error) {
    return { ok: false, error: ioError('forget', error) }
  }
  const tombstone: MemoryRecord = { state: 'forgotten', id: current.id, scope: current.scope, version: current.version + 1, forgottenAt: at }
  try {
    await entries.put(current.id, tombstone)
  } catch (error) {
    // The copy went in but the live record could not be replaced: take the copy back out so the store stays consistent.
    /* v8 ignore next -- a failing delete right after a successful put on the same table needs a fault the harness cannot inject. */
    await forgotten.delete(current.id).catch(() => false)
    return { ok: false, error: ioError('forget', error) }
  }
  return { ok: true, entry: toEntry(current) }
}

/**
 * Restore a forgotten entry. Explicit only: nothing calls this on its own.
 * @param entries - the entries table.
 * @param forgotten - the forgotten table.
 * @param input - the action.
 * @param clock - time.
 * @returns the live entry, or the error.
 */
export async function restore(
  entries: EntriesTable,
  forgotten: ForgottenTable,
  input: MemoryRestoreInput,
  clock: StoreClock,
): Promise<MemoryWriteResult> {
  const kept = forgotten.get(input.id)
  if (kept === undefined) return { ok: false, error: { code: 'MEMORY_NOT_FOUND', message: `no forgotten entry ${input.id}` } }
  const record = entries.get(input.id)
  if (record?.state === 'active') {
    return { ok: false, error: { code: 'MEMORY_CONFLICT', message: `entry ${input.id} is already live`, currentVersion: record.entry.version } }
  }
  const at = clock.now().toISOString()
  const base = record === undefined ? kept.entry.version : record.version
  const next: StoredEntry = {
    ...kept.entry,
    version: base + 1,
    revised: { action: 'restore', at, source: stamp(input.source, at) },
    updatedAt: at,
  }
  const written = await write(entries, next, 'restore')
  if (!written.ok) return written
  // A copy left behind is harmless: a second restore sees the live entry and conflicts.
  /* v8 ignore next -- a failing delete right after a successful put needs a fault the harness cannot inject. */
  await forgotten.delete(input.id).catch(() => false)
  return written
}

/**
 * Mark every entry whose origin session's content was deleted — live ones
 * and kept-aside forgotten ones — so a reader knows the source is gone
 * without anything re-reading the deleted session. Metadata only: the
 * version does not move, so no open window's quoted version goes stale.
 * A record that fails to persist is reported and skipped; the rest are marked.
 * @param entries - the entries table.
 * @param forgotten - the forgotten table.
 * @param sessionId - the deleted session.
 * @returns the ids marked, and the ids whose mark did not persist.
 */
export async function markSessionDeleted(
  entries: EntriesTable,
  forgotten: ForgottenTable,
  sessionId: string,
): Promise<{ marked: string[]; failed: string[] }> {
  const marked: string[] = []
  const failed: string[] = []
  for (const [id, record] of [...entries.entries()]) {
    if (record.state !== 'active' || record.entry.source.sessionId !== sessionId || record.entry.source.sessionDeleted === true) continue
    const next: StoredEntry = { ...record.entry, source: { ...record.entry.source, sessionDeleted: true } }
    try {
      await entries.put(id, { state: 'active', entry: next })
      marked.push(id)
    } catch {
      failed.push(id)
    }
  }
  for (const [id, record] of [...forgotten.entries()]) {
    if (record.entry.source.sessionId !== sessionId || record.entry.source.sessionDeleted === true) continue
    const next: StoredForgotten = { ...record, entry: { ...record.entry, source: { ...record.entry.source, sessionDeleted: true } } }
    try {
      await forgotten.put(id, next)
      marked.push(id)
    } catch {
      failed.push(id)
    }
  }
  return { marked, failed }
}

function snapshot(current: StoredEntry): NonNullable<StoredEntry['previous']> {
  return {
    version: current.version,
    content: current.content,
    ...current.keywords === undefined ? {} : { keywords: current.keywords },
    kind: current.kind,
    ...current.revised === undefined ? {} : { revised: current.revised },
    updatedAt: current.updatedAt,
  }
}

async function write(entries: EntriesTable, next: StoredEntry, action: string): Promise<MemoryWriteResult> {
  try {
    await entries.put(next.id, { state: 'active', entry: next })
  } catch (error) {
    return { ok: false, error: ioError(action, error) }
  }
  return { ok: true, entry: toEntry(next) }
}
