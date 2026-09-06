# Agent Note：B4-P3 本地/工作树 Task 生命周期——三种如实工作模式与一次显式托管工作树事务

Status: implemented

[English](2026-09-01-b4-p3-task-worktree-lifecycle.md) | 中文

## 问题

B4-P1 的 task 只指向用户当前检出。编码工作需要并行检出而不触碰用户的主工作树：GUI 必须创建、附加与移除 Git 工作树，每条都绑定一个 task 记录，仓库状态唯一归 Git 所有，任何地方都没有隐藏状态。生命周期必须如实呈现每一个失败（已创建但未记录的工作树、脏移除、GUI 之外被移除的工作树），从某个 task 检出交接给另一个 task 的会话必须经官方机制携带可见上下文——绝不改写 cwd，绝不复制隐藏对话记录。

## 决策

### git seam 增加它仅有的写入

`GitCapability`（Service Definition）与 `LocalGitCapability`（本地 provider）增加恰好两个写方法，都由 task 生命周期消费，拒绝逻辑都交给 git 自己：

- `worktreeAdd(cwd, path, branch)`——`git worktree add -q -b <branch> <path>`。已存在的分支以 `GitCommandFailedError` 携带原始 stderr 失败。
- `worktreeRemove(cwd, path)`——`git worktree remove <path>`，绝不带 `--force`；脏工作树由 git 拒绝，task 层在命令运行前就拒绝。

两者都走与每个读操作相同的有界 subprocess 纪律（30 秒截止、5 秒宽限、有界收集输出）。seam 的其余部分保持只读；stage/revert/commit/push 仍不在范围内。

### TaskRegistry：三种如实模式，一次显式事务

`TaskMode` 现在名副其实：`local`（用户检出）、`managed-worktree`（归 task 所有，经 git 能力创建与移除）、`attached-worktree`（仅引用；GUI 绝不删除——此模式不存在移除路径）。

`createManagedWorktree({ repoRoot, branch, path, title? })` 是一次显式事务，只覆盖本次调用能够识别到的资源：校验（分支非空白、路径绝对、路径经 `ctx.git.worktrees` 确认未注册、路径不存在）→ `ctx.git.worktreeAdd` → 记录写入。记录写入失败时回滚：移除本次调用创建的工作树；若回滚也失败，抛出的 `AggregateError` 指名孤儿路径，使其保持可识别。无 force、无 prune、无租约、无重试。

`createAttachedWorktree(workdir, title?)` 经 `ctx.git.worktrees` 验证目录是其仓库的已注册工作树，并拒绝主检出。主检出以 `git worktree list --porcelain` 的第一条记录识别（git-worktree(1) 记录了该顺序）——绝不从 `git rev-parse --show-toplevel` 识别，因为在 linked worktree 里该探测报告的是工作树自身，这让早期实现把每个附加工作树都误判为主检出。记录的 `repoRoot` 是主检出根，由仓库的所有 task 共享。

`removeManagedWorktree(taskId)` 按以下顺序检查，任一失败即拒绝——什么都不删、记录保留：task 存在、模式为 `managed-worktree`（`TaskWorktreeNotManagedError`）、工作树仍在注册表中（GUI 之外被移除时为 `TaskWorktreeNotFoundError`——task 随后报告 `missing-dir`）、status 干净（`TaskWorktreeDirtyError`）、且没有附加会话在运行（`TaskWorktreeBusyError`，经 `ctx.get('sessions')` 读取）。移除后记录保留供用户归档；不存在 task 删除路径。崩溃后的再对齐不需要租约或修复：task 记录与 Git 工作树事实各自独立存活，每次移除都在行动前重新验证实时事实。

### wire 域与 Workbench 界面

网关增加 `task.createManaged`、`task.createAttached` 与 `task.removeManagedWorktree`，带五个新错误码（`task-worktree-conflict`、`task-worktree-dirty`、`task-worktree-busy`、`task-worktree-not-managed`、`task-worktree-not-found`）；git 能力的拒绝经共享的 git 域错误码映射。connection fixture 与两个测试 fake-API 客户端镜像该域。

