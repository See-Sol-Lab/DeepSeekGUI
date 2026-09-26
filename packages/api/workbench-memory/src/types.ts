/**
 * Wire values of DeepSeekGUI's engineering memory: entries, their scope and
 * source, the write results, and the reviewed import of the legacy Markdown
 * memory files. Declared client-safe so the desktop pages and the Remote
 * assembly read the same declarations the Host stores.
 */

/** Where an entry applies: every project, or one project folder. */
export type MemoryScope =
  | { kind: 'global' }
  | {
    kind: 'project'
    /** sha256 of the canonical folder path (the skill manager's project key). */
    projectKey: string
    /** Canonical folder path as recorded when the entry was written. */
    path: string
  }

/** The project half of {@link MemoryScope}. */
export type MemoryProjectScope = Extract<MemoryScope, { kind: 'project' }>

/** What an entry is for. A closed union: consumers switch exhaustively. */
export type MemoryKind = 'fact' | 'preference' | 'continuation'

/** Who wrote or changed an entry, and on what basis. */
export interface MemorySource {
  kind: 'user' | 'assistant' | 'import'
  /** Session the write came from, when it came from one. */
  sessionId?: string
  /**
   * The source session's content was deleted after the write. Only the id is
   * known from then on; nothing re-reads or copies the deleted session.
   */
  sessionDeleted?: true
  /** ISO time of the write. */
  at: string
  /** What the entry rests on: a file path, a command output, the user's words — free text. */
  evidence?: string
  /** Import origin (`<file>#<heading>`), or any short note about the write. */
  detail?: string
}

/** The state an undo restores: the entry as it was before the latest change. */
export interface MemoryRevision {
  version: number
  content: string
  keywords?: string[]
  kind: MemoryKind
  /** Who made the change that produced that state, when it was not the origin. */
  revised?: MemoryChange
  updatedAt: string
}

/** One change after the origin: who and when. The origin `source` is never overwritten. */
export interface MemoryChange {
  /** What happened. */
  action: 'correct' | 'undo' | 'restore'
  at: string
  source: MemorySource
}

/** One live memory entry. */
export interface MemoryEntry {
  /** `m_` plus 12 hex characters; stable for the life of the entry. */
  id: string
  scope: MemoryScope
  kind: MemoryKind
  content: string
  keywords?: string[]
  /** Origin of the entry; corrections append to `revised`, they never replace this. */
  source: MemorySource
  /** Monotonic; every write quotes the version it read and refuses a stale one. */
  version: number
  /** The latest change after the origin, when any. */
  revised?: MemoryChange
  /** The state before the latest change; undo restores it (one level). */
  previous?: MemoryRevision
  createdAt: string
  updatedAt: string
}

/** A forgotten entry as kept aside: the whole entry plus when and by whom it was forgotten. */
export interface MemoryForgottenEntry {
  entry: MemoryEntry
  forgottenAt: string
  forgottenBy: MemorySource
}

/** Stable failure codes of a write. */
export type MemoryErrorCode =
  /** The quoted version is not the stored one; `currentVersion` says what is. */
  | 'MEMORY_CONFLICT'
  | 'MEMORY_NOT_FOUND'
  /** The entry was forgotten; writes do not revive it, restore is explicit. */
  | 'MEMORY_FORGOTTEN'
  /** Undo asked of an entry with no previous state. */
  | 'MEMORY_NO_PREVIOUS'
  /** Input rejected before any write (empty content, bad scope, over the size cap). */
  | 'MEMORY_INVALID'
  /** The backend did not persist the write; nothing changed. */
  | 'MEMORY_IO'

/** Why a write did not happen. */
export interface MemoryError {
  code: MemoryErrorCode
  message: string
  /** The stored version, on `MEMORY_CONFLICT`. */
  currentVersion?: number
}

/** Result of a write: the persisted entry, or the reason nothing changed. */
export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry }
  | { ok: false; error: MemoryError }

/** Scope selector of a read. */
export type MemoryScopeFilter =
  | { kind: 'global' }
  | { kind: 'project'; projectKey: string }
  /** Global entries plus one project's. */
  | { kind: 'session'; projectKey: string }
  | { kind: 'all' }

/** A read over live entries; forgotten entries never match. */
export interface MemoryQuery {
  scope: MemoryScopeFilter
  kinds?: MemoryKind[]
  /** Case-insensitive text; every whitespace-separated term must occur in the content or a keyword. */
  text?: string
  /** Only entries whose origin source is this session (what a session deletion leaves behind). */
  sessionId?: string
  /** Newest first; default 100. */
  limit?: number
}

/** A page of entries. */
export interface MemoryList {
  entries: MemoryEntry[]
  /** Total matches before `limit`. */
  total: number
}

/** New entry. */
export interface MemoryRememberInput {
  scope: MemoryScope
  kind: MemoryKind
  content: string
  keywords?: string[]
  source: Omit<MemorySource, 'at'>
}

/** Correction: replaces content (and optionally keywords or kind) under an expected version. */
export interface MemoryCorrectInput {
  id: string
  expectedVersion: number
  content?: string
  keywords?: string[]
  kind?: MemoryKind
  source: Omit<MemorySource, 'at'>
}

