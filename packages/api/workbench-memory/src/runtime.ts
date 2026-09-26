/**
 * The Harness-facing half (B7-P7/P8): four model tools over the entry store,
 * the per-step recall injection, the entries-mode memory guide, and the
 * session-deletion hook. Everything here rides existing seams —
 * `ctx.tools.register`, the `agent/pre-step` waterfall,
 * `systemPrompt.context`, `session/content-deleting` — and none of it runs a
 * second model or a background watcher: the assistant of the current session
 * records with the same tools a person would, and every write succeeds or
 * fails in the tool result the model and the user both see.
 *
 * Cross-window rule: one Harness process serves every window, the store's
 * in-memory state is the persisted state, and a step reads it once at its
 * start. So a write in window A is what window B's next user step recalls,
 * a request already sent keeps the list it was sent with, and a write
 * quoting a version B no longer holds is refused, never merged.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionSeq, type UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { checkContinuation, renderContinuation } from './continuation.ts'
import { readRecallSource, recallDigest, renderEntryLine, renderRecallMessage, type RecallLimits, type RecallOptions, type RecallResult } from './recall.ts'
import type {
  ContinuationNote,
  MemoryEntry,
  MemoryInjectionMode,
  MemoryKind,
  MemoryProjectScope,
  MemoryScope,
  MemoryScopeFilter,
  MemoryWriteResult,
} from './types.ts'

/** A recall request whose bounds fall back to the configured ones. */
export type RecallRequest = Omit<RecallOptions, keyof RecallLimits> & Partial<RecallLimits>

/** What the runtime needs from the service. */
export interface MemoryRuntimeHost {
  /** Resolves once the domain is open. */
  readonly ready: Promise<void>
  injectionMode(): MemoryInjectionMode
  /** The project scope of a session cwd; null without a usable folder. */
  sessionScope(cwd: string | undefined): Promise<MemoryProjectScope | null>
  recall(options: RecallRequest): RecallResult
  /** Read a live entry for the calling tool's scope check. */
  get(id: string, signal: AbortSignal): Promise<MemoryEntry | null>
  /** Mark the entries whose origin session's content is being deleted. */
  sessionDeleted(sessionId: string): Promise<void>
  remember(input: {
    scope: MemoryScope
    kind: MemoryKind
    content: string
    keywords?: string[]
    source: { kind: 'assistant'; sessionId?: string; evidence?: string }
  }, signal: AbortSignal): Promise<MemoryWriteResult>
  correct(input: {
    id: string
    expectedVersion: number
    content?: string
    keywords?: string[]
    kind?: MemoryKind
    source: { kind: 'assistant'; sessionId?: string; evidence?: string }
  }, signal: AbortSignal): Promise<MemoryWriteResult>
  forget(input: { id: string; expectedVersion: number; source: { kind: 'assistant'; sessionId?: string; evidence?: string } }, signal: AbortSignal): Promise<MemoryWriteResult>
}

/** Context section name of the entries-mode guide. */
export const MEMORY_GUIDE_SECTION = 'deepseekgui:memory-guide'

/** Sort position: after every contributed guidance section, where the legacy memory section sits. */
const MEMORY_GUIDE_ORDER = 1_000_000

const KINDS: readonly MemoryKind[] = ['fact', 'preference', 'continuation']

/**
 * The entries-mode guide: what to record where, what never to record, how to
 * correct and forget, and that memory is not rules and grants nothing.
 * Shipped as `assets/memory-guide.md` beside the package; a missing asset is a
 * broken package, so the read throws rather than injecting a silent blank.
 * @returns the guide, trimmed of the trailing newline.
 */
export function memoryGuide(): string {
  return readFileSync(fileURLToPath(new URL('../assets/memory-guide.md', import.meta.url)), 'utf8').trimEnd()
}

/**
 * Register the guide as a system-prompt context that reads the injection
 * mode at every assembly: text in entries mode, nothing in markdown mode.
 * @param ctx - context carrying `systemPrompt`.
 * @param memory - the service.
 */
export function registerMemoryGuide(ctx: Context, memory: MemoryRuntimeHost): void {
  const guide = memoryGuide()
  ctx.effect(
    () => ctx.systemPrompt.context({ name: MEMORY_GUIDE_SECTION, order: MEMORY_GUIDE_ORDER, text: () => memory.injectionMode() === 'entries' ? guide : '' }),
    'workbench-memory: guide context',
  )
}

