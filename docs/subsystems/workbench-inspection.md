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
 * 记忆视图读的归档整理事实：开关、这段会话的整理记录、是否正在整理。
 * @param sessionId - 会话。
 * @param signal - Request cancellation.
 * @returns 归档整理事实。
 */
@Remote archiveMemoryState(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchArchiveMemory>

/**
 * 手动整理一段会话（不看长度门槛）：短会话、上次失败、整理区清理之后都从这里再来一次。
 * 对仍在使用的会话也可以：只读、不带工具，不改会话本身。请求被取消（页面关闭）就停掉这一次。
 * @param sessionId - 会话。
 * @param signal - Request cancellation.
 * @returns 本次的记录。
 */
@Remote async summarizeSession(sessionId: SessionId, signal: AbortSignal): Promise<ArchiveMemoryRecord>

/**
 * 改归档整理的开关或标记首次说明已读。
 * @param auto - 归档时自动整理；null = 不改。
 * @param noticeSeen - 首次说明已读；null = 不改。
 * @param signal - Request cancellation.
 * @returns 改后的设置。
 */
@Remote setArchiveMemorySettings(auto: boolean | null, noticeSeen: boolean | null, signal: AbortSignal): Promise<WorkbenchArchiveMemory['settings']>

/**
 * 等用户确认的全局记忆建议（来自归档整理）。
 * @param signal - Request cancellation.
 * @returns 建议列表。
 */
@Remote memorySuggestions(signal: AbortSignal): Promise<MemorySuggestion[]>

/**
 * 从列表里拿掉一条建议：用户已经把它加进全局记忆（由桌面的全局记忆保存命令写入），或者忽略了它。
 * 建议文件只由本进程读写。
 * @param id - 建议 id。
 * @param signal - Request cancellation.
 * @returns 是否找到并拿掉了。
 */
@Remote async resolveMemorySuggestion(id: string, signal: AbortSignal): Promise<boolean>

/**
 * 这段会话每次加载时带入了哪些记忆（见 MemoryInjection；最后一条是当前这次加载在用的）。
 * 没有记录就是 null：会话还没发过第一条，或是本功能之前的老会话。
 * @param sessionId - 会话。
 * @param signal - Request cancellation.
 * @returns 带入事实，或 null。
 */
@Remote memoryInjection(sessionId: SessionId, signal: AbortSignal): Promise<MemoryInjection | null>

/**
 * Remove the Windows ACL sandbox's marks from a folder the desktop user
 * chose (DeepSeekGUI 2026-09-29): its grant, the delete deny, and the Low
 * label that make programs started there run at Low integrity. The sandbox
 * provider picks the folder that actually carries them (the chosen one or
 * the ancestor they are inherited from) and refuses while a confined
 * command runs there.
 * @param path - Absolute folder path from the desktop's folder dialog.
 * @param signal - Request cancellation.
 * @returns what was done, and on which folder.
 */
@Remote async cleanSandboxMarks(path: string, signal: AbortSignal): Promise<WorkbenchSandboxClean>

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
 * Render one Session as a human-readable Markdown document (B8-P1). The
 * log is read through the query service — a running turn's newest events
 * may not be on disk yet — and folded by the pure renderer; no model is
 * called and nothing is sanitized. Compaction markers ride the raw log,
 * so pre-compaction messages are quoted as they happened.
 * @param sessionId - Session selected by the desktop user.
 * @param includeDetails - Whether tool calls and reasoning blocks ride along.
 * @param language - The desktop UI language for headings and labels.
 * @param signal - Request cancellation.
 * @returns the display title and the rendered document.
 * @throws when the rendered document exceeds `maxExportBytes`; the message
 * is the product's fixed user-facing sentence.
 */
@Remote async exportMarkdown( sessionId: SessionId, includeDetails: boolean, language: WorkbenchExportLanguage, signal: AbortSignal, ): Promise<WorkbenchExportMarkdown>

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
