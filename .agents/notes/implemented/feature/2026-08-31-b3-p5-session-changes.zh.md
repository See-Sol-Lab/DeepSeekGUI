# Agent Note: B3-P5 Session Changes — 会话改动文件面板

Status: implemented

[English](2026-08-31-b3-p5-session-changes.md) | 中文

## Problem

会话修改文件之后，Workbench 没有一块表面回答「这个会话改了哪些文件、各自变成了什么」。官方消息流会在原位展示每次改动的 diff 卡片，但跨会话的概览——每个被改文件的列表及前后对比——只能在渲染时从事件窗口推导，这违反 Conversation Node 纪律（append 热路径与渲染器不得扫描完整事件窗口）。

## Decision

**Workbench 插件中的 `changes` Conversation Node**（`apps/desktop/workbench-plugin/src/client/changes-node.ts`），经 `ctx.conversationEvents` 注册。它把每个 Turn 的成功文件改动折叠进 `changes` Turn Location 数据（`ConversationTurnDataMap.changes`：`ChangeEntry { seq, path, diffs: readonly DiffHunk[] | null, callId }`），按 turn scope 发布。折叠按日志 `seq` 确定性可重放：重开、刷新、补加载更早分页都会从同一批事件重建出相同列表；数据源只有 Session 事件，因此会话外部的改动（人工 Git 编辑、其他工具的副作用）永远不会出现。

识别按渲染意图而非工具名——`card: 'diff'` 视图，或 `kind` 为 `edit` 的 generic 卡片（`str_replace_editor` 的 insert 所呈现的形态）——新改动工具只要声明自己的意图即可加入，未知工具绝不猜测。diff 内容以 result 视图为权威（write/edit 工具在那里返回应用后的上下文 hunks，即编辑的真实前后文，且由 result meta 推导，重放确定）；result 视图缺失或为 generic 时，call 视图的 diff 仍然计为一次改动，而 generic edit 的 locations 只存在于 call 视图。wire 上的 `diffs` 在边界处窄化（`narrowDiffs`，与 ui-tool diff-card 模型同一策略；本插件不能 import 它）：畸形载荷丢弃该改动而不是渲染垃圾。已识别但没有呈现 diff 内容的编辑被诚实地记为 `diffs: null`——面板显示「已修改」而不虚构前后文。

**Workbench Changes 面板**（`src/client/ChangesView.tsx`）：`conversation.view` tab（id `changes`，order 30），只读 `useSession(snapshot => snapshot.chat.timeline.turns)`——不扫节点、不碰事件窗口。条目按文件分组、以首次改动排序，带每文件改动次数；每条目对 hunks 渲染 `DiffBlock`（共享 `ui-primitives` 原语，baseline 外部化），对无 diff 内容显示本地化的「已修改」行。展示路径在会话项目 cwd 之下时相对 cwd（`useSessions` 摘要），否则原样。文案来自插件自己的 `deepseekgui.workbench` 命名空间（`view.changes`、`changes.empty`、`changes.count`、`changes.noDiff`）。

## Alternatives considered

**渲染时扫描事件窗口 / 对话节点。** 违反 Conversation Node 纪律：append 热路径与渲染器不得扫描全窗口，而且窗口丢掉更早分页时会得到与重开同一会话不同的列表。

**只从 call 视图推导 diff。** call 时的 `diffs` 对覆盖写携带 `oldText: null`（presenter 没有先前内容）；result 视图的应用后 hunks 才是权威前后文，且经 result meta 保持重放确定。

**按工具名识别改动。** 违背 B3 的「未知 Tool 不猜」验收规则——不声明 diff 卡与 edit locations 的工具本就无可报告；新改动工具凭渲染意图加入，而不是名字白名单。

## Consequences

Workbench 插件现在注入 `conversationEvents` 并注册一个 Node definition；`changes` Turn-data 键是插件对官方映射的增补。面板只复用官方原语与快照——没有第二事实源。折叠不携带 view Node，从不触碰事件窗口；每 Turn 内存受该 Turn 成功改动数量约束。`groupChanges` 推导被导出以便直接测试。组件测试为 jsdom 套件，未在施工机运行（本机 vitest jsdom 环境无法加载任何 jsdom 套件——官方 `produced-files.client.spec.tsx` 以同样的 `No such built-in module: node:` 失败——故交由验收机运行）；node 环境的折叠套件（`changes-node.spec.ts`，10 个测试）本机通过，端到端路径经 mock LLM server 驱动真实 `write` 工具调用验证：文件真实落盘，Changes 面板列出 `notes.txt` 并显示应用的 diff。