/** Text blocks of the step's own user messages, or undefined when the step carries none. */
function userText(messages: readonly UserMessage[]): string | undefined {
  const texts: string[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    for (const block of message.content) if (block.type === 'text') texts.push(block.text)
  }
  return texts.length === 0 ? undefined : texts.join('\n')
}

/** The last recall list this session published and whether it is still on the model-visible surface. */
function recallHistory(agent: Agent): { visibleDigest?: string; published: boolean } {
  const visible = new Set<number>(agent.session.surface.nodes)
  let published = false
  for (let index = agent.session.seq - 1; index >= 0; index -= 1) {
    // Written before 0.1.7 deprecated synchronous history reads; moving this to
    // a session projection is tracked as follow-up work.
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = agent.session.eventAt(SessionSeq(index))
    if (event === undefined || event.type !== 'user/message' || event.data.source.kind !== 'deepseekgui-memory') continue
    const entries = readRecallSource(event.data.source)
    if (entries === undefined) continue
    published = true
    if (visible.has(event.seq)) return { visibleDigest: recallDigest(entries), published }
  }
  return { published }
}

/**
 * Register the per-step recall: on every step that carries a user message,
 * in entries mode, recall against the session's project and the global
 * entries and inject the list when the visible one differs — the first time
 * as a list, afterwards as a replacement; an empty result after a published
 * list is a replacement too, so stale entries never stay in force.
 * @param ctx - context whose `on` receives every agent's `agent/pre-step`.
 * @param memory - the service.
 */
export function registerMemoryRecall(ctx: Context, memory: MemoryRuntimeHost): void {
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (memory.injectionMode() !== 'entries') return decision
    const query = userText(messages)
    if (query === undefined) return decision
    signal.throwIfAborted()
    await memory.ready
    const scope = await memory.sessionScope(agent.session.header.cwd)
    signal.throwIfAborted()
    const filter: MemoryScopeFilter = scope === null ? { kind: 'global' } : { kind: 'session', projectKey: scope.projectKey }
    const result = memory.recall({ scope: filter, query, ambient: true })
    const history = recallHistory(agent)
    if (history.visibleDigest === recallDigest(result.entries)) return decision
    if (!history.published && result.entries.length === 0) return decision
    return { ...decision, messages: [...decision.messages, renderRecallMessage(result, { update: history.published, query })] }
  })
}

/** JSON face of a tool result. */
function json(value: unknown): Record<string, JsonValue> {
  return value as Record<string, JsonValue>
}

function text(value: string): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text: value }]
}

/** Scope label the tools accept. */
type ScopeArg = 'project' | 'global'

async function scopeOf(memory: MemoryRuntimeHost, scope: ScopeArg, exec: ToolRunContext, tool: string): Promise<MemoryScope> {
  if (scope === 'global') return { kind: 'global' }
  const resolved = await memory.sessionScope(exec.agent?.session.header.cwd)
  if (resolved === null) throw new Error(`${tool} refused: this session has no project folder; use scope "global" or open a workspace`)
  return resolved
}

function assistantSource(exec: ToolRunContext, evidence: string | undefined): { kind: 'assistant'; sessionId?: string; evidence?: string } {
  return {
    kind: 'assistant',
    ...exec.agent === undefined ? {} : { sessionId: exec.agent.id },
    ...evidence === undefined || evidence.trim() === '' ? {} : { evidence: evidence.trim() },
  }
}

/** Throw the write's error so it reaches the model as a tool failure; return the entry otherwise. */
function settled(tool: string, result: MemoryWriteResult): MemoryEntry {
  if (result.ok) return result.entry
  throw new Error(`${tool} failed (${result.error.code}): ${result.error.message}`)
}

/** Enhanced memory switched off: every tool refuses, in the result the model reads. */
function assertOn(memory: MemoryRuntimeHost, tool: string): void {
  if (memory.injectionMode() === 'off') throw new Error(`${tool} refused: enhanced memory is switched off; the user can turn it on from the Memory page`)
  if (memory.injectionMode() !== 'entries') throw new Error(`${tool} refused: entry memory is not enabled; this session uses the legacy memory files`)
}

