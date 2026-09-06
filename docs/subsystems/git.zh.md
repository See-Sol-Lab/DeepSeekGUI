# Git read model

[English](git.md) | 中文

Git capability seam（`ctx.git`）：经稳定机器格式提供仓库 identity、HEAD/分支/upstream、worktree、status 与 diff 摘要——`git rev-parse`（identity）、`git branch --show-current` / `git rev-parse HEAD`（head）、`git rev-parse --abbrev-ref --symbolic-full-name @{u}` 加 `git rev-list --left-right --count`（upstream）、`git worktree list --porcelain`、`git status --porcelain=v2 --branch -z` 与 `git diff [--cached] --name-status -z` / `--numstat -z`（diff）。Git 拥有仓库；读模型绝不写入，seam 仅有的写入是 worktree 生命周期（`worktreeAdd`/`worktreeRemove`，B4-P3）、index/revert 操作（`applyIndexPatch`、`stageFile`、`unstageFile`、`revertFile`，B4-P4）、受控 commit（`authorIdentity`、`stagedTree`、`commit`，B4-P5）与显式 push（`remotes`、`pushPreview`、`push`，B4-P6）——无 force push、不 clean、无 `reset --hard`。子系统由两个包组成：Service Definition（[dsh-git](../../packages/git/git)，`ctx.git`）与本地 provider（[dsh-git-local](../../packages/git/git-local)，经 [subprocess seam](subprocess.zh.md) 执行系统 git）。设计记录：[B4-P2 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p2-git-read-model.zh.md)、[B4-P3 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p3-task-worktree-lifecycle.zh.md)、[B4-P4 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p4-repository-review-index.zh.md)、[B4-P5 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p5-validation-commit.zh.md) 与 [B4-P6 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p6-push-pull-request.zh.md)。

<a id="fact-vocabulary"></a>

## 事实词汇

| 查询 | 命令 | 结果 |
|---|---|---|
| `repoIdentity(cwd)` | `git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository` | 规范根、绝对 git 目录、bare 标志 |
| `head(cwd)` | `git branch --show-current` + `git rev-parse HEAD` | 分支 / 游离 oid / 未出生分支 |
| `upstream(cwd)` | `git rev-parse --abbrev-ref --symbolic-full-name @{u}` + `git rev-list --left-right --count @{u}...HEAD` | 带 ahead/behind 的 ref，或无 upstream 时 `undefined` |
| `worktrees(cwd)` | `git worktree list --porcelain` | 每个 worktree 的路径、HEAD、分支、detached、bare |
| `status(cwd)` | `git status --porcelain=v2 --branch -z` | clean/dirty、head header、upstream、按 staged/unstaged/untracked/conflict 分类的条目 |
| `diff(cwd, scope, path?, wantPatch?)` | `git diff [--cached] --name-status -z` + `--numstat -z` | 逐文件状态、行数、binary 事实、可选有界 patch（`--binary`，可再应用） |
| `worktreeAdd(cwd, path, branch)`（B4-P3） | `git worktree add -q -b <branch> <path>` | 创建工作树；重复分支由 git 拒绝 |
| `worktreeRemove(cwd, path)`（B4-P3） | `git worktree remove <path>` | 移除已注册 worktree；脏工作树由 git 拒绝，无 `--force` |
| `applyIndexPatch(cwd, patch, reverse)`（B4-P4） | `git apply --cached [--reverse] -`（patch 经 stdin） | hunk stage/unstage；git 验证上下文，stale hunk 原样失败 |
| `stageFile(cwd, path)`（B4-P4） | `git add -- <path>`（含 rename 两侧） | 整体暂存一个路径，含未跟踪与 binary 文件 |
| `unstageFile(cwd, path)`（B4-P4） | 反向应用生成的 `git diff --cached --binary`（含 rename 两侧） | index 回退向 HEAD，工作树不受影响，未出生 HEAD 安全 |
| `revertFile(cwd, path)`（B4-P4） | `git checkout -- <path>` | 受跟踪工作树文件从 index 恢复；未跟踪/冲突预先拒绝 |
| `authorIdentity(cwd)`（B4-P5） | `git var GIT_AUTHOR_IDENT` | commit 实际会携带的作者，未配置时 `undefined` |
| `stagedTree(cwd)`（B4-P5） | `git write-tree` | 调用方用户审查的 index tree oid |
| `commit(cwd, message, expectedTree)`（B4-P5） | `git commit -F -`（message 经 stdin） | 受控 commit：冲突/空 index/身份/漂移拒绝后返回 `{ sha, treeMatchesExpected }`——提交后的 HEAD tree 比对把检查与提交之间的窗口大声报出 |
| `remotes(cwd)`（B4-P6） | `git remote -v` | 每个已配置 remote 的 fetch/push URL |
| `pushPreview(cwd, remote)`（B4-P6） | `git rev-parse` 加 `git log --oneline` 加 `git ls-remote --symref` 加 `git config --get credential.helper` | push 确认事实：refs、ahead 提交、远端 ref 存在性（远端不可达时为 `undefined`，绝不猜测）、默认分支、认证来源 |
| `push(cwd, remote, localBranch, remoteBranch)`（B4-P6） | `git push <remote> <local>:<remoteBranch>` | 显式外部写入：拒绝按 git 自身 stderr 分类（non-fast-forward / protected / auth / not-found / network / rejected，原始 stderr 包含）；不写 upstream、不重试 |

