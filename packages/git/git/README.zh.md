---
description: "面向读取仓库事实（身份、HEAD、上游、工作树、status 与 diff）的开发者，以及受门控写入操作维护者的 ctx.git 能力契约说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git

[English](README.md) | 中文

## 概述

DeepSeek Harness 的 Git capability Service Definition（`ctx.git`，B4-P2 Git Read Model）：通过稳定机器格式提供仓库 identity、HEAD/分支/upstream、worktree 列表、status 与 diff 摘要，以及 B4-P3 的 worktree 生命周期写入、B4-P4 的 index/revert 操作与 B4-P5 的受控 commit。Git 拥有仓库；读模型绝不写入，seam 仅有的写入是 worktree 生命周期（`worktreeAdd`/`worktreeRemove`）、index 操作（`applyIndexPatch`、`stageFile`、`unstageFile`、`revertFile`）与受控 `commit`——任何地方都没有 push、clean 或 `reset --hard`。本地实现位于 [@deepseek-ai/dsh-git-local](../git-local/README.zh.md)，经 subprocess seam 以精确 executable + argv 执行系统 git，绝不用 shell 字符串。

## 目录

- [结构](#shape)
- [失败分类](#failure-classification)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="shape"></a>
## 结构

- `ctx.git.repoIdentity(cwd)`——`git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository`：规范根、绝对 git 目录与 bare 标志。仓库之外的目录以 `GitNotARepositoryError` 拒绝。
- `ctx.git.head(cwd)`——`git branch --show-current` 加 `git rev-parse HEAD`：分支、游离 oid 或未出生分支（尚无提交）。
- `ctx.git.upstream(cwd)`——`git rev-parse --abbrev-ref --symbolic-full-name @{u}` 加 `git rev-list --left-right --count @{u}...HEAD`：upstream ref 与 ahead/behind 计数，分支无 upstream 时（探测的确定性 128 拒绝）返回 `undefined`。
- `ctx.git.worktrees(cwd)`——`git worktree list --porcelain`：每个已注册 worktree 的 HEAD、分支、detached 与 bare 事实。
- `ctx.git.status(cwd)`——`git status --porcelain=v2 --branch -z`：clean/dirty 事实、HEAD header、带 ahead/behind 的 upstream，以及每个变更路径按 staged/unstaged/untracked/conflict 分类（rename 携带原路径与相似度分数）。
- `ctx.git.log(cwd, max)`——单元分隔格式的 `git log -n <max>`：最新的提交（sha、subject、author、committer 时间），最新在前；unborn 分支返回空列表。
- `ctx.git.diff(cwd, scope, path?, wantPatch?, patchMaxBytes?)`——`git diff [--cached] --name-status -z` 加 `--numstat -z`：逐文件状态、行数与 binary 事实；请求的 patch（以 `--binary` 生成，binary 文件因此携带 `git apply` 可消费的字面 patch）超过上限（默认 512 KiB）时以 `GitDiffTooLargeError` 整体拒绝。
- `ctx.git.worktreeAdd(cwd, path, branch)`（B4-P3）——`git worktree add -q -b <branch> <path>`：为托管 worktree 的 task 生命周期创建工作树。已存在的分支由 git 自己拒绝。
- `ctx.git.worktreeRemove(cwd, path)`（B4-P3）——`git worktree remove <path>`：移除已注册 worktree；脏工作树（已修改或未跟踪文件）由 git 自己拒绝。绝不传 `--force`。
- `ctx.git.applyIndexPatch(cwd, patch, reverse)`（B4-P4）——`git apply --cached [--reverse] -`，patch 经 subprocess stdin 投递：hunk stage/unstage 原语。patch 必须是 git-diff 事实（`diff` 产出的精确字节，或其 hunk 子集）；git 自己对照当前 index 验证上下文，因此 stale hunk 或外部变更的 index 以 `GitCommandFailedError` 携带原始 stderr 失败。工作树绝不被触碰。
- `ctx.git.stageFile(cwd, path)`（B4-P4）——`git add -- <path>`：整体暂存一个路径，包括未跟踪文件、binary 文件与 rename 的两侧。暂存未跟踪文件是允许的——B4 只拒绝删除未跟踪文件。
- `ctx.git.unstageFile(cwd, path)`（B4-P4）——将 staged diff（index 对照 HEAD，`--binary`，含 rename 两侧）反向应用到 index：index 回退向 HEAD，工作树不受影响。在未出生 HEAD 上可用；无 staged 变更的路径是 no-op。
- `ctx.git.revertFile(cwd, path)`（B4-P4）——`git checkout -- <path>`：从 index 恢复受跟踪的工作树文件，丢弃其未暂存修改；staged 变更保持 staged。未跟踪路径（B4 绝不还原或删除未跟踪文件）与未合并冲突条目（B4 绝不自动解冲突）以 `GitRevertRefusedError` 预先拒绝；git 自己的拒绝是兜底。调用方须先展示精确目标与将丢失内容并取得明确确认。
- `ctx.git.authorIdentity(cwd)`（B4-P5）——`git var GIT_AUTHOR_IDENT`：commit 实际会携带的作者身份（含环境覆盖），未配置任何身份时返回 `undefined`。
- `ctx.git.stagedTree(cwd)`（B4-P5）——`git write-tree`：index 当前的 tree oid——调用方的用户在确认 commit 前审查的快照。
- `ctx.git.commit(cwd, message, expectedTree)`（B4-P5）——`git commit -F -`，message 经 stdin 投递：受控 commit。按顺序检查、拒绝时不写任何东西：未解决冲突（`GitCommitRefusedError('conflict')`）、空 index（`GitCommitRefusedError('empty-index')`）、作者身份缺失（`GitCommitRefusedError('identity')`）、staged tree 漂移——index tree 必须等于用户审查的 `expectedTree`（`GitStagedTreeDriftError`；调用方重新展示 staged diff 并再次确认）。hook 拒绝或其他 git 失败以 `GitCommandFailedError` 携带原始 stderr 呈现。成功时返回 `{ sha, treeMatchesExpected }`：提交后再次把 HEAD 的 tree 与 `expectedTree` 比对，把漂移检查与提交之间的毫秒级窗口「大声报出」（`treeMatchesExpected: false`），而不是静默放行。
- `ctx.git.remotes(cwd)`（B4-P6）——`git remote -v`：每个已配置 remote 的 fetch/push URL。
- `ctx.git.pushPreview(cwd, remote, localBranch?, remoteBranch?)` 返回准确的源提交和生效推送 URL。省略分支时使用当前检出分支及其同名目标。本地有目标对象时，候选提交按目标与源比较；否则返回全部源历史，不代表准确 ahead 数量。远端不可达时 remoteRefExists 为 undefined，未配置远端时抛出 GitNoSuchRemoteError。
- `ctx.git.push(cwd, remote, localBranch, remoteBranch, expected?)` 向一个生效推送 URL 的完整分支引用发送解析后的提交，引用名称拒绝 force/delete 语法。传入已批准的 `{ sourceOid, destinationToken }` 会在写入前拒绝漂移。推送成功后同时推进该目标的远端跟踪引用，让 status 保持真实。GitPushRefusedError 对远端拒绝分类，不修改 upstream 配置，也不重试。

<a id="failure-classification"></a>

-----

<a id="failure-classification"></a>
## 失败分类

失败只按可验证事实分类，绝不猜测 stderr 文本：

- `GitUnavailableError`——git 可执行文件无法解析或启动。
- `GitNotARepositoryError`——仓库探测失败（exit 128）。
- `GitUnsupportedVersionError`——`git --version` 解析结果低于 porcelain-v2 底线（git >= 2.11）。
- `GitCommandFailedError`——任何其他非零退出；携带精确 argv、cwd、退出码与原始 stderr 原文供可操作诊断。锁、权限与配置失败都在这里带原文呈现。
- `GitDiffTooLargeError`——请求的 patch 超过大小上限。
- `GitRevertRefusedError`（B4-P4）——受控 revert 被预先拒绝：路径未跟踪或是未合并冲突条目。
- `GitCommitRefusedError`（B4-P5）——commit 被预先拒绝：未解决冲突、空 index 或作者身份缺失。
- `GitStagedTreeDriftError`（B4-P5）——index tree 不再等于用户审查的快照；提交前必须重新审查。
- `GitPushRefusedError`（B4-P6）——push 被远端或 git 自身拒绝，按 git 自身 stderr 词汇分类（`non-fast-forward`、`protected`、`auth`、`not-found`、`network`、`rejected`）；原始 stderr 始终随附。
- `GitNoSuchRemoteError`（B4-P6）——本仓库未配置该 remote 名。

-----

<a id="model-experience"></a>
## 模型体验

### 仓库事实

#### 模型看到的内容

没有。`ctx.git` 只向宿主侧消费方提供只读仓库事实：此包不注册工具、不注入提示词、不写入会话事件，因此没有请求字段会携带此包数据。

#### Token 影响

每个请求的直接 token 为零。

#### KV Cache 影响

与实时请求无关：此包绝不触及请求前缀，因此不会使提供方缓存复用失效。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- **有界写面**——status/diff/identity 查询绝不写入；seam 仅有的写入是 worktree 生命周期（`worktreeAdd`/`worktreeRemove`）与 B4-P4 的 index/revert 操作。commit/push 在后续 B4 阶段经同一 seam 到来。
- **锁/权限失败是呈现而非分类**——`GitCommandFailedError` 携带原始 stderr 与退出码供展示；seam 刻意不把 stderr 文本解析为状态。
- **大型 diff 有界**——status/diff 列表上限 4 MiB 输出，逐文件 patch 上限 512 KiB；超出即整体拒绝而非返回截断结果。
- **无变更帧**——seam 只查询；消费方在视图打开、自身操作后或显式刷新时加载（无 watcher、无轮询）。
- **worktree 移除绝不 force**——`worktreeRemove` 不传 `--force`；脏工作树保留（托管 worktree task 在命令运行前就已拒绝移除）。
- **revert 仅限受跟踪文件且绝不自动解冲突**——`revertFile` 拒绝未跟踪与冲突路径；任何地方都没有未跟踪文件删除、`clean` 或 `reset --hard`。

**运行时不变式：** 不发布伴生入口。仓库归 Git 所有，每个查询都是其事实的只读投影；本 seam 没有独立的事件序列或可变数据关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包由 DeepSeekGUI 自有，上游没有对应物。自 B5-P4 起它的唯一消费方是 coding-tools 插件——由该插件注册调用本 seam 的 DSH 工具，已退役的 Task capability 不再夹在中间。

</details>
