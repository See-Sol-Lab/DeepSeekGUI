# Agent Note: B4-P1 Task–Repository Ownership Spike——最小 Task capability 与 Workbench Task 导航

Status: implemented
Archived: 2026-09-03

[English](2026-09-01-b4-p1-task-repository-ownership.md) | 中文

## 问题

B4 围绕真实 Git 仓库组织会话：task 引用一个工作目录和一个或多个 Harness 会话，但不能变成第二个 Agent runtime 或第二份 Git 状态。B4-P1 必须证明最小所有权：持久 task 记录、Workbench task 界面，且无 Git 写操作、无 worktree、无 task prompt、无 Electron/浏览器持久化。

## 决策

### Task 包：`@deepseek-ai/dsh-task`（`ctx.taskRegistry`）

仿照 `dsh-workspace` 的新宿主侧包：基于领域数据形式的持久注册表（`task` 域 v1，一张以 `TaskId` 为键的 `tasks` 表）。task 记录只持有 B4 规格指定的事实——不透明 uuid id、用户标题、规范 `workdir`（创建时 `fs.realpath`）、规范 `repoRoot`（`git rev-parse --show-toplevel` 输出的 `fs.realpath`）、工作模式（schema 携带 `'local' | 'managed-worktree' | 'attached-worktree'`；B4-P1 只创建 `'local'`）、有序 `sessionIds` 记账、`open` 生命周期标志和 ISO 时间戳。Git 拥有仓库，Harness 拥有会话；记录只引用两者，绝不复制。

创建时经 subprocess seam **只读**确认 Git identity——`resolveExecutable('git')` 加 `spawn(['git', 'rev-parse', '--show-toplevel'], cwd: workdir)`，收集 stdio，精确 executable + argv，绝不用 shell 字符串，10 秒探测截止、5 秒终止宽限。非仓库目录以 `TaskNotARepositoryError` 拒绝，git 不可解析以 `GitUnavailableError` 拒绝，两者都不写入任何内容。B4-P1 不存在 worktree 创建或 Git 写路径。

会话 attach 复用 workspace 成员纪律：会话必须存在（实时或会话持久化，否则抛 `TaskUnknownSessionError`），其头部 cwd 必须规范化为与 task `workdir` 相等的现有目录（否则抛 `TaskAttachMismatchError`）；不匹配在不写入的前提下被拒绝。`sessionIds` 是同步 id 加规范 cwd 投影，与 workspace 记账一样过滤和剪除。`status()` 是未缓存目录检查（`'ok' | 'missing-dir'`），绝不改动记录、绝不编造替代目录。

域不需要 global 单例和显示顺序：列表从记录时间戳推导（新到旧，id 稳定排序），归档是记录自身的 `open` 标志，单表写入不需要 pending-mutation 标记。包附带 `task-invariant` 伴随插件，断言实体缓存与 `tasks` 表一致。

### 线域：`task.*`

API 网关（`dsh-host-apiproxy`）新增闭式 `task.*` 域——`list`、`get`、`create`、`rename`、`archive`、`status`、`attachSession`、`detachSession`——含 wire schema、`RpcMethodMap` 行、fetch carrier 对和五个新错误码（`task-not-found`、`task-invalid-path`、`task-not-repository`、`git-unavailable`、`task-attach-mismatch`），同步进入 `RpcErrorDetailsMap` 与错误 schema。`create` 只把注册表的业务拒绝映射为域错误码；持久性失败按内部错误传播。client connection fixture 以内存双实现该域，官方客户端测试通道无需宿主即可覆盖该面。

### Workbench 界面：Tasks 面板

`apps/desktop/workbench-plugin` 注册第三个 `conversation.view` 标签（`id: 'tasks'`，order 40）。面板经标准 JSON-RPC wire envelope 访问 `task.*`（`taskClient` fetch 封装，沿用 B3-P4 的 `fsClient` 模式），渲染：

