# Workbench inspection

English | [中文](workbench-inspection.zh.md)

DeepSeekGUI's [read-only adapter](../../packages/api/workbench-inspector/README.md) serves current filesystem and Git facts through the official Remote gateway. SessionQuery supplies the recorded cwd for live or cold Sessions; no model request or second Session store is involved.

The package README owns response fields, bounds, and failure semantics. [Filesystem](filesystem.md) and [Git](git.md) remain the underlying capability owners. The Workbench separates current reads from annotated conversation history and cancels reads when the inspector closes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbenchinspector--workbenchinspector"></a>

### `ctx.workbenchInspector` — `WorkbenchInspector`

Read-only workspace inspection plus desktop-authorized Session deletion.

```ts cordis-catalog
/**
 * Read complete bounded text using provider-owned decoding and binary rejection.
 * @param sessionId - Session whose recorded cwd anchors the read.
 * @param path - File relative to the selected root.
 * @param repository - Select the Session's Git root instead of cwd.
 * @param signal - Request cancellation.
 * @returns the file text; oversized or binary files fail explicitly.
 */
@Remote async text(sessionId: SessionId, path: string, repository: boolean, signal: AbortSignal): Promise<WorkbenchFileText>

/**
 * Read the project memory file (`<folder>.memory.md` in the Session cwd)
 * and whether the project has an AGENTS.md. A missing memory file is a
 * normal state ("no memory yet"), not a failure.
 * @param sessionId - Session whose recorded cwd anchors the read.
 * @param signal - Request cancellation.
 * @returns the cwd, the memory file name, its text or null, and the AGENTS.md presence.
 */
@Remote async memory(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchMemory>

/**
 * Read current repository status without running a model or tool.
 * @param sessionId - Session whose recorded cwd anchors the read.
 * @param signal - Request cancellation.
 * @returns canonical Git status and root.
 */
@Remote async status(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchRepository>

/**
 * Read the current patch for one path or the complete selected scope.
 * @param sessionId - Session whose recorded cwd anchors the read.
 * @param scope - Index or unstaged changes.
 * @param path - Repository-relative file; empty selects all changes.
 * @param signal - Request cancellation.
 * @returns the bounded provider diff; truncation is never silent.
 */
@Remote async diff(sessionId: SessionId, scope: DiffScope, path: string, signal: AbortSignal): Promise<DiffResult>

/**
 * The newest assistant reply of a Session and whether its turn has ended.
 * The desktop's feedback triage (#15) prompts a hidden session and polls
 * this; reading the log through the query service keeps it off the
 * streaming follow channel the desktop has no client for.
 * @param sessionId - the session to read.
 * @param signal - Request cancellation.
 * @returns the reply text (text blocks joined) and its completeness.
 */
@Remote async lastReply(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchLastReply>

/**
 * Delegate authorized deletion to the Session owner, waiting for active work.
 * @param sessionId - Session selected by the desktop user.
 * @param signature - Desktop authorization bound to Home and Session ID.
 * @returns Completion of content deletion and its client announcement.
 */
@Remote async deleteSession(sessionId: SessionId, signature: string): Promise<void>

/**
 * Repository-level facts for the Git and Worktree views in one read:
 * status, configured remotes, the newest commits, and every registered
 * work tree with its own changed paths. Nothing is written; a work tree
 * whose status cannot be read reports no changed paths.
 * @param sessionId - Session whose recorded cwd anchors the read.
 * @param signal - Request cancellation.
 * @returns the read-only repository overview.
 */
@Remote async overview(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchOverview>
```

Types: [DiffResult](git.md) · [DiffScope](git.md) · [SessionId](core.md)

Source: [`packages/api/workbench-inspector/src/index.ts`](../../packages/api/workbench-inspector/src/index.ts)
<!-- END GENERATED cordis-surface -->
