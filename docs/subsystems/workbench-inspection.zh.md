# Workbench 检查

[English](workbench-inspection.md) | 中文

DeepSeekGUI 的[只读适配器](../../packages/api/workbench-inspector/README.zh.md)通过官方 Remote 网关提供当前文件系统和 Git 事实。SessionQuery 为运行中或冷 Session 提供记录的 cwd，不产生模型请求或第二份会话存储。

包 README 拥有响应字段、读取上限与失败语义。[文件系统](filesystem.zh.md)和 [Git](git.zh.md)仍是底层能力的 owner。Workbench 区分当前读取与带来源标注的会话历史，关闭检查器时取消读取。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkbenchinspector--workbenchinspector"></a>

### `ctx.workbenchInspector` — `WorkbenchInspector`

Read-only Remote namespace; no Session events, model requests, or writes.

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

Types: [DiffResult](git.zh.md) · [DiffScope](git.zh.md) · [SessionId](core.zh.md)

Source: [`packages/api/workbench-inspector/src/index.ts`](../../packages/api/workbench-inspector/src/index.ts)
<!-- END GENERATED cordis-surface -->
