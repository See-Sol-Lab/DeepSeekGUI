---
description: "面向通过 subprocess seam 以系统 git 执行 ctx.git 契约的开发者，以及其稳定机器命令格式维护者的本地 git 提供方说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-git-local

[English](README.md) | 中文

## 概述

[git capability seam](../git/README.zh.md)（`ctx.git`）的本地实现：经 subprocess seam 提供仓库事实——系统 git、精确 executable + argv、绝不用 shell 字符串、有界收集输出、只用稳定机器格式。机器格式解析器位于 `src/parse.ts`（纯函数）：porcelain v2 status（`--porcelain=v2 --branch -z`，含 NUL 结尾的 header）、worktree porcelain、name-status -z 与 numstat -z。

## 目录

- [结构](#shape)
- [失败分类](#failure-classification)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="shape"></a>
## 结构

- 服务生命周期内解析一次 `git`，并验证一次版本（`git --version`，porcelain v2 底线 2.11）；后续查询信任结果。
- 每个查询先探测 `repoIdentity`，使非仓库目录在任何命令运行前就以 `GitNotARepositoryError` 失败。
- 每条本地命令带 30 秒超时、5 秒终止宽限、4 MiB 收集输出上限与有界 stderr 捕获；`ls-remote` 为 60 秒、`push` 为 10 分钟，因为它们要等网络。被超时杀掉的命令没有退出码，按「已终止」报告，绝不报成拒绝。截断的列表以 `GitDiffTooLargeError` 整体拒绝，绝不返回部分结果。
- 版本探测在 harness cwd 运行；每个查询在调用方的工作目录运行。
- `worktreeAdd(cwd, path, branch)` 与 `worktreeRemove(cwd, path)`（B4-P3）——`git worktree add -q -b <branch> <path>` 与 `git worktree remove <path>`，供托管 worktree 的 task 生命周期消费。绝不传 `--force`；重复分支与脏工作树由 git 自己拒绝。
- Index/revert 操作（B4-P4）：`applyIndexPatch(cwd, patch, reverse)` 经 subprocess stdin 把 patch 喂给 `git apply --cached [--reverse] -`；`stageFile(cwd, path)` 执行 `git add -- <path>`（含 rename 两侧）；`unstageFile(cwd, path)` 反向应用它自己生成的 staged diff（`git diff --cached --binary`，含 rename 两侧），使 index 回退向 HEAD 而工作树不受影响；`revertFile(cwd, path)` 执行 `git checkout -- <path>`，并以 `GitRevertRefusedError` 预先拒绝未跟踪与冲突路径。每次写入在语义需要处重新验证权威 status（rename 对、revert 前置条件）。
- Commit 操作（B4-P5）：`authorIdentity(cwd)` 读取 `git var GIT_AUTHOR_IDENT`（未配置时返回 undefined）；`stagedTree(cwd)` 执行 `git write-tree`；`commit(cwd, message, expectedTree)` 依次检查冲突、空 index、身份与 staged tree 漂移（拒绝时不写任何东西），然后执行 `git commit -F -`（message 经 stdin）。提交后再次执行 `git rev-parse HEAD^{tree}` 与 `expectedTree` 比对：返回的 `{ sha, treeMatchesExpected }` 把检查与提交之间的窗口大声报出，而不是静默放行。每条写入都走同一有界 subprocess 纪律。
- Push 操作解析一个生效推送 URL，以 git check-ref-format 校验分支名称。预览使用请求指定的源和目标；本地有目标对象时才提供精确差集，否则给出候选历史。Push 向 refs/heads/<destination> 发送解析后的提交，不接受 force/delete 语法，并拒绝批准后的源或 URL 漂移。多个推送 URL 要求显式选择配置；推送成功后会把远端跟踪引用（`refs/remotes/<remote>/<destination>`）推进到已推送的提交，与 git 经远端名推送时的记账一致；按精确 URL 推送若不补这一步，status 会一直报告领先直到下次 fetch。GitPushRefusedError 保留拒绝分类，不修改 upstream，也不重试。

-----

<a id="failure-classification"></a>
## 失败分类

见 [seam README](../git/README.zh.md#failure-classification)：不可用、非仓库、版本不支持、命令失败（呈现原始 stderr，绝不解析）与过大。

-----

<a id="model-experience"></a>
## 模型体验

无——本 provider 提供与 seam 相同的只读事实：无工具、无提示词、无会话事件。

#### KV Cache 影响

与实时请求无关：provider 不向请求前缀添加任何内容，因此不会使提供方缓存复用失效。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- **有界写面**——status/diff/identity 查询只读；仅有的写入是 worktree 生命周期、B4-P4 的 index/revert 操作与 B4-P5 的受控 commit。push 属于后续 B4 阶段。
- **Windows 路径风格**——git 以正斜杠报告路径；provider 原样呈现（Git 自己的拼写），不做重写。
- **无锁/权限分类**——这些失败以 `GitCommandFailedError` 携带原始 stderr 与退出码呈现。
- **无自动解冲突**——revert 拒绝冲突条目、commit 拒绝冲突的 index；任何地方都没有未跟踪文件删除、`clean` 或 `reset --hard`。

**运行时不变式：** 不发布伴生入口。每个查询都是 Git 事实的只读投影、失败在 seam 处分类；本提供方没有独立的事件序列或可变数据关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包由 DeepSeekGUI 自有，上游没有对应物。自 B5-P4 起它的唯一消费方是 coding-tools 插件——由该插件注册调用本 seam 的 DSH 工具，已退役的 Task capability 不再夹在中间。

</details>

文件操作按字面匹配路径。还原可以比较已批准补丁，推送验证精确目标的不可读证明。公开的远端 URL 和命令错误会隐藏凭据；超时保持失败状态。
