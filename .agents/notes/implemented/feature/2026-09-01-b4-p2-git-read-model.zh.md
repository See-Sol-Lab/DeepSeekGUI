# Agent Note: B4-P2 Git Read Model——只读 Git capability 与 Repository Changes 面板

状态：已实现

[English](2026-09-01-b4-p2-git-read-model.md) | 中文

## 问题

B4 的日常编码界面需要仓库事实——identity、HEAD/分支/upstream、worktree、status 与 diff——与 B3 的会话归属 Changes 面板并列呈现，Git 是唯一 owner，且没有第二份 Git 数据库。B4-P2 必须建立可替换的 Git capability（Service Definition + Local Provider + Workbench Consumer），使用精确系统 git argv 与稳定机器格式，只在视图打开、操作完成或显式刷新时读取——无 watcher、无 Electron exec、无 shell 字符串、不猜英文 stderr。

## 决策

### git seam：`@deepseek-ai/dsh-git`（`ctx.git`）+ `@deepseek-ai/dsh-git-local`

仿 subprocess 拆分的新宿主侧能力 seam：Service Definition（`GitCapability`，`ctx.git`）声明六个只读查询；本地 provider 经 `ctx.subprocess` 以精确 executable + argv（绝不用 shell 字符串）、有界收集输出、30 秒查询截止与 5 秒终止宽限执行系统 git。

- `repoIdentity(cwd)`——一次 `git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository`。
- `head(cwd)`——`git branch --show-current` 加 `git rev-parse HEAD`：分支、游离或未出生。
- `upstream(cwd)`——`git rev-parse --abbrev-ref --symbolic-full-name @{u}` 加 `git rev-list --left-right --count @{u}...HEAD`；确定性 128 拒绝映射为 `undefined`（无 upstream），其余失败原样传播。
- `worktrees(cwd)`——`git worktree list --porcelain`。
- `status(cwd)`——`git status --porcelain=v2 --branch -z`，由 `src/parse.ts` 的纯函数解析（`-z` 下 header 也是 NUL 结尾；`2` rename 记录的原路径是第二个 NUL 字段）。
- `diff(cwd, scope, path?, wantPatch?, patchMaxBytes?)`——`git diff [--cached] --name-status -z` 加 `--numstat -z` 按路径合并（状态字母、行数、binary 事实）；请求的 patch 超过上限（默认 512 KiB）时以 `GitDiffTooLargeError` 整体拒绝。

每个查询先探测 `repoIdentity`，非仓库目录在任何命令运行前就以 `GitNotARepositoryError` 失败。provider 在服务生命周期内解析一次 `git` 并验证一次版本（`git --version`，porcelain-v2 底线 2.11）。失败只按可验证事实分类：不可用（解析/启动）、非仓库（探测 exit 128）、版本不支持（版本解析）、命令失败（任何其他非零退出——携带精确 argv、cwd、退出码与原始 stderr 原文，绝不解析）与过大。锁、权限与配置失败都以原始文本落入 `GitCommandFailedError`。

### 线域：`git.*`

API 网关新增闭式 `git.*` 域——`repo`、`status`、`diff`——含 wire schema、`RpcMethodMap` 行、fetch carrier 对与四个新错误码（`git-not-repository`、`git-unsupported-version`、`git-command-failed`、`git-too-large`；`git-unavailable` 沿用 B4-P1 的 `{ workdir }` details 形状）。`git.repo` 并行扇出 identity/head/upstream/worktrees。client connection fixture 与两个测试 fake-API 客户端以内存双实现该域。

### Workbench 界面：Repository Changes 面板

`apps/desktop/workbench-plugin` 注册第四个 `conversation.view` 标签（`id: 'repo'`，order 50）。面板读取当前会话 cwd，仅在打开与显式刷新时（代际守卫加载，无轮询）经 `gitClient` wire 封装拉取 repo bundle 与 status。渲染：

