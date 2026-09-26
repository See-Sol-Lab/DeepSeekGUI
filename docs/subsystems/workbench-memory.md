# Workbench memory

English | [中文](workbench-memory.zh.md)

DeepSeekGUI's [engineering memory](../../packages/api/workbench-memory/README.md) keeps versioned entries — facts, preferences and continuation notes — scoped to a project folder or to every project, in the `deepseekgui_memory` storage domain under the active DSH home (`<home>/storages/deepseekgui_memory/entries/<id>.json`, one readable document per entry). The `workbenchMemory` Remote namespace is the one write path: a correction quotes the version it read and a stale one is refused with `MEMORY_CONFLICT`, so two windows never lose an update; the origin source is kept and the correction's source appended; undo returns one level; forgetting moves the entry to a kept-aside table and leaves a tombstone, so no read, search or undo revives it and only the explicit restore brings it back. A write resolves after the backend made it durable, and a backend failure reports `MEMORY_IO` with nothing changed.

The legacy Markdown memory files (`<home>/memory.md`, `<folder>/<folder name>.memory.md`) are imported after review: the file is cut into paragraphs, list items and fenced blocks under their headings, duplicates of live entries are marked, the person edits and chooses, and the apply writes in order until the first failure — the file itself is never modified. The global slot's `injection` mode decides which memory sessions use: `markdown` (the default until the person switches it under Settings → Global memory) keeps the legacy files live through the workbench plugin's own context section, and nothing below reaches a session; `off` switches enhanced memory off for the next step of every session — nothing injected, the tools refusing, no silent fallback to the files.

In `entries` mode the same service is the memory's Harness face. Four tools on the host registry — `memory_remember`, `memory_correct`, `memory_forget`, `memory_recall` — are the one entry point for the assistant and, later, the pages: a write lands directly with no approval gate and its outcome is the tool result, so a refusal or a backend failure reaches the model as a tool error rather than a log line; the assistant's writes carry `evidence`. One retrieval path serves the tool and the automatic recall: the scope is filtered first (this project plus global, never another project), then query terms — word runs, character bigrams for Han text — are matched against content words and keywords, ranked, deduplicated and cut by a count and a byte budget, with the omitted count and a miss explained. An `agent/pre-step` listener injects the recalled entries as a user-role `<system-reminder>` when their ids and versions differ from the newest list still visible, replacing earlier lists rather than accumulating them, and records the ids and versions in the message's `source` so the session log says what shaped a request; a runtime-context guide names what counts as a global preference, a project fact or a continuation note and what not to record. Recalled entries are facts and preferences, not rules, and grant no tool permission.

