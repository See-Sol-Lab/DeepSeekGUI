# Agent Note: B4-P8 Background Work, Review & Notifications —— 聚合官方投影、一次性事件驱动通知

Status: implemented

[English](2026-09-02-b4-p8-background-review-notifications.md) | 中文

## Problem

B4-P7 给了每个任务终端、服务与锚定 workdir 的浏览器；但任务的日常闭环里，后台事实（jobs、subagents、goal、plan、todos、审批）仍散落在官方逐会话 UI 中，长跑工作也没有窗口之外的触达方式。P8 必须把现有 Harness 能力组织成 Task 级视图而不把任何 capability 状态复制进任务记录；Review 队列只引用 Repository Changes、验证、commit/PR 与待审批；权威的完成/失败/审批事件变成桌面通知——不重复、点击回到准确会话。

## Decision

### Task 页面：按关联 Session 聚合官方投影

Tasks 面板展开详情新增「后台工作」区（`TaskBackgroundWork`），每个关联会话一行。所有事实都经框架 `useSessions` 席位读官方 client-runtime 列表 store——不复制进任务记录、不轮询：jobs（`jobsBySession`）、subagents（`subagentsByParent`）、待交互标记（`pendingInteraction`：approval / plan-review）、以及经列表行 `projectionValues` 的宿主投影（goal 阶段+目标、plan active/pending、todo 完成/总数）。重连/重启后由各官方 owner 重建。Workflow 运行与交付物是逐 turn 的 chat 数据、由官方会话视图渲染，因此聚合行就是入口：点击行打开该会话，官方组件在那里。已离开官方列表的会话渲染原始 id 与「已不在列表中」徽章——绝不猜状态。

### Review 队列：只引用，打开时读取

新增 `conversation.view` tab（`review`，与 Tasks 共享选择 store），列出每个打开任务且只显示其名字承诺的事实：Repository Changes 来自 `git.status`（冲突数优先，其次 staged/unstaged/untracked）；最新验证结果来自新 RPC `task.validationRuns`（按动作、取自进程 owner 的运行表——settled run 保留到同动作下一次运行或任务归档；宿主重启后该列如实显示「尚无运行记录」）；commit 与 PR 引用来自任务记录；待审批来自官方会话投影。打开与显式刷新时读取；一行失败只降级该行，绝不拖垮队列。点击行在共享 store 选中该任务，Commit/Push 面板随即承接。

### 验证运行表：为 Review 队列保留

网关的 `validationRuns` 表新增任务/动作身份与结算事实（`exitCode`/`signal`/`timedOut`/`error`，由 handle 的 done promise 独立于任何流更新），settled run 保留到同动作下一次启动或任务归档——与 P7 服务表同一生命周期。关闭验证流仍终止运行中的进程树（绝不留孤儿），但不再删除 run；`task.archive` 现在终止并等待运行中验证、随服务清理一起丢弃该任务的 run 事实。

### Desktop 通知：权威事件、去重、聚焦门控、点击回会话

新 `harness-events` 客户端消费官方 `events.mux` 与 `events.host` 两条 SSE 流（窄解析 `session/jobs`、`approval/requested`、`host/agent-error`；其余帧忽略，畸形帧 fail closed）。新 `notification-service` 把它们转成一次性请求：每个会话的第一份 `session/jobs` 快照只是基线、绝不通知（重连重放因此不会误报）；只有状态变迁进入 `completed`/`failed` 才按 job id 各通知一次（`killed` 保持安静——显式终止是已知的）；审批按 approval id 只通知一次（mux 重放 pending approvals 被去重）；`host/agent-error` 按会话+消息在冷却窗口内去重。记忆是桌面侧小文件（丢失最坏多一条通知，绝非数据损失），重启/重连后的重放保持安静。main 只在 harness 处于 running 相位时连接事件流，其余相位一律断开，传输失败后限时重连——通知是增强，绝不是状态来源。主窗可见且聚焦时跳过系统通知（用户正看着官方 UI）；点击通知聚焦窗口并把一次性 `navigateRequest { sessionId, nonce }` 写进控制模型，Workbench 侧栏动作经既有模型轮询消费（每个 nonce 一次）并以官方 `sessions.open` 打开该会话。Compatibility View 没有 Workbench 插件，只收到聚焦。

### Unarchive：只反转导航

`task.unarchive` 持久且幂等地把 `open` 翻回 `true`——归档只隐藏导航，所以反归档恰好反转这一个旗标：Git、会话、进程事实一概不动（归档本身已对该任务的 services 与 validations 执行 kill → await exit 清理）。归档区每行新增「恢复任务」按钮；wire 新增 `task.unarchive`。

## Verification

- `packages/task/task/tests/task.spec.ts`：unarchive 持久化、workdir/身份不变、幂等（无写、无时间戳）。
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（B4-P8 块）：wire 层 unarchive 含重启；`task.validationRuns` 按动作返回最新结算事实（通过/失败/timedOut、argv/cwd、新运行替换旧运行）；归档终止运行中验证并丢弃该任务 run 事实；P5 的流关闭测试更新为「保留 settled run」生命周期。
- `apps/desktop/tests/notification-service.spec.ts`（8 条）：基线永不通知；变迁才通知（completed/failed 各一次，killed/stopping 安静）；按会话隔离；approval id 去重；agent-error 冷却；记忆解析/序列化（坏形状回退空记忆）。
- `apps/desktop/tests/harness-events.spec.ts`（5 条）：mux jobs/approval 解析、host agent-error 解析、忽略无关帧、畸形帧 fail closed、HTTP 错误 reject、abort 驱动关闭。
- `apps/desktop/tests/control-model.spec.ts`：`navigateRequest` 透传与 null 默认。
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`：聚合行渲染官方 list store 的 jobs/subagents/goal/plan/todos/approval 投影；点击行打开会话；无会话提示；Restore 发出 `task.unarchive`。
- `apps/desktop/workbench-plugin/tests/review-view.client.spec.tsx`（4 条）：队列行引用 git status/验证/commit/PR/审批；clean + no-runs + no-commit + no-PR 状态；仓库读取失败只降级该行；点击行选中共享任务。
- `apps/desktop/workbench-plugin/tests/desktop-actions.client.spec.tsx`：navigateRequest 每个 nonce 打开一次会话；新 nonce 再次导航；无请求永不导航。
- `apply.client.spec.ts` 扩展到包含 Review tab 的十二个槽位贡献。

## Alternatives considered

**为任务页做宿主聚合 RPC。** `task.overview` 式投影会与官方 client-runtime 已维护的数据路径重复；列表 store 的 `jobsBySession`/`subagentsByParent`/`projectionValues` 就是官方逐会话投影，经唯一框架 hook 可读，且由各自 owner 在重连时重建。

**把通知记忆塞进 uiState。** UI state 是严格白名单 schema；通知记忆是丢失容忍的去重辅助，所以放在独立小文件里配宽松解析器，而不是撑大严格 schema。

**把 job 完成当增量事件。** 官方流以整份快照携带 `session/jobs`（注册表没有持久事件）；服务对快照与自身基线做 diff——这正是重连重放与重启安全的原因。

## Consequences

每个任务现在按关联会话聚合官方后台投影、零复制状态；Review 队列只引用具名 owner、从不轮询；桌面通知一次性、跨重连/重启去重、聚焦门控、经 nonce 守卫的导航请求点击直达准确会话。任务记录零新增字段；wire 新增 `task.unarchive` 与 `task.validationRuns`；网关运行表获得 Review 生命周期；桌面新增一个 SSE 客户端、一个通知状态机与一个模型字段。