- task 列表（打开中的 task；已归档 task 收进可折叠区段），带 `local` 模式徽章和工作目录缺失时的实时 `unavailable` 徽章；
- 当前 task 选择——条目级浏览 store（`deepseekgui.tasks.view.v1`），跨会话切换与面板重挂载存活；
- 每个 task 的详情：标题重命名（内联）、`workdir`/`repoRoot`、关联会话（点击经官方选择打开；每行 detach）、`在此任务新建会话`（官方 `session.create` RPC，`cwd: task.workdir`，然后打开）、`关联当前会话`（由宿主校验）与 `归档任务`；
- 创建表单（标题 + workdir 路径），失败时渲染 wire 消息。

面板除浏览选择外不持有任何 task 事实：每次变更都重新拉取宿主真相；不存在 Electron 或浏览器持久化（唯一持久化客户端状态是浏览 store，workspace browser 已有先例）。

### B4-P1 刻意不做

无 Git 写、无 worktree 创建、无 task prompt 或自动标题、无 task 状态机或队列、无第二 session store、无 `host/*` 变更帧（客户端在自身变更后刷新）、无取消归档与 task 删除——各自等待对应 B4 阶段或有文档的消费方。

## 验证

- `packages/task/task/tests/task.spec.ts`（21）与 `invariant.spec.ts`（3）：只读 git 探测 mock 下的创建（断言精确 argv）、非仓库/git 不可用/路径缺失的无写入拒绝、列表顺序、重命名、归档幂等、带 cwd 校验的 attach/detach 与清晰的未知会话错误、外部删除目录后的 status、共享介质上的重启恢复、启动时过滤过期会话记账；invariant 伴随套件钉住缓存/表关系。
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（7）：真实 Session/Agent/Storage/Subprocess/Task 服务组装下的网关，配**真实 `git init` fixture**——create/list/get/rename/archive、子目录 repoRoot、非仓库与无效路径错误码、共享介质重启恢复、目录删除后的 unavailable、按 cwd attach/detach 真实会话的 `session-not-found`/`task-attach-mismatch`，以及原生会话存储的独立性。
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts`（11）：每个 task.* 方法加 `session.create` 透传的 wire envelope、payload 与错误码面。
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`（12，jsdom）：列表/状态渲染、选择、会话打开/detach/attach、归档、创建表单、已归档区段、注入的会话创建与变更错误渲染。
- `apply.client.spec.ts` 扩展到八个 slot 贡献（含 Tasks 标签）。
- 聚焦 `tsc -b`：task、apiproxy、connection 与 workbench 插件。

## 备选方案

**Client runtime TaskRuntime 投影。** workspace 模式（runtime 域 + 列表基线 + 变更帧）对 B4-P1 过重：spike 只需要一个变更后重新拉取的面板，B4-P2 的 Git read model 将决定实时投影形态。`fsClient` 式直连 wire 客户端让 B4-P1 保持最小，且不预判该决策。

**经另一机制做 Git 探测。** subprocess seam 是 harness 的唯一执行世界；在别处探测（Electron exec、裸 `child_process`）会绕过 provider 与策略语义。

**注册表级显示顺序与归档集合。** task 列表从记录时间戳推导、归档是记录标志；第二张顺序/归档表会复制记录已拥有的状态。

**为 task 加宿主变更帧。** unary 响应已回显完整更新后的 task；在多界面消费方（B4-P8 通知）出现前，帧系统是未被请求的第二通道。

## 后果

web profile 组合新增 `@deepseek-ai/dsh-task`（宿主）与网关的 `task.*` 域；Workbench 新增 Tasks 标签，其事实全部位于宿主注册表。task 创建付出一次有界的只读 `git` 探测。会话 attach 以 task workdir 校验 cwd，在其他目录创建的会话会清晰失败而不是静默漂移。B3 workspace/session 界面不受影响：关闭 Tasks 面板或进入 Compatibility View 后，原生 Workspace/Session 使用完全独立。B4-P2 的 Git read model 与 B4-P3 的 worktree 生命周期在该记录之上构建，无需 schema 重写（模式联合已是持久形态）。
