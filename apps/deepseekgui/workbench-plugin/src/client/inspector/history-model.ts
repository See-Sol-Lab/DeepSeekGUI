/** Conversation-only commit/push/PR history with provenance (the Git view's session section); current Git reads live in views/. */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  firstLine,
  toolCardModel,
} from '../cards/tool-models.ts'

/** One tool call the window already renders, flattened for aggregation. */
export interface HistoryToolEntry {
  readonly toolName: string
  readonly callId: string
  /** Clock time of the call (result time when settled). */
  readonly time: number
  /** Session sequence anchoring the row (the call's seq). */
  readonly seq: number
  readonly state: 'running' | 'ok' | 'error' | 'stopped'
  /** Settled full output text; null while running. */
  readonly text: string | null
  /** Raw argument JSON; null when the call carried none. */
  readonly argsRaw: string | null
  /** The tool's own presentation projection; null when the tool ships none. */
  readonly meta?: unknown
}

/** One row of the Git·Review inspector. */
export interface ReviewHistoryRow {
  readonly seq: number
  readonly time: number
  readonly toolName: string
  /** Collapsed conclusion (first line of the outcome text). */
  readonly summary: string
  readonly error: boolean
}

/** Tools whose results are commit/push/PR outcomes. */
const REVIEW_TOOLS: ReadonlySet<string> = new Set([
  'git_commit', 'git_push_preview', 'git_push',
  'pr_availability', 'pr_existing', 'pr_create',
])

/** Extract the tool-call root block from one materialized Chat node. */
function toolRootOf(node: { readonly kind: string; readonly data: unknown }): ToolCallBlock | null {
  if (node.kind !== 'tool-call') return null
  const data = node.data as { root?: ToolCallBlock } | null
  if (typeof data !== 'object' || data === null || data.root === undefined) return null
  return data.root
}

/**
 * Flatten the visible window's Chat nodes into tool history entries. A call
 * and every call nested under it count: in the official PTC mode the model
 * drives the git/PR tools from inside `run_code`, so the commit and push the
 * person is looking for are sub-calls of one root card, not roots of their
 * own (release review 2026-09-06: the Git view said "no commits yet" right
 * after a commit and a push).
 */
export function historyOf(
  nodes: readonly {
    readonly kind: string
    readonly data: unknown
    readonly visibility: string
    readonly anchorSeq: number
  }[],
): HistoryToolEntry[] {
  const entries: HistoryToolEntry[] = []
  const visit = (block: ToolCallBlock, anchorSeq: number, nested: boolean): void => {
    const model = toolCardModel(block)
    if (model.toolName !== '') {
      entries.push({
        toolName: model.toolName,
        callId: model.callId,
        time: model.time,
        // The root keeps the card's window position; a nested settled result
        // carries its own log position, which keeps sub-calls in real order.
        seq: nested && 'seq' in block && typeof block.seq === 'number' ? block.seq : anchorSeq,
        state: model.state,
        text: model.output,
        argsRaw: model.argsRaw,
        meta: model.meta,
      })
    }
    for (const child of block.subCalls) visit(child, anchorSeq, true)
  }
  for (const node of nodes) {
    if (node.visibility !== 'visible') continue
    const root = toolRootOf(node)
    if (root === null) continue
    visit(root, node.anchorSeq, false)
  }
  return entries
}

/** Git·Review inspector rows: commit/push/PR outcomes from the window. */
export function reviewHistory(entries: readonly HistoryToolEntry[]): ReviewHistoryRow[] {
  const rows: ReviewHistoryRow[] = []
  for (const entry of entries) {
    if (!REVIEW_TOOLS.has(entry.toolName) || entry.state === 'running') continue
    rows.push({
      seq: entry.seq,
      time: entry.time,
      toolName: entry.toolName,
      summary: entry.text === null || entry.text === ''
        ? entry.state === 'error'
          ? '(error)'
          : ''
        : firstLine(entry.text),
      error: entry.state === 'error',
    })
  }
  return rows.sort((left, right) => right.seq - left.seq)
}
