/**
 * Pure helpers of the memory pages (B7-P9): the Remote namespace type, the
 * "what this session used" record read from the Chat window's injected
 * context rows, the Markdown export, and small formatting helpers. No React,
 * no I/O — everything here is unit-tested on its own.
 */
import type { RemoteResult, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: merges the generated `workbenchMemory` namespace into the Remote map.
import type {} from '@deepseek-ai/dsh-workbench-memory/remote'
import type { MemoryEntry, MemoryKind, MemoryRecallSource } from '@deepseek-ai/dsh-workbench-memory/types'

/** The generated `workbenchMemory` Remote namespace the plugin entry mounts. */
export type MemoryRemote = TypertRemoteNamespaceMap['workbenchMemory']

/** The kinds, in the order the pages list them. */
export const KINDS: readonly MemoryKind[] = ['fact', 'preference', 'continuation']

/**
 * Unwrap a Remote result into a value or throw its error.
 * @param result - a Remote result.
 * @returns the value.
 */
export function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

/**
 * The message of an error-like value.
 * @param error - anything thrown.
 * @returns the text.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Split a comma-separated keyword field.
 * @param text - the field.
 * @returns distinct trimmed keywords.
 */
export function keywordsFrom(text: string): string[] {
  return [...new Set(text.split(/[,，]/u).map(keyword => keyword.trim()).filter(keyword => keyword !== ''))]
}

/**
 * One line of an entry's content for a list row.
 * @param text - content.
 * @param max - inclusive character cap.
 * @returns the first line, cut with an ellipsis when longer.
 */
export function oneLine(text: string, max = 160): string {
  const line = text.replace(/\s+/gu, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/**
 * A short local date-time for an ISO stamp; empty for an unreadable one.
 * @param iso - ISO time.
 * @returns the text.
 */
export function formatTime(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The latest recalled-memory list a session's Chat window holds. */
export interface UsedMemory {
  seq: number
  query: string
  entries: MemoryRecallSource['entries']
  omitted: number
  update: boolean
}

/** The slice of a materialized Chat node the reader needs. */
export interface ChatNodeLike {
  readonly kind: string
  readonly data: unknown
}

/**
 * The newest recalled-memory record among the Chat window's injected context
 * rows: the ids and versions the model was actually shown, straight from the
 * durable `source` the session log keeps — no prose is re-parsed.
 * @param nodes - the Chat view's nodes, in order.
 * @returns the record, or undefined when the session never recalled memory.
 */
export function usedMemoryOf(nodes: Iterable<ChatNodeLike>): UsedMemory | undefined {
  let latest: UsedMemory | undefined
  for (const node of nodes) {
    if (node.kind !== 'context') continue
    const data = node.data as { seq?: unknown; source?: unknown } | null
    if (typeof data !== 'object' || data === null || typeof data.seq !== 'number') continue
    const record = readRecall(data.source)
    if (record === undefined) continue
    if (latest === undefined || data.seq > latest.seq) latest = { seq: data.seq, ...record }
  }
  return latest
}

function readRecall(source: unknown): Omit<UsedMemory, 'seq'> | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const { kind, form, query, entries, omitted, update } = source as Record<string, unknown>
  if (kind !== 'deepseekgui-memory' || form !== 'recall' || typeof query !== 'string' || !Array.isArray(entries)) return undefined
  const read: Array<{ id: string; version: number; scope: 'global' | 'project'; kind: MemoryKind }> = []
  for (const entry of entries as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const { id, version, scope, kind: entryKind } = entry as Record<string, unknown>
    if (typeof id !== 'string' || typeof version !== 'number') return undefined
    if (scope !== 'global' && scope !== 'project') return undefined
    if (entryKind !== 'fact' && entryKind !== 'preference' && entryKind !== 'continuation') return undefined
    read.push({ id, version, scope, kind: entryKind })
  }
  return { query, entries: read, omitted: typeof omitted === 'number' ? omitted : 0, update: update === true }
}

/** Labels the export needs, supplied by the page's dictionary. */
export interface ExportLabels {
  title: string
  kind: (kind: MemoryKind) => string
  scope: (scope: 'global' | 'project') => string
}

/**
 * Entries as a Markdown document: one section per kind, one list item per
 * entry with its id, version and scope, keywords when any. A person's copy of
 * the store — never written over the legacy file by this code.
 * @param entries - live entries, in list order.
 * @param labels - localized headings.
 * @returns the document text.
 */
export function exportMarkdown(entries: readonly MemoryEntry[], labels: ExportLabels): string {
  const lines = [`# ${labels.title}`, '']
  for (const kind of KINDS) {
    const group = entries.filter(entry => entry.kind === kind)
    if (group.length === 0) continue
    lines.push(`## ${labels.kind(kind)}`, '')
    for (const entry of group) {
      const keywords = entry.keywords === undefined || entry.keywords.length === 0 ? '' : ` — ${entry.keywords.join(', ')}`
      const body = entry.content.split('\n')
      lines.push(`- ${body[0] ?? ''} (#${entry.id} v${String(entry.version)}, ${labels.scope(entry.scope.kind)})${keywords}`)
      for (const extra of body.slice(1)) lines.push(`  ${extra}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
