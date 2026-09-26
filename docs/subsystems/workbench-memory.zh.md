# Workbench 记忆

[English](workbench-memory.md) | 中文

DeepSeekGUI 的[工程记忆](../../packages/api/workbench-memory/README.zh.md)把带版本的条目——事实、偏好与接续资料——按项目文件夹或全部项目划分作用域，存在当前 DSH home 下的 `deepseekgui_memory` 存储域里（`<home>/storages/deepseekgui_memory/entries/<id>.json`，每条一个可读文档）。`workbenchMemory` Remote 命名空间是唯一的写入路径：纠正必须带上读到的版本，过期版本以 `MEMORY_CONFLICT` 拒绝，所以两个窗口绝不会丢更新；来源事实保留，纠正的来源追加；撤销退回一层；遗忘把条目移到搁置表并留下墓碑，任何读取、检索或撤销都不会让它复活，只有显式恢复才带回。写入在后端持久化后才返回，后端失败报告 `MEMORY_IO` 且什么都没变。

旧的 Markdown 记忆文件（`<home>/memory.md`、`<文件夹>/<文件夹名>.memory.md`）经审阅后导入：文件按标题下的段落、列表项与围栏块切分，标出与存活条目重复的段，由人编辑与选择，应用时按顺序写入直到第一处失败——文件本身从不被修改。全局槽的 `injection` 模式决定会话用哪份记忆：`markdown`（默认，直到用户在「设置 → 全局记忆」切换）让旧文件经 workbench 插件自己的上下文段继续生效，下文的一切都不进入会话；`off` 从每个会话的下一步起关闭增强记忆——什么都不注入、工具拒绝、旧文件也不会悄悄顶上。

在 `entries` 模式下，同一个服务就是记忆面向 Harness 的一面。宿主注册表上的四个工具——`memory_remember`、`memory_correct`、`memory_forget`、`memory_recall`——是助手以及之后的页面的唯一入口：写入直接落盘、没有审批门，结果就是工具结果，所以拒绝或后端失败作为工具错误而不是一行日志到达模型；助手的写入带 `evidence`。工具与自动召回共用一条检索路径：先过滤范围（本项目加全局，绝不含其它项目），再把 query 的词——词串、汉字文本用双字组——与正文词和关键词匹配、排名、去重，并按条数与字节预算截断，报告被截掉的数量并解释未命中。一个 `agent/pre-step` 监听器在召回条目的 id 与版本不同于仍可见的最新清单时，把它们作为用户角色的 `<system-reminder>` 注入，以替换而非累积的方式取代此前的清单，并把 id 与版本记进消息的 `source`，所以会话日志说得清是什么塑造了这次请求；一段运行时上下文指南说明什么算全局偏好、项目事实或接续记录、什么不记。召回的条目是事实与偏好而非规则，不授予任何工具权限。

跨窗链路建立在一个 Harness 进程服务所有窗口、且存储的内存态就是持久化态之上：一步在开始时读一次这个状态，所以窗口 A 的保存、纠正或遗忘就是窗口 B 下一个用户步召回到的东西，已经开始的一轮在后续工具步里仍保持开始时的清单，而引用了窗口已不再持有的版本的写入会连同当前版本一起被拒绝——工具要求模型看到的版本，页面要求它读到的版本——绝不合并。重启从磁盘重开同一个域；另一个 DSH home 是另一个空存储；每次持久化变更都由应用的远程装配（`@deepseek-ai/dsh-api-remotes`，见 [typert](typert.zh.md)）以 `workbench-memory/change` 转发到浏览器，所以每个窗口的页面都会重读。任务以接续记录交接给之后的会话：五个部分分开——目标、确认过的决定、未完成项（打算做、失败或未验证的工作归这里）、线索，以及当时验证过什么——在用户要求保存进度时经工具的结构化 `continuation` 参数保存，受约束以致记录绝不嵌套召回清单或另一份记录，召回时带着「这是旧摘要、它的检查已成过去、须对照磁盘与 Git 重查、用户开口前不恢复」的框架。压缩摘要绝不被收割成记录，会话日志仍是 Harness 对一个会话的唯一记录，压缩遮蔽掉一份注入清单后，下一个用户步只重发一份，工具调用与结果的配对原样不动。删除一个会话的内容会给它写的条目打上标记（`source.sessionDeleted`）并保留——保存下来的记忆独立于来源——不重读、不复制被删除的会话。用户在 [workbench 插件](../../apps/deepseekgui/workbench-plugin/README.zh.md)的两个 DeepSeekGUI 页面里接触到这一切：会话顶部的记忆视图（本会话的模型看到了什么、本项目与全局的条目——搜索、详情、来源、编辑、遗忘、撤销、恢复——以及项目旧文件的可审阅导入）和「设置 → 全局记忆」（旧文件 / 条目 / 关闭三种方式之间明确、需确认、绝不同时生效两条路径的切换，全局条目，旧全局文件的导入，导出为 Markdown 文本，以及旧模式下的文件编辑器）；两者写的都是工具所写的同一份存储，引用它们读到的版本，并在 `workbench-memory/change` 上重读。包 README 拥有线上值、错误码、上限与确切文字；[存储](storage.zh.md)拥有域设施，[技能管理器](skill-manager.zh.md)拥有各作用域共用的项目键，[会话](session.zh.md)页记录删除钩子，[系统提示词](system-prompt.zh.md)与[工具](tools.zh.md)拥有扩展点。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
