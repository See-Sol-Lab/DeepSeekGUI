/**
 * DeepSeekGUI's engineering memory, exposed to the desktop client as the
 * `workbenchMemory` Remote namespace: versioned entries per project folder
 * or global, corrected without losing their origin, forgotten without
 * reviving through any read, undone one level, restored only on request,
 * and the reviewed import of the legacy Markdown memory files. Where a
 * composition carries the tool registry and the system prompt, the same
 * service also registers the four `memory_*` tools, the per-step recall
 * injection, and the entries-mode guide — all gated by the injection mode
 * in the global slot, which still says `markdown` until the migration
 * phase switches it — and marks the entries a deleted session wrote.
 * @module @deepseek-ai/dsh-workbench-memory
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveProject } from '@deepseek-ai/dsh-skill-manager'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { projectMemoryFileName } from '@deepseek-ai/dsh-workbench-inspector/types'
import { join } from 'node:path'
import { applyImport, previewImport, type ImportEnvironment } from './import.ts'
import { recallEntries, type RecallLimits, type RecallResult } from './recall.ts'
import { registerMemoryDeletion, registerMemoryGuide, registerMemoryRecall, registerMemoryTools, type RecallRequest } from './runtime.ts'
import { memoryDomainSpec, type EntriesTable, type ForgottenTable, type MemoryGlobal } from './spec.ts'
import {
  correct,
  forget,
  getEntry,
  listEntries,
  listForgotten,
  markSessionDeleted,
  realClock,
  remember,
  restore,
  undo,
  type StoreClock,
  type StoreLimits,
} from './store.ts'
import type {
  MemoryActionInput,
  MemoryChangeEvent,
  MemoryCorrectInput,
  MemoryEntry,
  MemoryForgottenEntry,
  MemoryImportOutcome,
  MemoryImportPreview,
  MemoryImportRequest,
  MemoryImportSource,
  MemoryInjectionMode,
  MemoryList,
  MemoryProjectScope,
  MemoryQuery,
  MemoryRememberInput,
  MemoryRestoreInput,
  MemoryScope,
  MemoryScopeFilter,
  MemoryStatus,
  MemoryWriteResult,
} from './types.ts'

export type * from './types.ts'
export { memoryDomainSpec } from './spec.ts'
export { segmentMarkdown } from './import.ts'
export { contentHash, normalizeContent, sameScope, scopeMatches } from './store.ts'
export { CONTINUATION_LIMITS, checkContinuation, parseContinuation, renderContinuation, type ContinuationCheck } from './continuation.ts'
export {
  readRecallSource,
  recallDigest,
  recallEntries,
  renderEntryLine,
  renderRecallMessage,
  scoreEntry,
  termsOf,
  type RecallLimits,
  type RecallOptions,
  type RecallResult,
} from './recall.ts'
export {
  MEMORY_GUIDE_SECTION,
  memoryGuide,
  registerMemoryDeletion,
  registerMemoryGuide,
  registerMemoryRecall,
  registerMemoryTools,
  type MemoryRuntimeHost,
  type RecallRequest,
} from './runtime.ts'

/** Deployment bounds and the optional home override. */
export interface Config {
  /** Explicit DSH home; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Inclusive UTF-8 byte cap on one entry's content. */
  contentMaxBytes: number
  /** Inclusive cap on the number of keywords of one entry. */
  maxKeywords: number
  /** Inclusive byte cap on a legacy Markdown file offered for import. */
  importMaxBytes: number
  /** Inclusive cap on the entries one automatic recall injects. */
  recallLimit: number
  /** Inclusive byte cap on the entry lines one automatic recall injects. */
  recallBudgetBytes: number
}

/** The closed injection-mode union, for validating the wire value. */
const INJECTION_MODES: ReadonlySet<string> = new Set<MemoryInjectionMode>(['markdown', 'entries', 'off'])

/** Default bounds; the Config schema applies them, callers that construct a Config in TS spread them. */
export const WORKBENCH_MEMORY_LIMITS = {
  contentMaxBytes: 16 * 1024,
  maxKeywords: 32,
  importMaxBytes: 1024 * 1024,
  recallLimit: 12,
  recallBudgetBytes: 4096,
} as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** DeepSeekGUI's engineering memory entries. */
    workbenchMemory: WorkbenchMemory
  }
}