The cross-window chain rests on one Harness process serving every window and on the store's in-memory state being its persisted state: a step reads that state once at its start, so a save, correction or forget in window A is what window B's next user step recalls, a turn already under way keeps the list it started with across its later tool steps, and a write quoting a version a window no longer holds is refused with the current one — the tools require the version the model saw, the pages the version they read — never merged. A restart reopens the same domain from disk; another DSH home is another, empty store; every durable change is forwarded to the browser as `workbench-memory/change` by the application's remote assembly (`@deepseek-ai/dsh-api-remotes`, see [typert](typert.md)) so the pages of every window re-read. A task is handed to a later session as a continuation note: five parts kept apart — goal, confirmed decisions, unfinished items (planned, failed or unverified work goes here), leads, and what was verified back then — saved through the tools' structured `continuation` argument when the user asks to save progress, bounded so a note never nests a recalled list or another note, and recalled with the framing that it is an old summary whose checks are past, to be re-checked against the disk and Git and not resumed until the user asks. Compaction summaries are never harvested into notes, the session log stays the Harness's only record of a session, and after a compaction shadowed an injected list the next user step re-sends one with tool call and result pairs untouched. Deleting a session's content marks the entries it wrote (`source.sessionDeleted`) and keeps them — a saved memory is independent of its source — without re-reading or copying the deleted session. The person meets all of this in two DeepSeekGUI pages of the [workbench plugin](../../apps/deepseekgui/workbench-plugin/README.md): the Memory view at the top of a session (what this session's model was shown, the project's and the global entries with search, detail, source, edit, forget, undo and restore, the reviewable import of the project's legacy file) and Settings → Global memory (the mode switch between the legacy files, the entries and off — explicit, confirmed, never applying two paths at once — the global entries, the import of the legacy global file, an export to Markdown text, and in the legacy mode the file editor); both write the same store the tools write, quoting the version they read, and re-read on `workbench-memory/change`. The package README owns the wire values, error codes, bounds and the exact texts; [storage](storage.md) owns the domain facility, the [skill manager](skill-manager.md) owns the project key the scopes share, the [session](session.md) page documents the deletion hook, and the [system prompt](system-prompt.md) and [tools](tools.md) own the extension points.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbenchmemory--workbenchmemory"></a>

### `ctx.workbenchMemory` — `WorkbenchMemory`

Entry reads and versioned writes, plus the reviewed legacy import.

```ts cordis-catalog
/**
 * Which memory path sessions use right now; `markdown` before the domain is open.
 * @returns the mode from the global slot.
 */
injectionMode(): MemoryInjectionMode

/**
 * The project scope of a session working directory.
 * @param cwd - session cwd.
 * @returns the scope, or null without a usable folder.
 */
async sessionScope(cwd: string | undefined): Promise<MemoryProjectScope | null>

/**
 * The one retrieval path: scope, terms, ranking, duplicates, budget.
 * @param options - scope selector, query text, optional kinds and bounds (default: the configured recall bounds).
 * @returns the ranked entries and the explanation of what was searched.
 */
recall(options: RecallRequest): RecallResult

/**
 * Store facts: injection mode, counts, the legacy global file.
 * @param signal - Cancellation.
 * @returns the status.
 */
@Remote async status(signal: AbortSignal): Promise<MemoryStatus>

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
@Remote async setInjection(mode: MemoryInjectionMode, signal: AbortSignal): Promise<MemoryStatus>

/**
 * Resolve a working directory to its project scope.
 * @param cwd - Session working directory.
 * @param signal - Cancellation.
 * @returns the scope, or null when the folder does not exist.
 */
@Remote async projectScope(cwd: string, signal: AbortSignal): Promise<MemoryScope | null>

/**
 * Read live entries.
 * @param query - Scope, kinds, origin session, text and limit.
 * @param signal - Cancellation.
 * @returns the page.
 */
@Remote async list(query: MemoryQuery, signal: AbortSignal): Promise<MemoryList>

/**
 * Read one live entry.
 * @param id - Entry id.
 * @param signal - Cancellation.
 * @returns the entry, or null when absent or forgotten.
 */
@Remote async get(id: string, signal: AbortSignal): Promise<MemoryEntry | null>

/**
 * Read forgotten entries, for the explicit restore page.
 * @param scope - Scope selector.
 * @param signal - Cancellation.
 * @returns the records, newest forgotten first.
 */
@Remote async listForgotten(scope: MemoryScopeFilter, signal: AbortSignal): Promise<MemoryForgottenEntry[]>

/**
 * Add an entry; resolves after it is durable.
 * @param input - The entry.
 * @param signal - Cancellation; checked before the write only.
 * @returns the persisted entry, or the error.
 */
@Remote async remember(input: MemoryRememberInput, signal: AbortSignal): Promise<MemoryWriteResult>

/**
 * Correct an entry under its expected version.
 * @param input - The correction.
 * @param signal - Cancellation; checked before the write only.
 * @returns the persisted entry, or the error.
 */
@Remote async correct(input: MemoryCorrectInput, signal: AbortSignal): Promise<MemoryWriteResult>

/**
 * Forget an entry under its expected version.
 * @param input - The action.
 * @param signal - Cancellation; checked before the write only.
 * @returns the entry as it was, or the error.
 */
@Remote async forget(input: MemoryActionInput, signal: AbortSignal): Promise<MemoryWriteResult>

/**
 * Undo the latest change of an entry under its expected version.
 * @param input - The action.
 * @param signal - Cancellation; checked before the write only.
 * @returns the persisted entry, or the error.
 */
@Remote async undo(input: MemoryActionInput, signal: AbortSignal): Promise<MemoryWriteResult>

/**
 * Restore a forgotten entry. Explicit only.
 * @param input - The action.
 * @param signal - Cancellation; checked before the write only.
 * @returns the live entry, or the error.
 */
@Remote async restore(input: MemoryRestoreInput, signal: AbortSignal): Promise<MemoryWriteResult>

/**
 * Review a legacy memory file without writing.
 * @param source - Global file, or a project's file by cwd.
 * @param signal - Cancellation.
 * @returns the candidates, or the problem with the file.
 */
@Remote async previewImport(source: MemoryImportSource, signal: AbortSignal): Promise<MemoryImportPreview>

/**
 * Import the chosen candidates of a legacy file, stopping at the first failure.
 * @param request - Source, selections, and the importing session.
 * @param signal - Cancellation; checked before the first write only.
 * @returns what landed, what was skipped, and where it stopped.
 */
@Remote async applyImport(request: MemoryImportRequest, signal: AbortSignal): Promise<MemoryImportOutcome>

/**
 * A session's content is being deleted: mark what it wrote, keep it, and
 * say so; nothing re-reads the session. Failures to persist a mark are
 * logged and never block the deletion — nor does a domain that is not
 * open yet, so the deletion pipeline never waits on this service.
 * @param sessionId - the session being deleted.
 */
async sessionDeleted(sessionId: string): Promise<void>
```

Source: [`packages/api/workbench-memory/src/index.ts`](../../packages/api/workbench-memory/src/index.ts)

<a id="workbench-memory-events"></a>

### `workbench-memory/*` events

<a id="workbench-memorychange--emit"></a>

#### `workbench-memory/change` — emit

The memory store changed. Emitted after the write is durable; the application forwards it to the browser and the memory pages re-read on it.

```ts cordis-catalog
/**
 * The memory store changed. Emitted after the write is durable; the
 * application forwards it to the browser and the memory pages re-read on it.
 * @mode emit
 * @param change - What happened and to which entry ids.
 */
'workbench-memory/change'(change: MemoryChangeEvent): void
```

Source: [`packages/api/workbench-memory/src/types.ts`](../../packages/api/workbench-memory/src/types.ts)
<!-- END GENERATED cordis-surface -->