Workbench Tasks 面板增加三模式创建表单（local / managed-worktree / attached-worktree，各模式字段不同）、每行模式徽章、托管 task 的移除按钮（仅在目录存在时），以及每个 task 的交接按钮。交接只用官方可见机制：`session.create({ cwd: task.workdir })` 在目标检出创建新会话，随后 `session.prompt` 以普通模型可见用户消息投递显式交接消息（目标 task 标题、工作目录、来源会话标题）。旧会话的 cwd 绝不改动，绝不复制隐藏对话记录；交接文本属于新会话自己的日志。

## 验证

- `packages/task/task/tests/task-worktree.spec.ts`（11 个，真实临时仓库）：托管创建记录真实 Git 事实；同一仓库两个并行工作树；路径已存在/已注册/相对路径拒绝；记录写入失败回滚（已创建工作树再次消失）；附加现有工作树；主检出与非工作树拒绝；干净移除（记录保留、`missing-dir`）；脏拒绝；运行中会话拒绝（detach 后解除）；工作树在 GUI 之外被移除时拒绝移除；重启再对齐后移除。
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（14 个，真实 gateway + 真实仓库，含 B4-P3 块）：经 wire 的托管创建与真实 Git 事实；冲突/相对路径/空白分支/重复分支错误码；附加创建、主检出/非工作树/仓库外目录错误码与 not-managed 移除码；干净移除、脏与外部移除拒绝、运行中会话拒绝；重启再对齐。
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts`（20 个）：三个新方法的 wire 信封与错误码，以及 `promptSession` 与 `handoffSessionToTask` 序列（先 session.create 再带交接文本的 session.prompt）。
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`（jsdom）：托管/附加创建表单、模式徽章、移除按钮可见性规则、移除调用与交接序列。
- 机器相关性修复：开发机的主目录在本阶段中途意外变成了 Git 仓库（一个无提交的空 `.git`，由外部工具创建，不属于本项目）。临时根目录因此位于仓库之内，破坏了所有「仓库之外」用例。测试现在用 `GIT_CEILING_DIRECTORIES` 把发现限制在临时根（经 `vi.stubEnv` 设置；上限经继承的环境到达 spawn 出的 git），使「仓库之外」在任何机器上都确定成立。误入的主目录 `.git` 保持原样（用户数据）。
- B4-P2 评审确立的 mock 诚实纪律延续：worktree porcelain 解析器的 fixture 来自真实 `git worktree list` 输出（parse-real.spec.ts），绝不手写字节。

## 备选方案

**强制移除脏工作树。** `git worktree remove --force` 会销毁未提交的用户工作；task 层在询问 git 之前就拒绝脏移除，seam 在任何地方都不传 `--force`。

**交接时复用旧会话。** 改写旧会话的 cwd 会重写会话日志已记录的历史；把其对话记录复制进新会话会在日志之外复制模型可见内容。在目标 cwd 建新会话加一条显式、已记录的交接消息，是让每个事实留在其所属日志中的唯一机制。

**启动时剪除或修复。** GUI 之外被移除的工作树让 task 记录报告 `missing-dir`；由用户归档。租约、watchdog 或自动修复会猜测用户意图；再对齐只是每次操作前对实时 Git 事实的重新验证。

## 后果

web profile 的 task 域与 Workbench Tasks 面板现在覆盖全部三种工作模式；git seam 的写面恰好是两个 worktree 生命周期方法，别无其他。每条移除路径都在行动前重新验证脏/运行/所有权事实，因此过期记录绝不会造成数据丢失或意外的 git 失败。交接是新会话中的普通已记录用户消息。B4-P4 的索引操作（stage/revert）扩展同一 seam，其读模型失败词汇原样延续。