/** Project entries can be mutated only by sessions rooted in that project. */
async function assertReachable(memory: MemoryRuntimeHost, id: string, exec: ToolRunContext, tool: string): Promise<void> {
  const entry = await memory.get(id, exec.signal)
  // Missing and forgotten records keep the store's own diagnostic.
  if (entry === null || entry.scope.kind === 'global') return
  const project = await memory.sessionScope(exec.agent?.session.header.cwd)
  if (project?.projectKey !== entry.scope.projectKey) {
    throw new Error(`${tool} refused: entry ${id} is outside this session's project`)
  }
}

/**
 * The content of a continuation note from the tool's structured argument;
 * a refused note is a tool failure, not a silently trimmed one.
 * @param tool - tool name for the message.
 * @param note - the structured argument.
 * @returns the stored layout.
 */
function continuationContent(tool: string, note: ContinuationNote): string {
  const checked = checkContinuation(note)
  if (!checked.ok) throw new Error(`${tool} failed (MEMORY_INVALID): ${checked.message}`)
  return renderContinuation(checked.note)
}

/**
 * The content a remember stores: free text for a fact or a preference, the
 * structured note for a continuation — each kind takes exactly its own form.
 * @param tool - tool name for the message.
 * @param kind - the entry kind.
 * @param content - the free-text argument.
 * @param continuation - the structured argument.
 * @returns the content to store.
 */
function contentOf(tool: string, kind: MemoryKind, content: string | undefined, continuation: ContinuationNote | undefined): string {
  if (kind === 'continuation') {
    if (continuation === undefined) {
      throw new Error(`${tool} failed (MEMORY_INVALID): a continuation note is structured; pass continuation { goal, decisions, unfinished, leads, verified }`)
    }
    return continuationContent(tool, continuation)
  }
  if (continuation !== undefined) throw new Error(`${tool} failed (MEMORY_INVALID): only kind "continuation" takes a continuation note`)
  if (content === undefined || content.trim() === '') throw new Error(`${tool} failed (MEMORY_INVALID): a ${kind} needs content`)
  return content
}

/** The `continuation` parameter shared by remember and correct. */
const CONTINUATION_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  description: 'A continuation note in five parts; required for kind "continuation" (then leave `content` out)',
  properties: {
    goal: { type: 'string', required: true, description: 'What the task is for, one line' },
    decisions: { type: 'array', items: { type: 'string' }, required: true, description: 'Decisions the user confirmed' },
    unfinished: { type: 'array', items: { type: 'string' }, required: true, description: 'Still open; planned or failed work goes here, never under verified' },
    leads: { type: 'array', items: { type: 'string' }, required: true, description: 'File paths, commands, places to look first' },
    verified: { type: 'array', items: { type: 'string' }, required: true, description: 'What was actually run or checked, with its result and when' },
  },
} as const

function whereOf(entry: MemoryEntry): string {
  return entry.scope.kind === 'global' ? 'global' : 'project'
}

/**
 * Register `memory_remember`, `memory_correct`, `memory_forget` and
 * `memory_recall` on the host tool registry, so every agent composition sees
 * them. No approval gate: writes land directly and stay visible, editable
 * and reversible on the Memory page.
 * @param ctx - context carrying `tools`.
 * @param memory - the service.
 */
export function registerMemoryTools(ctx: Context, memory: MemoryRuntimeHost): void {
  let disposed = false
  let release: (() => void) | undefined
  const sync = (): void => {
    if (disposed) return
    if (memory.injectionMode() === 'entries') release ??= installMemoryTools(ctx, memory)
    else { release?.(); release = undefined }
  }
  ctx.on('workbench-memory/change', (change) => { if (change.action === 'injection') sync() })
  ctx.effect(() => () => { disposed = true; release?.() }, 'workbench-memory: mode tools')
  void memory.ready.then(sync)
}