/** Entry reads and versioned writes, plus the reviewed legacy import. */
export class WorkbenchMemory extends TypertRemoteService {
  static inject = ['typert', 'storageDomain']
  static Config: Schema<Config> = Schema.object({
    dshHome: Schema.string(),
    contentMaxBytes: Schema.natural().min(1).default(WORKBENCH_MEMORY_LIMITS.contentMaxBytes),
    maxKeywords: Schema.natural().min(1).default(WORKBENCH_MEMORY_LIMITS.maxKeywords),
    importMaxBytes: Schema.natural().min(1).default(WORKBENCH_MEMORY_LIMITS.importMaxBytes),
    recallLimit: Schema.natural().min(1).default(WORKBENCH_MEMORY_LIMITS.recallLimit),
    recallBudgetBytes: Schema.natural().min(1).default(WORKBENCH_MEMORY_LIMITS.recallBudgetBytes),
  })

  /** Time and ids; tests replace it. */
  clock: StoreClock = realClock
  private readonly limits: StoreLimits
  private readonly importMaxBytes: number
  /** Bounds of one automatic recall. */
  readonly recallLimits: RecallLimits
  private readonly dshHome: string | undefined
  private entries!: EntriesTable
  private forgotten!: ForgottenTable
  private global!: { get: () => MemoryGlobal; set: (value: MemoryGlobal) => Promise<void> }
  /** Resolves when the domain is open; every Remote method and the runtime wait on it. */
  readonly ready: Promise<void>
  private markReady!: () => void
  /** Serializes writes: a version check and its write never interleave with another write. */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - Composed host providers.
   * @param config - Validated bounds.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'workbenchMemory', { namespace: 'workbenchMemory' })
    this.limits = { contentMaxBytes: config.contentMaxBytes, maxKeywords: config.maxKeywords }
    this.importMaxBytes = config.importMaxBytes
    this.recallLimits = { limit: config.recallLimit, budgetBytes: config.recallBudgetBytes }
    this.dshHome = config.dshHome
    this.ready = new Promise((resolve) => { this.markReady = resolve })
    // The Harness-facing half needs the tool registry and the system prompt;
    // a composition without them (the data-only tests) gets the store alone.
    ctx.inject(['tools', 'systemPrompt'], (scoped) => {
      registerMemoryTools(scoped, this)
      registerMemoryGuide(scoped, this)
      registerMemoryRecall(scoped, this)
    })
    registerMemoryDeletion(ctx, this)
  }

  /** Open the domain. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(memoryDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workbench-memory: domain')
    this.entries = domain.table('entries')
    this.forgotten = domain.table('forgotten')
    this.global = domain.global
    this.projectsOpen = true
    this.markReady()
  }

  /** Whether the domain is open (the tables and the global slot are set). */
  private projectsOpen = false

  /** Absolute path of the legacy global memory file for the current environment. */
  get globalFile(): string {
    return join(resolveDshHome(this.dshHome), 'memory.md')
  }

  /**
   * Which memory path sessions use right now; `markdown` before the domain is open.
   * @returns the mode from the global slot.
   */
  injectionMode(): MemoryInjectionMode {
    return this.projectsOpen ? this.global.get().injection : 'markdown'
  }

  /**
   * The project scope of a session working directory.
   * @param cwd - session cwd.
   * @returns the scope, or null without a usable folder.
   */
  async sessionScope(cwd: string | undefined): Promise<MemoryProjectScope | null> {
    if (cwd === undefined) return null
    const resolution = await resolveProject(cwd)
    return resolution.project === null ? null : { kind: 'project', projectKey: resolution.project.key, path: resolution.project.path }
  }

  /**
   * The one retrieval path: scope, terms, ranking, duplicates, budget.
   * @param options - scope selector, query text, optional kinds and bounds (default: the configured recall bounds).
   * @returns the ranked entries and the explanation of what was searched.
   */
  recall(options: RecallRequest): RecallResult {
    return recallEntries(this.entries, {
      scope: options.scope,
      query: options.query,
      ...options.kinds === undefined ? {} : { kinds: options.kinds },
      ...options.ambient === undefined ? {} : { ambient: options.ambient },
      limit: options.limit ?? this.recallLimits.limit,
      budgetBytes: options.budgetBytes ?? this.recallLimits.budgetBytes,
    })
  }

  /**
   * Store facts: injection mode, counts, the legacy global file.
   * @param signal - Cancellation.
   * @returns the status.
   */
  @Remote
  async status(signal: AbortSignal): Promise<MemoryStatus> {
    signal.throwIfAborted()
    await this.ready
    let active = 0
    for (const [, record] of this.entries.entries()) if (record.state === 'active') active += 1
    return { injection: this.global.get().injection, active, forgotten: this.forgotten.size, globalFile: this.globalFile }
  }

  /**
   * Switch which memory path sessions use: `markdown` keeps the legacy
   * files live and the entries out of every session; `entries` turns on the
   * tools, the guide and the per-step recall for the next step of every
   * open session; `off` switches enhanced memory off — nothing is injected
   * and the tools refuse — without falling back to the files.
   * @param mode - `markdown` (legacy files), `entries`, or `off`.
   * @param signal - Cancellation.
   * @returns the status after the switch.
   */
  @Remote
  async setInjection(mode: MemoryInjectionMode, signal: AbortSignal): Promise<MemoryStatus> {
    signal.throwIfAborted()
    await this.ready
    // The wire admits any string; the closed union is enforced here, before the write.
    if (!INJECTION_MODES.has(mode)) throw new Error(`unknown injection mode "${mode}"`)
    await this.serialized(async () => {
      if (this.global.get().injection === mode) return
      await this.global.set({ injection: mode })
      this.changed({ action: 'injection', ids: [] })
    })
    return await this.status(signal)
  }

  /**
   * Resolve a working directory to its project scope.
   * @param cwd - Session working directory.
   * @param signal - Cancellation.
   * @returns the scope, or null when the folder does not exist.
   */
  @Remote
  async projectScope(cwd: string, signal: AbortSignal): Promise<MemoryScope | null> {
    signal.throwIfAborted()
    return await this.sessionScope(cwd)
  }

  /**
   * Read live entries.
   * @param query - Scope, kinds, origin session, text and limit.
   * @param signal - Cancellation.
   * @returns the page.
   */
  @Remote
  async list(query: MemoryQuery, signal: AbortSignal): Promise<MemoryList> {
    signal.throwIfAborted()
    await this.ready
    return listEntries(this.entries, query)
  }

  /**
   * Read one live entry.
   * @param id - Entry id.
   * @param signal - Cancellation.
   * @returns the entry, or null when absent or forgotten.
   */
  @Remote
  async get(id: string, signal: AbortSignal): Promise<MemoryEntry | null> {
    signal.throwIfAborted()
    await this.ready
    return getEntry(this.entries, id) ?? null
  }

  /**
   * Read forgotten entries, for the explicit restore page.
   * @param scope - Scope selector.
   * @param signal - Cancellation.
   * @returns the records, newest forgotten first.
   */
  @Remote
  async listForgotten(scope: MemoryScopeFilter, signal: AbortSignal): Promise<MemoryForgottenEntry[]> {
    signal.throwIfAborted()
    await this.ready
    return listForgotten(this.forgotten, scope)
  }

  /**
   * Add an entry; resolves after it is durable.
   * @param input - The entry.
   * @param signal - Cancellation; checked before the write only.
   * @returns the persisted entry, or the error.
   */
  @Remote
  async remember(input: MemoryRememberInput, signal: AbortSignal): Promise<MemoryWriteResult> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => this.report('remember', await remember(this.entries, input, this.clock, this.limits)))
  }

  /**
   * Correct an entry under its expected version.
   * @param input - The correction.
   * @param signal - Cancellation; checked before the write only.
   * @returns the persisted entry, or the error.
   */
  @Remote
  async correct(input: MemoryCorrectInput, signal: AbortSignal): Promise<MemoryWriteResult> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => this.report('correct', await correct(this.entries, input, this.clock, this.limits)))
  }

  /**
   * Forget an entry under its expected version.
   * @param input - The action.
   * @param signal - Cancellation; checked before the write only.
   * @returns the entry as it was, or the error.
   */
  @Remote
  async forget(input: MemoryActionInput, signal: AbortSignal): Promise<MemoryWriteResult> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => this.report('forget', await forget(this.entries, this.forgotten, input, this.clock)))
  }

  /**
   * Undo the latest change of an entry under its expected version.
   * @param input - The action.
   * @param signal - Cancellation; checked before the write only.
   * @returns the persisted entry, or the error.
   */
  @Remote
  async undo(input: MemoryActionInput, signal: AbortSignal): Promise<MemoryWriteResult> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => this.report('undo', await undo(this.entries, input, this.clock)))
  }

  /**
   * Restore a forgotten entry. Explicit only.
   * @param input - The action.
   * @param signal - Cancellation; checked before the write only.
   * @returns the live entry, or the error.
   */
  @Remote
  async restore(input: MemoryRestoreInput, signal: AbortSignal): Promise<MemoryWriteResult> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => this.report('restore', await restore(this.entries, this.forgotten, input, this.clock)))
  }

  /**
   * Review a legacy memory file without writing.
   * @param source - Global file, or a project's file by cwd.
   * @param signal - Cancellation.
   * @returns the candidates, or the problem with the file.
   */
  @Remote
  async previewImport(source: MemoryImportSource, signal: AbortSignal): Promise<MemoryImportPreview> {
    signal.throwIfAborted()
    await this.ready
    return await previewImport(this.entries, source, this.importEnvironment())
  }

  /**
   * Import the chosen candidates of a legacy file, stopping at the first failure.
   * @param request - Source, selections, and the importing session.
   * @param signal - Cancellation; checked before the first write only.
   * @returns what landed, what was skipped, and where it stopped.
   */
  @Remote
  async applyImport(request: MemoryImportRequest, signal: AbortSignal): Promise<MemoryImportOutcome> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => {
      const outcome = await applyImport(this.entries, request, this.importEnvironment(), this.clock, this.limits)
      if (outcome.written.length > 0) this.changed({ action: 'import', ids: outcome.written })
      return outcome
    })
  }

  private importEnvironment(): ImportEnvironment {
    return {
      globalFile: this.globalFile,
      projectTarget: async (cwd) => {
        const resolution = await resolveProject(cwd)
        if (resolution.project === null) return null
        const path = resolution.project.path
        return { scope: { kind: 'project', projectKey: resolution.project.key, path }, path: join(path, projectMemoryFileName(path)) }
      },
      maxBytes: this.importMaxBytes,
    }
  }

  /**
   * A session's content is being deleted: mark what it wrote, keep it, and
   * say so; nothing re-reads the session. Failures to persist a mark are
   * logged and never block the deletion — nor does a domain that is not
   * open yet, so the deletion pipeline never waits on this service.
   * @param sessionId - the session being deleted.
   */
  async sessionDeleted(sessionId: string): Promise<void> {
    if (!this.projectsOpen) {
      this.ctx.logger.warn(`workbench-memory: session ${sessionId} deleted before the memory domain opened; its entries are not marked`)
      return
    }
    await this.serialized(async () => {
      const { marked, failed } = await markSessionDeleted(this.entries, this.forgotten, sessionId)
      if (failed.length > 0) this.ctx.logger.warn(`workbench-memory: ${String(failed.length)} entries of deleted session ${sessionId} could not be marked`)
      if (marked.length > 0) this.changed({ action: 'session-deleted', ids: marked })
    })
  }

  private report(action: MemoryChangeEvent['action'], result: MemoryWriteResult): MemoryWriteResult {
    if (result.ok) this.changed({ action, ids: [result.entry.id] })
    return result
  }

  private changed(change: MemoryChangeEvent): void {
    this.ctx.emit('workbench-memory/change', change)
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }
}

export default WorkbenchMemory