status 与 diff 解析是对机器格式的纯函数（`-z` 下记录 NUL 分隔；`2` rename 记录的原路径是第二个 NUL 字段）。

## 失败分类

失败只按可验证事实分类——绝不猜测 stderr 文本：

- `GitUnavailableError`——git 可执行文件无法解析或启动。
- `GitNotARepositoryError`——仓库探测失败（exit 128）。
- `GitUnsupportedVersionError`——`git --version` 解析结果低于 porcelain-v2 底线（git >= 2.11）。
- `GitCommandFailedError`——任何其他非零退出；携带精确 argv、cwd、退出码与原始 stderr 原文。锁、权限与配置失败都以原始文本落入此处。
- `GitDiffTooLargeError`——请求的 patch 超过大小上限（默认 512 KiB；列表上限 4 MiB）。
- `GitRevertRefusedError`（B4-P4）——受控 revert 因路径未跟踪或是未合并冲突条目而被预先拒绝。
- `GitCommitRefusedError`（B4-P5）——commit 被预先拒绝：未解决冲突、空 index 或作者身份缺失。
- `GitStagedTreeDriftError`（B4-P5）——index tree 不再等于审查的快照；提交前必须重新审查。
- `GitPushRefusedError`（B4-P6）——push 被远端或 git 自身拒绝，按 git 自身 stderr 词汇分类（non-fast-forward / protected / auth / not-found / network / rejected）；原始 stderr 始终随附。
- `GitNoSuchRemoteError`（B4-P6）——本仓库未配置该 remote 名；在任何网络写入前失败。

## 消费方

`PushApproval` 包含 `sourceOid`（获批提交）和 `pushUrl`（生效目标）。调用方在审批前从 `PushPreview` 捕获二者并传给 `push`；源或 URL 漂移时拒绝写入。预览接受显式源分支与目标分支。只有本地拥有目标提交时，候选提交才是精确差集；否则为全部源历史。分支名称验证与完整引用阻止 force/delete refspec 语法。

DeepSeekGUI B4 在这条 seam 上的 `git.*` RPC 域已随上游 dsh 0.1.2 Remote 迁移退役（B5-P1）；seam 上的 Agent 编码动作改经 DeepSeekGUI coding tools（B5-P4）进入同一会话（结果写入 Session log），GUI 检查读取官方 Remote 投影。`worktreeAdd`/`worktreeRemove` 仍是 seam 仅有的 worktree 写原语，留给用户或 Agent 明确选择的 worktree 动作。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgit--gitcapability-abstract-seam"></a>

