# Agent Note：B4-P5 验证与提交——显式 Task Actions 的流式运行与 tree 受控 commit

Status: implemented

[English](2026-09-01-b4-p5-validation-commit.md) | 中文

## 问题

B4-P4 管理了 index；提交仍要求用户离开 GUI。验证与提交需要成为一条可审查路径：task 拥有显式验证命令（绝不解析 shell 字符串），运行流式展示真实输出并如实报告取消/超时/exit 事实，Commit 页展示 staged diff、验证结果、作者身份与 message——只在显式确认后执行，并保证被提交的 tree 就是用户实际审查过的 tree。

## 决策

### Task Actions：精确 executable/argv/cwd，运行状态留在进程 owner

`TaskRecord` 增加 `actions`——用户显式配置的验证动作，每条是精确的 `{ name, executable, argv, cwd?, timeoutMs? }`（在 wire 边界校验非空；`cwd` 默认 task workdir）。`setActions` 持久整体替换列表；记录绝不持有运行状态——验证运行活在网关的运行表（`validationRuns`：runId → subprocess handle + 超时信号 + settled/streamOpened 标志），与 task 记录无键关联，随运行消亡。

`task.startValidation` 经 subprocess seam 以管道 stdout/stderr 与可选的 `AbortSignal.timeout` 上限 spawn 动作；`task.validationStream` 是专用 SSE 路由（`/api/task.validationStream?runId=…`），转发输出块并以一个 `validation/done` 帧结束，携带独立事实——`exitCode`、`signal`、`timedOut`（超时信号自身的事实，绝不推断）与 `error`（spawn 级失败如可执行文件缺失随 done 帧投递，UI 渲染「无法启动」，绝不渲染成「用户取消了」）。`task.cancelValidation` 终止进程树。任何路径都不留孤儿：关闭流会终止仍在运行的树（清理挂在请求信号上，而非仅靠 generator 收尾——未启动的 generator 的 `return()` 不会执行函数体，这是测试抓到的真实隐患）；被 abort 的 start 请求收割从未开流的 run（已 abort 的信号同步检查）；start 已返回但流未接上时 client 按 runId best-effort 取消。UI 边流式渲染输出边如实报告 exit 事实：失败运行显示退出码，超时运行显示自己的消息，取消的运行绝不被标成通过，启动失败也绝不被标成取消。

### 受控 commit

git seam 增加 `authorIdentity(cwd)`（`git var GIT_AUTHOR_IDENT`，未配置时 `undefined`）、`stagedTree(cwd)`（`git write-tree`）与 `commit(cwd, message, expectedTree)`（`git commit -F -`，message 经 stdin——任意字符安全，绝无 shell 解释）。`commit` 依次检查、拒绝时不写任何东西：未解决冲突（`GitCommitRefusedError('conflict')`）、空 index（`'empty-index'`）、作者身份缺失（`'identity'`）、staged tree 漂移——index tree 必须等于用户审查的 `expectedTree`（`GitStagedTreeDriftError`）。hook 拒绝或其他 git 失败以 `GitCommandFailedError` 携带原始 stderr 呈现。提交后再次把 HEAD 的 tree 与 `expectedTree` 比对：返回的 `{ sha, treeMatchesExpected }` 把漂移检查与提交之间毫秒级窗口大声报出，而不是静默放行。

Commit 页（`conversation.view` 的 `commit` 标签，与 Tasks 面板共享选择 store）渲染 `task.commitContext`：作者身份、被审查的 tree 快照、staged 路径与完整 patch（git-diff 事实），以及带拒绝原因的 readiness 判定——未就绪页面显示原因且没有确认路径。超过大小上限的 staged patch 降级为 `patchTooLarge`（patch 不随响应走；去 Repository 面板看），而不是让整个 context 失败——lockfile 级 diff 绝不会夺走提交能力。确认按钮在输入 message 前保持禁用；确认发送 message 与被审查的 tree；漂移以显式错误拒绝，页面重载新鲜上下文供重新审查。成功时 task 记录盖上 `lastCommitSha`——仅是引用，tree 与 message 留在 Git——且 SHA 反馈在提交后的上下文重载中保留（只在切换任务时清除）。

### 边界保持

任何地方都没有自动 stage all（Repository 面板仍是唯一暂存面）；失败的验证如实显示为失败，绝不隐藏；模型建议不是授权——确认是用户对展示精确 staged 内容的页面亲手点击。commit 拒绝冲突的 index，绝不运行 `clean`/`reset --hard`。

## 验证

- `packages/git/git-local/tests/commit.spec.ts`（6 个，真实仓库）：作者身份事实（已配置与未配置——未配置场景经 `HOME` 隔离全局配置）；经 stdin 投递含引号/中文的 message 成功提交并返回 SHA 且 `treeMatchesExpected: true`；空 index 与冲突拒绝（未提交任何东西）；身份拒绝；hook 拒绝携带原始 stderr；staged tree 漂移指名两个 tree，随后针对新 tree 重新审查后成功提交。
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（B4-P5 块，真实 gateway + 真实仓库 + 真实 spawn 进程）：setActions 持久化与未知动作错误码；真实 `node -e` 验证流式 stdout/stderr 块与 done 事实；commitContext + commit 成功并在 task 上盖 SHA 且 `treeMatchesExpected: true`；空 index 拒绝与漂移错误码；取消终止进程树并收到 done 帧；超时报告独立的 `timedOut` 事实；关闭流终止仍在运行的树（注册表移除该运行）；spawn 失败以带失败事实的 done 帧到达；start 请求在开流前被 abort 时 run 被收割（之后取消报「无可取消」）；超大 staged patch 降级为 `patchTooLarge` 且提交仍成功。
- `apps/desktop/workbench-plugin/tests/commit-view.client.spec.tsx`（jsdom）：无任务提示；作者/staged/patch 渲染；无确认路径的拒绝；输入 message 前确认禁用，随后 wire 携带 message + 被审查 tree；漂移作为显式错误并重载上下文；验证运行如实报告通过事实；提交后的上下文重载中 SHA 仍保留；spawn 失败渲染为错误而非取消；`patchTooLarge` 提示保留确认路径；`treeMatchesExpected: false` 警告大声渲染。
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`（jsdom，扩展）：添加验证动作保存精确 executable/argv 列表；运行一个动作并报告 exit 事实。
- `apply.client.spec.ts` 扩展到含 Commit 标签的十个 slot 贡献。

## 备选方案

**为 Task Actions 解析 shell 命令字符串。** 字符串招引引号 bug 与注入面；动作以精确 executable/argv 存储与 spawn，argv 作为独立参数输入。

**用 `git add -p` 式或 TTY 协议做验证。** subprocess seam 的管道流加 SSE 路由让 GUI 获得原始输出且不依赖终端，取消由 seam 按进程树执行。

**不做 tree 保护的提交。** 用户确认的 staged diff 可能已与 index 不符（外部编辑、另一 GUI 操作）；`expectedTree` 快照把漂移变成带显式重新审查消息的硬拒绝，而不是静默的意外提交。

**在 task 记录中持久化运行状态或 commit 内容。** 运行状态是进程 owner 状态并随运行消亡；commit 的 tree 与 message 留在 Git——记录只保留 SHA 引用。

## 后果

验证与提交成为一条可审查的 GUI 路径：显式动作、流式真实输出、如实的 exit 事实，以及只可能构建用户确认过的 tree 的提交。git seam 的写入词汇恰好增加受控 commit；push 留待后续阶段。task 记录增加了两个配置/引用字段,不含任何运行状态。
