/**
 * The memory domain declaration: record schemas and the `deepseekgui_memory`
 * spec. `per-record` layout writes one document per entry under
 * `<DSH_HOME>/storages/deepseekgui_memory/entries/<id>.json`, readable and
 * atomically replaced; forgotten entries move to `forgotten/<id>.json` and
 * leave a tombstone in `entries` so a stale cross-window write reports a
 * conflict instead of reviving the text.
 */
import { z } from 'zod'
import { defineDomain, domainTable, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { MemoryChange, MemoryEntry, MemoryForgottenEntry, MemoryInjectionMode, MemoryRevision, MemoryScope, MemorySource } from './types.ts'

const memoryScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), projectKey: z.string().min(1), path: z.string().min(1) }),
])

const memoryKind = z.enum(['fact', 'preference', 'continuation'])

const memorySource = z.object({
  kind: z.enum(['user', 'assistant', 'import']),
  sessionId: z.string().min(1).optional(),
  sessionDeleted: z.literal(true).optional(),
  at: z.string().min(1),
  evidence: z.string().optional(),
  detail: z.string().optional(),
})

const memoryChange = z.object({
  action: z.enum(['correct', 'undo', 'restore']),
  at: z.string().min(1),
  source: memorySource,
})

const memoryRevision = z.object({
  version: z.number().int().positive(),
  content: z.string(),
  keywords: z.array(z.string()).optional(),
  kind: memoryKind,
  revised: memoryChange.optional(),
  updatedAt: z.string().min(1),
})

/** One live entry as stored. */
export const memoryEntry = z.object({
  id: z.string().regex(/^m_[0-9a-f]{12}$/u),
  scope: memoryScope,
  kind: memoryKind,
  content: z.string().min(1),
  keywords: z.array(z.string()).optional(),
  source: memorySource,
  version: z.number().int().positive(),
  revised: memoryChange.optional(),
  previous: memoryRevision.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

/** A record of the `entries` table: a live entry, or the tombstone a forgotten one leaves behind. */
export const memoryRecord = z.discriminatedUnion('state', [
  z.object({ state: z.literal('active'), entry: memoryEntry }),
  z.object({
    state: z.literal('forgotten'),
    id: z.string().min(1),
    scope: memoryScope,
    /** The version after forgetting; a write quoting an older version conflicts. */
    version: z.number().int().positive(),
    forgottenAt: z.string().min(1),
  }),
])

/** A record of the `forgotten` table. */
export const memoryForgottenRecord = z.object({
  entry: memoryEntry,
  forgottenAt: z.string().min(1),
  forgottenBy: memorySource,
})

/** The global slot: which memory path sessions use. */
export const memoryGlobal = z.object({
  injection: z.enum(['markdown', 'entries', 'off']),
})

/** A stored live entry (zod-inferred; optionals admit `undefined`, the wire shape does not). */
export type StoredEntry = z.infer<typeof memoryEntry>

/** A record of the `entries` table. */
export type MemoryRecord = z.infer<typeof memoryRecord>

/** The tombstone half of {@link MemoryRecord}. */
export type MemoryTombstone = Extract<MemoryRecord, { state: 'forgotten' }>

/** A record of the `forgotten` table. */
export type StoredForgotten = z.infer<typeof memoryForgottenRecord>

/** The global slot value. */
export interface MemoryGlobal {
  injection: MemoryInjectionMode
}

/** The global slot before the first write: the legacy files stay the live memory. */
const memoryGlobalInitial: MemoryGlobal = { injection: 'markdown' }

/** The memory domain spec: the single source of identity, version, layout and schemas. */
export const memoryDomainSpec = defineDomain({
  name: 'deepseekgui_memory',
  version: 1,
  layout: 'per-record',
  global: { schema: memoryGlobal, initial: memoryGlobalInitial },
  tables: {
    entries: domainTable<string, MemoryRecord>(memoryRecord),
    forgotten: domainTable<string, StoredForgotten>(memoryForgottenRecord),
  },
})

/** The live/tombstone table handle. */
export type EntriesTable = KvTable<string, MemoryRecord>

/** The forgotten table handle. */
export type ForgottenTable = KvTable<string, StoredForgotten>

/**
 * Project a stored entry onto the wire shape: optional fields are present
 * only when set, as the JSON on disk and on the wire has them.
 * @param stored - entry as stored.
 * @returns the wire entry.
 */
export function toEntry(stored: StoredEntry): MemoryEntry {
  return {
    id: stored.id,
    scope: toScope(stored.scope),
    kind: stored.kind,
    content: stored.content,
    ...stored.keywords === undefined ? {} : { keywords: [...stored.keywords] },
    source: toSource(stored.source),
    version: stored.version,
    ...stored.revised === undefined ? {} : { revised: toChange(stored.revised) },
    ...stored.previous === undefined ? {} : { previous: toRevision(stored.previous) },
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  }
}

/**
 * Project a stored forgotten record onto the wire shape.
 * @param stored - record as stored.
 * @returns the wire record.
 */
export function toForgotten(stored: StoredForgotten): MemoryForgottenEntry {
  return { entry: toEntry(stored.entry), forgottenAt: stored.forgottenAt, forgottenBy: toSource(stored.forgottenBy) }
}

function toScope(scope: z.infer<typeof memoryScope>): MemoryScope {
  return scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', projectKey: scope.projectKey, path: scope.path }
}

function toSource(source: z.infer<typeof memorySource>): MemorySource {
  return {
    kind: source.kind,
    ...source.sessionId === undefined ? {} : { sessionId: source.sessionId },
    ...source.sessionDeleted === undefined ? {} : { sessionDeleted: true },
    at: source.at,
    ...source.evidence === undefined ? {} : { evidence: source.evidence },
    ...source.detail === undefined ? {} : { detail: source.detail },
  }
}

function toChange(change: z.infer<typeof memoryChange>): MemoryChange {
  return { action: change.action, at: change.at, source: toSource(change.source) }
}

function toRevision(revision: z.infer<typeof memoryRevision>): MemoryRevision {
  return {
    version: revision.version,
    content: revision.content,
    ...revision.keywords === undefined ? {} : { keywords: [...revision.keywords] },
    kind: revision.kind,
    ...revision.revised === undefined ? {} : { revised: toChange(revision.revised) },
    updatedAt: revision.updatedAt,
  }
}