### `ctx.git` — `GitCapability` (abstract seam)

Abstract Git service. Subclass, implement the methods, and load the subclass as a plugin — it registers as `ctx.git` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior). Implementations must honor these semantics:

- Every command runs the system git through the subprocess seam with exact executable + argv (never a shell string) and a bounded collected output.
- Queries are read-only; the only writes are the B4-P3 worktree lifecycle (`worktreeAdd`/`worktreeRemove`) and the B4-P4 index/revert operations (`applyIndexPatch`, `stageFile`, `unstageFile`, `revertFile`). No commit, no push, no clean, no `reset --hard` anywhere.
- Failures are classified only by verifiable facts: `GitUnavailableError` for resolution/spawn failures, `GitNotARepositoryError` when the repository probe fails, `GitUnsupportedVersionError` from `git --version` parsing, and `GitCommandFailedError` (with the raw stderr) for everything else.

```ts cordis-catalog
/**
 * Resolve the git executable in this provider's execution world.
 * @returns the canonical executable path.
 */
abstract resolveGit(): Promise<string>

/**
 * Confirm a working directory belongs to a repository and return its
 * identity. A directory outside any repository rejects with
 * {@link GitNotARepositoryError}.
 * @param cwd - Working directory to probe.
 * @returns the repository root, git dir, and bare flag.
 */
abstract repoIdentity(cwd: string): Promise<RepoIdentity>

/**
 * Where HEAD points in the repository containing `cwd`.
 * @param cwd - Working directory inside the repository.
 * @returns the branch, detached, or unborn state.
 */
abstract head(cwd: string): Promise<HeadState>

/**
 * The current branch's configured upstream, when one exists.
 * @param cwd - Working directory inside the repository.
 * @returns the upstream ref with ahead/behind counts, or `undefined` when
 * the branch has no upstream.
 */
abstract upstream(cwd: string): Promise<UpstreamInfo | undefined>

/**
 * Every work tree registered with the repository.
 * @param cwd - Working directory inside the repository.
 * @returns the work-tree list in `git worktree list --porcelain` order.
 */
abstract worktrees(cwd: string): Promise<WorktreeInfo[]>

/**
 * Create a work tree with a new branch (`git worktree add -b <branch>
 * <path>`). The path must not exist and must not already be registered; a
 * branch name that already exists fails with `GitCommandFailedError` (the
 * raw stderr names it). This is the ONLY work-tree write the seam offers.
 * @param cwd - Working directory inside the repository.
 * @param path - Absolute path for the new work tree.
 * @param branch - New branch to create and check out there.
 * @returns resolution after the work tree exists.
 */
abstract worktreeAdd(cwd: string, path: string, branch: string): Promise<void>

/**
 * Remove a registered work tree (`git worktree remove <path>`). Git itself
 * refuses a dirty work tree; the caller decides which checks run first.
 * @param cwd - Working directory inside the repository.
 * @param path - Absolute path of the work tree to remove.
 * @returns resolution after the work tree is removed.
 */
abstract worktreeRemove(cwd: string, path: string): Promise<void>

/**
 * The complete read-only work-tree state.
 * @param cwd - Working directory inside the repository.
 * @returns clean/dirty facts and every changed path (staged, unstaged,
 * untracked, and conflict entries).
 */
abstract status(cwd: string): Promise<RepoStatus>

/**
 * The newest commits reachable from HEAD (`git log -n <max>`), read-only.
 * Serves the Workbench Git view so a person can see what was committed
 * without asking the model; an unborn branch yields an empty list.
 * @param cwd - Working directory inside the repository.
 * @param max - Upper bound on returned commits (at least 1).
 * @returns commits newest first.
 */
abstract log(cwd: string, max: number): Promise<CommitInfo[]>

/**
 * The read-only diff of one scope. `numstat` rows carry binary and line
 * facts; a requested patch is refused whole with
 * {@link GitDiffTooLargeError} when it exceeds `patchMaxBytes`. The patch
 * is generated with `--binary`, so binary files carry a literal patch that
 * `git apply` can consume — the same patch bytes the index operations
 * re-apply.
 * @param cwd - Working directory inside the repository.
 * @param scope - `'staged'` reads the index against HEAD, `'unstaged'` the
 * work tree against the index.
 * @param path - Optional pathspec limiting the diff to one path.
 * @param wantPatch - When true, also return the unified patch for the
 * requested scope/path.
 * @param patchMaxBytes - Bound on the returned patch.
 * @returns the file summaries and the optional patch.
 */
abstract diff( cwd: string, scope: DiffScope, path?: string, wantPatch?: boolean, patchMaxBytes?: number, ): Promise<DiffResult>

/**
 * Apply one patch to the INDEX only (B4-P4 hunk stage/unstage). The patch
 * must be a git-diff fact (the caller hands back the exact bytes `diff`
 * produced, or a hunk subset of them); it is delivered through the
 * subprocess stdin, never via a shell string or a temp file. `reverse`
 * applies the patch in reverse (unstage: index back toward HEAD). Git
 * itself validates the context against the current index, so a stale hunk
 * or an externally modified index fails with `GitCommandFailedError` and
 * the raw stderr. Nothing else is written: the work tree is untouched.
 * @param cwd - Working directory inside the repository.
 * @param patch - The unified patch bytes (git-diff format).
 * @param reverse - Apply the patch in reverse.
 * @returns resolution after the index was updated.
 */
abstract applyIndexPatch(cwd: string, patch: string, reverse: boolean): Promise<void>

/**
 * Stage one whole path into the index (`git add -- <path>`). Works for
 * tracked modifications, renames, and untracked files alike; binary files
 * need no special handling. Staging an untracked file is allowed — B4 only
 * refuses to DELETE untracked files, never to track them.
 * @param cwd - Working directory inside the repository.
 * @param path - Path relative to the repo root.
 * @returns resolution after the index was updated.
 */
abstract stageFile(cwd: string, path: string): Promise<void>

/**
 * Unstage one whole path: the staged diff (index against HEAD, generated
 * with `--binary`) is applied in reverse to the index, so the index moves
 * back toward HEAD and the work tree is untouched. Works on unborn HEADs
 * (a staged new file leaves the index again) and on binary and rename
 * entries. A path with no staged changes is a no-op.
 * @param cwd - Working directory inside the repository.
 * @param path - Path relative to the repo root.
 * @returns resolution after the index was updated.
 */
abstract unstageFile(cwd: string, path: string): Promise<void>

/**
 * Controlled revert of one TRACKED path: the work-tree file is restored
 * from the index (`git checkout -- <path>`), discarding its unstaged
 * modifications; staged changes stay staged. Refused up front with
 * {@link GitRevertRefusedError} for untracked paths (B4 never restores or
 * deletes untracked files) and for unmerged conflict entries (B4 never
 * auto-resolves conflicts); git itself refuses anything the precondition
 * missed. The caller shows the exact target and the content that would be
 * lost before invoking this.
 * @param cwd - Working directory inside the repository.
 * @param path - Path relative to the repo root.
 * @returns resolution after the work tree was restored.
 */
abstract revertFile(cwd: string, path: string): Promise<void>

/**
 * The configured commit author (`git var GIT_AUTHOR_IDENT`), or `undefined`
 * when no identity is configured (the command fails). This is the identity
 * a commit would actually carry, including environment overrides.
 * @param cwd - Working directory inside the repository.
 * @returns the name and email, or `undefined` when unconfigured.
 */
abstract authorIdentity(cwd: string): Promise<AuthorIdentity | undefined>

/**
 * The index's current tree oid (`git write-tree`): the snapshot a caller
 * confirms against. Writing one tree object is git's own normal behavior;
 * the tree is never committed by this call.
 * @param cwd - Working directory inside the repository.
 * @returns the tree oid.
 */
abstract stagedTree(cwd: string): Promise<string>

/**
 * Commit the staged tree with a user-confirmed message (B4-P5). Checks in
 * this order, writing nothing on refusal: unresolved conflicts
 * (`GitCommitRefusedError('conflict')`), an empty index
 * (`GitCommitRefusedError('empty-index')`), a missing author identity
 * (`GitCommitRefusedError('identity')`), and staged-tree drift — the index
 * tree must equal the `expectedTree` the caller's user confirmed
 * (`GitStagedTreeDriftError`; the caller re-shows the staged diff and asks
 * again). The message is delivered through stdin (`git commit -F -`), so
 * any characters are safe and nothing is shell-interpreted. A hook refusal
 * or other git failure surfaces as `GitCommandFailedError` with the raw
 * stderr. After the commit, HEAD's tree is compared against `expectedTree`
 * once more: the drift check closed the review window, and this comparison
 * reports the millisecond window between the check and the commit itself —
 * `treeMatchesExpected` is `false` only when that window was exploited.
 * @param cwd - Working directory inside the repository.
 * @param message - The commit message the user confirmed.
 * @param expectedTree - The tree oid the user reviewed.
 * @returns the new commit's SHA plus whether its tree matches the reviewed tree.
 */
abstract commit(cwd: string, message: string, expectedTree: string): Promise<GitCommitResult>

/**
 * Every configured remote (`git remote -v`), in configuration order.
 * @param cwd - Working directory inside the repository.
 * @returns the remote names with their fetch/push URLs.
 */
abstract remotes(cwd: string): Promise<RemoteInfo[]>

/**
 * The push preview (B4-P6): the remote URL, the local branch and its
 * target remote ref, the commits that would reach the remote, whether the
 * remote ref exists (queried with `git ls-remote`), the remote's default
 * branch, and the configured credential helper — every fact the caller's
 * user confirms before a push. The remote ref existence query can fail
 * (offline, unknown host): the preview then carries the local facts and
 * reports `remoteRefExists: undefined` rather than guessing.
 * @param cwd - Working directory inside the repository.
 * @param remote - The remote that would receive the push.
 * @param localBranch - Source branch; omission selects the checked-out branch.
 * @param remoteBranch - Target branch; omission uses the source branch name.
 * @returns the preview facts.
 * @throws {@link GitNoSuchRemoteError} when the remote is not configured.
 */
abstract pushPreview(cwd: string, remote: string, localBranch?: string, remoteBranch?: string): Promise<PushPreview>

/**
 * Push one local branch to one remote branch (B4-P6): `git push <remote>
 * <local>:<remoteBranch>`. This is an explicit external write — the caller
 * shows the preview and obtains confirmation first. The upstream
 * configuration is never touched by this call. Refusals classify by git's
 * own stderr vocabulary: non-fast-forward, protected branch, auth, missing
 * remote repository, network failure, or a generic rejection
 * (`GitPushRefusedError`); nothing is retried.
 * @param cwd - Working directory inside the repository.
 * @param remote - The remote to push to.
 * @param localBranch - The local branch to push.
 * @param remoteBranch - The remote branch ref to update.
 * @param expected - Approved source commit and effective URL; drift refuses before the write.
 * @returns the remote ref's new SHA.
 * @throws {@link GitNoSuchRemoteError} when the remote is not configured.
 * @throws {@link GitPushRefusedError} when the remote refuses the push.
 */
abstract push( cwd: string, remote: string, localBranch: string, remoteBranch: string, expected?: PushApproval, ): Promise<PushOutcome>
```

Source: [`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)
<!-- END GENERATED cordis-surface -->