/** A versioned action on one entry: forget or undo. */
export interface MemoryActionInput {
  id: string
  expectedVersion: number
  source: Omit<MemorySource, 'at'>
}

/** Restore of a forgotten entry: explicit, never automatic. */
export interface MemoryRestoreInput {
  id: string
  source: Omit<MemorySource, 'at'>
}

/**
 * Which memory reaches a session: the legacy Markdown files (`markdown`, the
 * default), the entries with their tools, guide and recall (`entries`), or
 * nothing at all (`off`: enhanced memory switched off — no entries, and no
 * silent fallback to the files). Switching is the person's explicit act.
 */
export type MemoryInjectionMode = 'markdown' | 'entries' | 'off'

/**
 * A continuation note: where a task stands, in five parts a later session
 * reads apart — what was wanted, what was decided, what is still open, where
 * to look, and what was checked back then (never a claim about now).
 */
export interface ContinuationNote {
  /** The task's goal, one line. */
  goal: string
  /** Decisions the user confirmed. */
  decisions: string[]
  /** Items still open; planned or failed work belongs here, not under `verified`. */
  unfinished: string[]
  /** File paths, commands, or places to look first. */
  leads: string[]
  /** What was actually run or checked at the time, with its result. */
  verified: string[]
}

/** Facts about the store. */
export interface MemoryStatus {
  injection: MemoryInjectionMode
  active: number
  forgotten: number
  /** Absolute path of the legacy global memory file. */
  globalFile: string
}

/** Which legacy file to import. */
export type MemoryImportSource =
  | { kind: 'global' }
  | { kind: 'project'; cwd: string }

/** One reviewable segment of a legacy file. */
export interface MemoryImportCandidate {
  /** Identifies the candidate within the preview; passed back in the apply request. */
  key: string
  /** Heading path above the segment, outermost first. */
  headings: string[]
  /** 1-based line of the segment's first line. */
  line: number
  /** Segment text as it will be stored, whitespace trimmed. */
  text: string
  /** Suggested kind: `preference` for the global file, `fact` for a project file. */
  kind: MemoryKind
  /** A live entry in the target scope with the same normalized content, when one exists. */
  duplicateOf: string | null
}

/** Problems with the file itself. */
export type MemoryImportProblem = 'missing' | 'too-large' | 'unreadable' | 'no-project' | 'empty'

/** The reviewed content of a legacy file before anything is written. */
export type MemoryImportPreview =
  | {
    source: MemoryImportSource
    /** Absolute file path. */
    path: string
    /** Target scope of every candidate. */
    scope: MemoryScope
    /** Why there are no candidates, when there are none. */
    problem?: Exclude<MemoryImportProblem, 'no-project'>
    candidates: MemoryImportCandidate[]
  }
  | {
    source: MemoryImportSource
    /** The folder that could not be resolved. */
    path: string
    scope: null
    problem: 'no-project'
    candidates: MemoryImportCandidate[]
  }

/** One candidate the user chose to import, with optional edits. */
export interface MemoryImportSelection {
  key: string
  kind?: MemoryKind
  content?: string
  keywords?: string[]
}

/** Import the selected candidates of one file. */
export interface MemoryImportRequest {
  source: MemoryImportSource
  selections: MemoryImportSelection[]
  /** Session performing the import, when any. */
  sessionId?: string
}

/** Result of an apply: entries written in order until the first failure. */
export interface MemoryImportOutcome {
  /** Ids written, in selection order. */
  written: string[]
  /** Selections skipped because a live entry already holds the same content. */
  skipped: Array<{ key: string; duplicateOf: string }>
  /** The selection that failed and why; every selection after it was not attempted. */
  failedAt?: { key: string; error: MemoryError }
}

/**
 * Durable record of one recalled-memory list injected at a step boundary:
 * exactly the ids and versions the model saw, beside the rendered text, so a
 * later reader names what shaped the request without re-parsing prose.
 */
export interface MemoryRecallSource {
  readonly kind: 'deepseekgui-memory'
  readonly form: 'recall'
  /** Marks a replacement list rather than the session's first. */
  readonly update?: true
  /** The user text the recall matched against. */
  readonly query: string
  readonly entries: readonly {
    readonly id: string
    readonly version: number
    readonly scope: 'global' | 'project'
    readonly kind: MemoryKind
  }[]
  /** Matching entries left out for the limit or the budget. */
  readonly omitted: number
}

/** Store change carried by the `workbench-memory/change` event. */
export interface MemoryChangeEvent {
  action: 'remember' | 'correct' | 'forget' | 'undo' | 'restore' | 'import' | 'injection' | 'session-deleted'
  /** Entry ids touched; empty for an injection-mode switch. */
  ids: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The memory store changed. Emitted after the write is durable; the
     * application forwards it to the browser and the memory pages re-read on it.
     * @mode emit
     * @param change - What happened and to which entry ids.
     */
    'workbench-memory/change'(change: MemoryChangeEvent): void
  }
}
