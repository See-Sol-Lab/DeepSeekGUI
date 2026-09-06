/**
 * Pure card models for DeepSeekGUI tool-result rows (B5-P5). Everything is
 * derived from the frozen running-or-settled call slice — no subscriptions,
 * no session reads, replay-stable like the official ui-tool row models. Git
 * rows read the tool's own `presentationMeta` projection and degrade to the
 * rendered first line when a call carries none.
 */
import type {
  ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'

/** Row lifecycle states (mirrors the official tool-row states). */
export type ToolCardState = 'running' | 'ok' | 'error' | 'stopped'

/** One content block shape the fold products carry. */
type ContentBlock = { type: string; text?: string; [key: string]: unknown }

/** Everything a row renderer needs, derived once from the call slice. */
export interface ToolCardModel {
  readonly state: ToolCardState
  readonly settled: boolean
  /** Wire tool name (dispatch-supplied). */
  readonly toolName: string
  /** Call identity (stable across running and settled forms). */
  readonly callId: string
  /** Original argument JSON; null when the call carried no arguments. */
  readonly argsRaw: string | null
  /** Parsed argument record; null when absent or not a JSON object. */
  readonly args: Record<string, unknown> | null
  /** Call start epoch ms (running form) or settled result time. */
  readonly time: number
  /** Collapsed one-line conclusion (state-aware). */
  readonly summary: string
  /** First line of the failure text; null unless the call failed. */
  readonly errorSummary: string | null
  /** Full flattened output text; null while running or empty. */
  readonly output: string | null
  /** The tool's own presentation projection (`presentationMeta`); null when absent. */
  readonly meta: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** First physical line of a text. */
export function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** True when the slice is a settled result node (official discriminant). */
export function isSettled(block: ToolCallBlock): block is ToolResultNode {
  return 'kind' in block
}

/** Parse the call-head argument JSON when it is an object. */
export function callArgs(block: ToolCallBlock): Record<string, unknown> | null {
  const argsRaw = (isSettled(block) ? block.call?.argsRaw : block.argsRaw) ?? ''
  if (argsRaw === '') return null
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function pickString(args: Record<string, unknown> | null, keys: readonly string[]): string | undefined {
  if (args === null) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Flatten settled result content blocks to display text (like ui-tool's resultText). */
export function contentText(node: ToolResultNode): string | null {
  const parts: string[] = []
  for (const item of node.content) {
    const block = item as ContentBlock
    parts.push(block.type === 'text' && typeof block.text === 'string'
      ? block.text
      : JSON.stringify(block, null, 2))
  }
  if (parts.length === 0 && node.error !== undefined) {
    parts.push(`${node.error.name}: ${node.error.code}`)
  }
  return parts.length === 0 ? null : parts.join('\n')
}

/** Derive the row state from the frozen slice. */
export function cardState(block: ToolCallBlock): ToolCardState {
  if (!isSettled(block)) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

/** Human error line for a settled failure; null for non-failures. */
export function failureLine(block: ToolCallBlock): string | null {
  if (!isSettled(block) || !block.isError) return null
  const output = contentText(block)
  if (output !== null) {
    const first = firstLine(output)
    if (first.trim() !== '') return first
  }
  if (block.error !== undefined) return `${block.error.name}: ${block.error.code}`
  return null
}

/** Base derivation shared by every row model. */
export function toolCardBase(block: ToolCallBlock): {
  state: ToolCardState
  settled: boolean
  toolName: string
  callId: string
  argsRaw: string | null
  args: Record<string, unknown> | null
  time: number
} {
  const settled = isSettled(block)
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  return {
    state: cardState(block),
    settled,
    toolName: settled ? (block.call?.name ?? '') : block.name,
    callId: block.callId,
    argsRaw: argsRaw === '' ? null : argsRaw,
    args: callArgs(block),
    time: block.time,
  }
}

/** One changed path as the status projection reports it. */
export interface StatusEntry {
  readonly state: 'staged' | 'unstaged' | 'untracked' | 'conflict'
  readonly path: string
  readonly origPath: string | null
}

/** Per-state counts carried by the status projection. */
export interface StatusCounts {
  readonly staged: number
  readonly unstaged: number
  readonly untracked: number
  readonly conflict: number
  readonly total: number
}

/** One git-family row presentation, read from the tool's presentation meta. */
export interface GitCardPresentation {
  readonly summary: string
  readonly entries: StatusEntry[]
  readonly diffFiles: { path: string; binary: boolean; added: number; deleted: number }[]
  readonly counts: StatusCounts | null
}

const NO_COUNTS: StatusCounts = { staged: 0, unstaged: 0, untracked: 0, conflict: 0, total: 0 }

/**
 * Read one git/pr row from the tool's `presentationMeta` projection.
 *
 * The tool owns the projection (git-tools.ts statusMeta/diffMeta): a replayable
 * JSON view of the same canonical value `render` turned into model-facing text.
 * A call whose meta is absent — an older log entry, or a tool without a
 * projection — degrades to the rendered first line.
 * @param toolName - wire tool name.
 * @param model - the derived row model.
 * @returns Card fields for the collapsed row and the Changes inspector.
 */
export function gitSummary(_toolName: string, model: ToolCardModel): GitCardPresentation {
  const blank = { summary: '', entries: [], diffFiles: [], counts: null }
  if (!model.settled) {
    return { ...blank, summary: runningLabel(model.args, model.argsRaw) || '…' }
  }
  const meta = isRecord(model.meta) ? model.meta : null
  if (meta === null) {
    return { ...blank, summary: model.errorSummary ?? firstLine(model.output ?? '') }
  }
  if (meta.kind === 'git-diff') {
    const files = Array.isArray(meta.files) ? meta.files.filter(isRecord) : []
    return {
      summary: `${files.length} file(s) changed`,
      entries: [],
      diffFiles: files.map(f => ({
        path: String(f.path ?? ''),
        binary: f.binary === true,
        added: Number(f.added ?? 0),
        deleted: Number(f.deleted ?? 0),
      })),
      counts: null,
    }
  }
  const rawCounts = isRecord(meta.counts) ? meta.counts : null
  const counts: StatusCounts = rawCounts === null ? NO_COUNTS : {
    staged: Number(rawCounts.staged ?? 0),
    unstaged: Number(rawCounts.unstaged ?? 0),
    untracked: Number(rawCounts.untracked ?? 0),
    conflict: Number(rawCounts.conflict ?? 0),
    total: Number(rawCounts.total ?? 0),
  }
  const entries = (Array.isArray(meta.entries) ? meta.entries.filter(isRecord) : []).map(e => ({
    state: (e.state === 'staged' || e.state === 'untracked' || e.state === 'conflict'
      ? e.state
      : 'unstaged') as StatusEntry['state'],
    path: String(e.path ?? ''),
    origPath: e.origPath === null || e.origPath === undefined ? null : String(e.origPath),
  }))
  const head = String(meta.head ?? '')
  return {
    summary: meta.clean === true ? `clean ${head}` : `${counts.total} changed path(s), ${head}`,
    entries,
    diffFiles: [],
    counts,
  }
}

/** Argument-derived labels for the collapsed running/error row. */
export function runningLabel(args: Record<string, unknown> | null, argsRaw: string | null): string {
  const picked = pickString(args, ['path', 'remote', 'head', 'url', 'selector', 'query', 'file_path'])
  if (picked !== undefined) return firstLine(picked)
  return argsRaw === null || argsRaw === '' ? '' : firstLine(argsRaw)
}

/** Assemble the full row model with generic collapsed copy (family rows refine it). */
export function toolCardModel(block: ToolCallBlock): ToolCardModel {
  const base = toolCardBase(block)
  const output = isSettled(block) ? contentText(block) : null
  const errorSummary = base.state === 'error' ? failureLine(block) : null
  const summary = errorSummary !== null
    ? errorSummary
    : base.state === 'running'
      ? runningLabel(base.args, base.argsRaw)
      : firstLine(output ?? '')
  const meta = isSettled(block) ? (block as { meta?: unknown }).meta ?? null : null
  return { ...base, summary, errorSummary, output, meta }
}

/** True when the outcome is worth opening a human-input form on. */
export function familyOf(toolName: string): 'git-status' | 'git-diff' | 'git-commit' | 'git-push-preview'
  | 'git-push' | 'pr' | 'browser' | 'other' {
  if (toolName === 'git_status' || toolName === 'git_stage' || toolName === 'git_unstage'
    || toolName === 'git_revert') return 'git-status'
  if (toolName === 'git_diff') return 'git-diff'
  if (toolName === 'git_commit') return 'git-commit'
  if (toolName === 'git_push_preview') return 'git-push-preview'
  if (toolName === 'git_push') return 'git-push'
  if (toolName.startsWith('pr_')) return 'pr'
  if (toolName.startsWith('browser_')) return 'browser'
  return 'other'
}