- 分支/游离/未出生徽章、带 ahead/behind 的 upstream ref、干净徽章与仓库根；
- 条目按冲突/已暂存/未暂存/未跟踪分组，带 XY 状态码与 rename 箭头；
- 选中后的逐文件 diff 视图，可切换已暂存/未暂存 scope 与 patch（或过大/空状态）；
- 常驻来源标签——「来源：Git 工作树」——使面板明确与 B3 Changes 面板（来源为会话事件）并列而不同；这里的内容绝不归因于任何 Session。

面板自身不持有仓库状态；B4-P2 全程不存在写路径（无 stage/revert/commit/push）。

## 验证

- `packages/git/git-local/tests/parse.spec.ts`（12）：porcelain v2 记录（staged/unstaged/untracked/conflict/rename、NUL 结尾 header、detached/unborn head）、worktree porcelain、name-status -z、numstat -z 与合并 helper。
- `packages/git/git-local/tests/parse-real.spec.ts`（8，真实命令捕获）：解析器输入字节来自实际 `git` stdout——clean/mixed/rename/conflict/binary 仓库的 status、worktree porcelain、name-status/numstat diff 字节与版本行——绝不来自手写 mock 记录。手写 mock 与错误解析器会互相掩护；真实字节不会（评审纪律，延续到后续阶段：凡解析外部格式，测试 fixture 必须从真实命令捕获，不得手写）。
- `packages/git/git-local/tests/provider.spec.ts`（6，脚本化 subprocess）：每查询精确 argv、不可用/版本不支持/非仓库/命令失败分类、upstream 缺失的 128 处理与 cwd 纪律。
- `packages/git/git-local/tests/local.spec.ts`（11，真实临时仓库）：identity、非仓库拒绝、分支/游离/未出生 head、带 ahead/behind 的 upstream、status 各面（staged/unstaged/untracked、`2 RM` rename 加修改、add/add 冲突）、binary 文件、worktree、带 patch 的 staged/unstaged diff、过大 patch 拒绝与 submodule gitlink 变更。
- `packages/host/apiproxy/tests/api-proxy-git.spec.ts`（4，真实网关 + 真实仓库）：repo bundle、status 分组、带 patch 的 diff 与非仓库错误码。
- `apps/desktop/workbench-plugin/tests/git-client.spec.ts`（6）：三个 git.* 方法的 wire envelope、payload 与错误码。
- `apps/desktop/workbench-plugin/tests/repo-changes-view.client.spec.tsx`（6，jsdom）：空状态、bundle/status 加载、分组条目、逐文件 diff 选择、非仓库错误与游离徽章。
- `apply.client.spec.ts` 扩展到九个 slot 贡献（含 Repository 标签）。

## 备选方案

**第二份 Git 状态层。** 读模型直接投影 Git 的机器格式；缓存、索引或数据库只会复制唯一 owner 并漂移。

**分类 stderr 文本。** 锁/权限/配置失败改为携带原始 stderr 与退出码呈现——按 B4-P2 边界，可操作且不猜英文文本。

**仓库 watcher。** 查询只在视图打开、操作后或显式刷新时运行；watcher 是 B4-P2 明确不建的后台进程。

**并入 B3 Changes 面板。** Session Changes 回答「这个 Session 做过什么」（会话事件）；Repository Changes 回答「工作树现在是什么」（Git）。两个带来源标签的面板让事实诚实，绝不把人工改动归给会话。

## 后果

web profile 组合新增 `@deepseek-ai/dsh-git-local`（宿主）与网关的 `git.*` 域；Workbench 新增 Repository Changes 标签，其事实全部位于 Git。每个查询付出一次有界只读 git 调用加 identity 探测。Windows 的 git 路径拼写（正斜杠）作为 Git 自身的事实原样呈现。B4-P3 的 worktree 生命周期与 B4-P4 的 index 操作在同一 seam 上构建——capability 已是可替换的，读模型的失败词汇原样延续。
