# Agent Note：B4-P6 Push 与 Pull Request——基于既有 Git/gh 登录态的预览式外部写入

Status: implemented

[English](2026-09-01-b4-p6-push-pull-request.md) | 中文

## 问题

B4-P5 在本地提交；发布仍要求用户离开 GUI。Push 与 Pull Request 是带各自失败词汇（认证、保护分支、远端迁移、重复创建）的外部写入，且产品绝不能持有第二份凭据。Push 页需要用户确认的每个事实——remote URL、local/remote ref、ahead 提交、是否新分支——PR 路径需要复用用户既有登录态的 provider capability。

## 决策

### Push：预览后分类的显式外部写入

git seam 增加 `remotes(cwd)`（`git remote -v`，tab 分隔所以含空格的 URL 也能解析）、`pushPreview(cwd, remote)` 与 `push(cwd, remote, localBranch, remoteBranch)`。预览只组装事实：remote URL、本地分支与其目标远端 ref、ahead 提交（`upstream..HEAD`；无 upstream 时为本地全部分支提交）、远端 ref 是否存在（`git ls-remote --symref`；远端不可达时预览降级为本地事实，`remoteRefExists: undefined`，绝不猜测）、远端默认分支，以及生效的 `credential.helper`——认证来源，绝不是 token。`push` 执行 `git push <remote> <local>:<remoteBranch>`，并按 git 自身 stderr 词汇把拒绝分类为 `GitPushRefusedError`（`non-fast-forward`、`protected`、`auth`、`not-found`、`network`、`rejected`——原始 stderr 始终随附）；未配置的 remote 在任何网络写入前以 `GitNoSuchRemoteError` 失败。push 绝不触碰 upstream 配置，任何情况都不重试，任何地方都没有 force push。

### Pull Request：基于既有登录态的独立 provider capability

新的能力对——[dsh-pull-request](../../../../packages/pull-request/pull-request/README.zh.md) Service Definition（`ctx.pullRequest`）与首个本地 provider [dsh-pull-request-gh](../../../../packages/pull-request/pull-request-gh/README.zh.md)——经 subprocess seam 以精确 executable + argv 复用用户已登录的 `gh`。`availability(cwd)` 运行 `gh auth status`，只报告 host 与账号——两个方向都绝不报告 token；登录态完全活在 gh 自己的配置里。`existing(cwd, head)`（`gh pr list --head … --state all`）是创建前展示的重复创建护栏；`create(cwd, { title, body, base, head, draft })` 运行 `gh pr create`，每个字段原样经 argv 传递（绝无 shell 解释；draft 是标志位），并按 gh 自身 stderr 分类失败（`already-exists` 并提取既有 PR 的 URL、`auth`、`other`）。

### task 只记录引用

成功后 task 盖上 `lastPullRequest`（`recordPullRequest`）——URL 与 number，是平台持有对象的引用；PR 的 title/body/base/head 留在平台。wire 暴露 `task.remotes` / `task.pushPreview` / `task.push` / `task.recordPullRequest` 与平行的 `pr.availability` / `pr.existing` / `pr.create` 域；错误码 `git-push-refused`、`git-no-remote`、`pr-unavailable`、`pr-failed`。

## 验证

- `packages/git/git-local/tests/push.spec.ts`（10 个，真实仓库 + 真实 bare remote）：新分支预览与 push（远端确实持有推送的 SHA，upstream 配置不被触碰）；credential helper 作为认证来源；带 upstream 的 fast-forward 且推送后 ahead 清空；non-fast-forward 拒绝（两个 clone 分叉）；pre-receive hook 拒绝为 `protected`；远端仓库缺失为 `not-found`；未配置 remote 在任何网络写入前拒绝；远端不可达时预览降级为本地事实；detached HEAD 预览拒绝；分类函数覆盖 git 的 stderr 词汇。
- `packages/pull-request/pull-request-gh/tests/gh.spec.ts`（11 个，驱动的假 subprocess——无网络、无登录）：availability 已登录/未登录/缺 gh（只报告登录事实，绝不报告 token）；重复护栏；create 的精确 argv（中文标题、多行正文、draft 标志位位置断言）；重复分类并提取既有 URL；auth 与泛型失败携带原始 stderr。
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts`（push 块）：真实 bare remote 上的 remotes/预览/push 与 wire 错误码；`recordPullRequest` 重启后仍在。
- `packages/host/apiproxy/tests/api-proxy-pr.spec.ts`：假 provider 上的 pr 域——availability、重复护栏、create，以及 `pr-failed` / `pr-unavailable` 映射。
- `apps/desktop/workbench-plugin/tests/push-view.client.spec.tsx`（jsdom）：预览事实；确认后才推送且载荷为确认的 refs；分类的 push 拒绝；provider 登录事实（绝不报告 token）；未登录提示；完整 PR 预览与 create 载荷断言及引用记录；重复护栏阻止创建。
- `apply.client.spec.ts` 扩展到含 Push 标签的十一个 slot 贡献。

## 备选方案

**读取或持久化 token。** 产品不读任何凭据：git 用自己的 credential helper，gh 用自己的配置/keyring；预览显示 helper 名，availability 报告 host/账号——仅此而已。第二份凭据存储会违反 B4 非目标与「仓库内无凭据」的验收。

**直接向平台 API 发请求创建 PR。** provider capability 配合已登录 `gh` 以零新增凭据面复用既有登录态；裸 API 客户端需要一个产品绝不能持有的 token。

**从 stderr 文本猜测 push 失败。** 失败只按 git 自身稳定 stderr 词汇分类为六个具名原因；其余一律是带原始 stderr 原文的泛型拒绝——失败绝不被包装成别的样子，任何情况都不重试。

## 后果

Push 与 Pull Request 是显式、预览式的外部写入：任何字节离开机器前，用户都确认 refs、提交、认证来源与完整 PR 字段（title/body/base/head/draft）。git seam 的写入词汇恰好增加显式 push；pull-request capability 可插拔 provider，登录态留在它该在的地方。task 记录只多了一个引用字段，没有凭据也没有 PR 内容。重复护栏、保护分支拒绝、远端迁移/不可达全部明确失败；验收路径是在显式用户授权下完成一次真实新分支 push 加一个真实 draft PR。