/** Keep the registrations removable together when the entry mode ends. */
function installMemoryTools(ctx: Context, memory: MemoryRuntimeHost): () => void {
  const disposers: Array<() => void> = []
  const register = (definition: Parameters<typeof ctx.tools.register>[0]): void => {
    disposers.push(ctx.tools.register(definition))
  }
  register(defineTool({
    name: 'memory_remember',
    description: 'Record one memory entry: a global preference the user stated, a fact about this project the user confirmed or you verified, '
      + 'or a continuation note (structured, see `continuation`) when the user asks to save progress. Gives back the entry id and version once it '
      + 'is durable; a failure is reported here, never assume it landed.',
    parameters: {
      scope: { type: 'string', enum: ['project', 'global'], required: true, description: '`project` = this session\'s folder; `global` = every project' },
      kind: { type: 'string', enum: [...KINDS], required: true, description: 'preference (global habits), fact (project truth), continuation (task hand-over)' },
      content: { type: 'string', description: 'One entry, short and factual; for kind "continuation" pass `continuation` instead' },
      continuation: CONTINUATION_PARAMETER,
      keywords: { type: 'array', items: { type: 'string' }, description: 'Optional lookup keywords (for a continuation note: the task\'s name and its files)' },
      evidence: { type: 'string', description: 'What the entry rests on: a file path, a command output, the user\'s words' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const entry = value as unknown as MemoryEntry
        return text(`remembered ${renderEntryLine(entry).slice(2)}`)
      },
    },
    presentCall(args: { scope: string; kind: string }) {
      return { card: 'generic', title: `memory_remember ${args.scope} ${args.kind}` }
    },
    async execute(
      args: {
        scope: ScopeArg
        kind: MemoryKind
        content?: string
        continuation?: ContinuationNote
        keywords?: string[]
        evidence?: string
      },
      exec: ToolRunContext,
    ) {
      assertOn(memory, 'memory_remember')
      const content = contentOf('memory_remember', args.kind, args.content, args.continuation)
      const scope = await scopeOf(memory, args.scope, exec, 'memory_remember')
      const entry = settled('memory_remember', await memory.remember({
        scope,
        kind: args.kind,
        content,
        ...args.keywords === undefined ? {} : { keywords: args.keywords },
        source: assistantSource(exec, args.evidence),
      }, exec.signal))
      return json(entry)
    },
  }))

  register(defineTool({
    name: 'memory_correct',
    description: 'Replace the content (or keywords or kind) of one memory entry by id. Quote the version you saw (`vN` in the recalled list or '
      + 'in a tool result); a stale version is refused with the current one — recall and retry, never guess. The original source is kept and '
      + 'your correction is recorded beside it. A continuation note is rewritten whole through `continuation`.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id, `m_…`' },
      expectedVersion: { type: 'number', required: true, description: 'The version you saw' },
      content: { type: 'string', description: 'New content' },
      continuation: CONTINUATION_PARAMETER,
      keywords: { type: 'array', items: { type: 'string' }, description: 'New keywords' },
      kind: { type: 'string', enum: [...KINDS], description: 'New kind' },
      evidence: { type: 'string', description: 'What the correction rests on' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const entry = value as unknown as MemoryEntry
        return text(`corrected ${renderEntryLine(entry).slice(2)}`)
      },
    },
    presentCall(args: { id: string }) {
      return { card: 'generic', title: `memory_correct ${args.id}` }
    },
    async execute(
      args: {
        id: string
        expectedVersion: number
        content?: string
        continuation?: ContinuationNote
        keywords?: string[]
        kind?: MemoryKind
        evidence?: string
      },
      exec: ToolRunContext,
    ) {
      assertOn(memory, 'memory_correct')
      await assertReachable(memory, args.id, exec, 'memory_correct')
      if (args.continuation !== undefined && args.kind !== undefined && args.kind !== 'continuation') {
        throw new Error('memory_correct failed (MEMORY_INVALID): a continuation note has kind "continuation"')
      }
      const content = args.continuation === undefined ? args.content : continuationContent('memory_correct', args.continuation)
      const kind = args.continuation === undefined ? args.kind : 'continuation'
      const entry = settled('memory_correct', await memory.correct({
        id: args.id,
        expectedVersion: args.expectedVersion,
        ...content === undefined ? {} : { content },
        ...args.keywords === undefined ? {} : { keywords: args.keywords },
        ...kind === undefined ? {} : { kind },
        source: assistantSource(exec, args.evidence),
      }, exec.signal))
      return json(entry)
    },
  }))

  register(defineTool({
    name: 'memory_forget',
    description: 'Forget one memory entry by id: it leaves every future recall and search. Quote the version you saw; a stale version is refused. '
      + 'The user can restore it from the Memory page; nothing restores it automatically.',
    parameters: {
      id: { type: 'string', required: true, description: 'Entry id, `m_…`' },
      expectedVersion: { type: 'number', required: true, description: 'The version you saw' },
      evidence: { type: 'string', description: 'Why it no longer holds' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const entry = value as unknown as MemoryEntry
        return text(`forgot #${entry.id} (was v${String(entry.version)} [${whereOf(entry)} ${entry.kind}]: ${entry.content.replace(/\s+/gu, ' ').trim()})`)
      },
    },
    presentCall(args: { id: string }) {
      return { card: 'generic', title: `memory_forget ${args.id}` }
    },
    async execute(args: { id: string; expectedVersion: number; evidence?: string }, exec: ToolRunContext) {
      assertOn(memory, 'memory_forget')
      await assertReachable(memory, args.id, exec, 'memory_forget')
      const entry = settled('memory_forget', await memory.forget({
        id: args.id,
        expectedVersion: args.expectedVersion,
        source: assistantSource(exec, args.evidence),
      }, exec.signal))
      return json(entry)
    },
  }))

  register(defineTool({
    name: 'memory_recall',
    description: 'Search memory entries by text within this session\'s reach (this project plus global by default). The same path as the '
      + 'automatic recall: scope is filtered first, then entries whose content or keywords contain a query term are ranked. '
      + 'A miss says which terms and scope were searched. Without a query, lists the scope (newest first within each kind).',
    parameters: {
      query: { type: 'string', description: 'Free text; leave empty to list the scope' },
      scope: { type: 'string', enum: ['session', 'project', 'global'], description: '`session` (default) = this project plus global' },
      kinds: { type: 'array', items: { type: 'string', enum: [...KINDS] }, description: 'Restrict to these kinds' },
      limit: { type: 'number', description: 'Maximum entries (default 20)' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const result = value as unknown as { entries: MemoryEntry[]; omitted: number; terms: string[]; considered: number; scope: string }
        if (result.entries.length === 0) {
          return text(`no memory entries matched terms [${result.terms.join(', ')}] in scope ${result.scope} (${String(result.considered)} entries considered)`)
        }
        const lines = result.entries.map(renderEntryLine)
        if (result.omitted > 0) lines.push(`(${String(result.omitted)} more matching entries left out; narrow the query)`)
        return text(lines.join('\n'))
      },
    },
    presentCall(args: { query?: string }) {
      return { card: 'generic', title: `memory_recall ${args.query ?? ''}`.trim() }
    },
    async execute(args: { query?: string; scope?: 'session' | 'project' | 'global'; kinds?: MemoryKind[]; limit?: number }, exec: ToolRunContext) {
      assertOn(memory, 'memory_recall')
      const requested = args.scope ?? 'session'
      let filter: MemoryScopeFilter
      let label: string
      if (requested === 'global') {
        filter = { kind: 'global' }
        label = 'global'
      } else {
        const project = await memory.sessionScope(exec.agent?.session.header.cwd)
        if (project === null) {
          if (requested === 'project') throw new Error('memory_recall refused: this session has no project folder')
          filter = { kind: 'global' }
          label = 'global (no project folder)'
        } else {
          filter = requested === 'project' ? { kind: 'project', projectKey: project.projectKey } : { kind: 'session', projectKey: project.projectKey }
          label = requested === 'project' ? `project ${project.path}` : `project ${project.path} + global`
        }
      }
      const limit = args.limit === undefined ? 20 : Math.max(1, Math.floor(args.limit))
      const result = memory.recall({
        scope: filter,
        query: args.query ?? '',
        ...args.kinds === undefined ? {} : { kinds: args.kinds },
        limit,
        budgetBytes: 64 * 1024,
      })
      return json({ ...result, scope: label })
    },
  }))
  return () => { for (const dispose of disposers) dispose() }
}

/**
 * Register the session-deletion hook: when a session's content is being
 * deleted, the entries it wrote are marked `sessionDeleted` — they stay (a
 * saved memory is independent of its source) and say so, and nothing
 * re-reads or copies the deleted session. Runs inside the deletion's serial
 * listener chain, so the mark is durable before the cleanup completes.
 * @param ctx - context whose `on` receives `session/content-deleting`.
 * @param memory - the service.
 */
export function registerMemoryDeletion(ctx: Context, memory: MemoryRuntimeHost): void {
  ctx.on('session/content-deleting', async (sessionId) => {
    await memory.sessionDeleted(sessionId)
  })
}
