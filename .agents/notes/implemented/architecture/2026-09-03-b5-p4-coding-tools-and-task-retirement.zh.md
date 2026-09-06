# Agent Note: B5-P4 — 编码动作工具化与 task 退役

Status: implemented

[English](2026-09-03-b5-p4-coding-tools-and-task-retirement.md) | 中文

## 问题

B4 的编码动作活在 GUI 面板与 APIProxy RPC 面之后（B5-P1 已退役）；dsh 0.1.2 把编码动作建模为同一 Agent 循环内的工具——参数与结果进 Session log、审批在动作边界。B5-P4 在既有 git 与 pull-request capability 之上注册最小真实 coding 工具集，并退役已无调用方的 task 机制。

## 决策

- 新插件 `apps/desktop/coding-tools-plugin`（`@see-sol-lab/deepseekgui-coding-tools`）随 web-app bundle 层发行（替换已退役的 task 行）：11 个工具——`git_status`、`git_diff`、`git_stage`、`git_unstage`、`git_revert`、`git_commit`、`git_push_preview`、`git_push`、`pr_availability`、`pr_existing`、`pr_create`。
- 每个工具只调用既有 capability（`ctx.git` / `ctx.pullRequest`），不重写任何 git/进程/provider 逻辑。结果即 capability 的 canonical 机器值；`output.render` 产出模型向文本，generic presenter 保持回放安全（只用 args）。
- 写操作解析会话策略与规范化仓库根目录；read-only 拒绝，workspace-write 仅接受官方策略授权的根目录。破坏性或外部操作还请求官方审批。Commit 在审批前捕获暂存树；push 预览指定分支、源提交和有效推送 URL，并拒绝审批后的源或目标漂移。引用名称不能携带 force/delete 语法，取消或缺少审批时拒绝执行。
- task 退役：`packages/task`、其 web-app bundle 行与依赖、子系统文档（`task.md`/`task.zh.md`）与生成器图节点在同一变更中删除；git/pull-request capability 与其 provider 行保留（工具消费它们）。

## 备选方案

- 在 GUI 里重建编码动作面板并直接调用 capability（agent 循环之外的第二条执行总线）；否决——动作保持为 DSH 工具、结果入日志。
- 把 task 表保留为新工具的记账层（已无调用方、第二事实源）；否决——task 机制随同变更删除。
- 允许只读工具跳过审批门（读便宜、边界弱）；否决——写动作保持官方审批边界并 fail closed。

## 验证

- `tsc -b apps/desktop/coding-tools-plugin` 干净；12 项聚焦单测通过（注册面、capability 调用、会话 cwd 回退、只读拒绝、任何 git 写前审批拒绝、PR 护栏）。
- 带 coding-tools 行的真实 dsh 0.1.2 服务启动无 loader 错误。

## 影响

- B4 的 task 记录/worktree 记账路径已消失；worktree 生命周期原语留在 git seam 上，供用户或 Agent 明确选择的动作。模型驱动的端到端验证（模型 → 工具 → 结果 → 下一轮）需要 API key，像 B5-P3 一样落在验收环境。
