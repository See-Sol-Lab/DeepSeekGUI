# Git read model

English | [中文](git.zh.md)

The Git capability seam (`ctx.git`): repository identity, HEAD/branch/upstream, work trees, status, and diff summaries served through stable machine formats — `git rev-parse` (identity), `git branch --show-current` / `git rev-parse HEAD` (head), `git rev-parse --abbrev-ref --symbolic-full-name @{u}` plus `git rev-list --left-right --count` (upstream), `git worktree list --porcelain`, `git status --porcelain=v2 --branch -z`, and `git diff [--cached] --name-status -z` / `--numstat -z` (diffs). Git owns the repository; the read model never writes, and the seam's only writes are the worktree lifecycle (`worktreeAdd`/`worktreeRemove`, B4-P3), the index/revert operations (`applyIndexPatch`, `stageFile`, `unstageFile`, `revertFile`, B4-P4), the guarded commit (`authorIdentity`, `stagedTree`, `commit`, B4-P5), and the explicit push (`remotes`, `pushPreview`, `push`, B4-P6) — no force push, no clean, no `reset --hard`. The subsystem is two packages: the Service Definition ([dsh-git](../../packages/git/git), `ctx.git`) and the local provider ([dsh-git-local](../../packages/git/git-local), which executes the system git through the [subprocess seam](subprocess.md)). Design records: [B4-P2 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p2-git-read-model.md), [B4-P3 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p3-task-worktree-lifecycle.md), [B4-P4 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p4-repository-review-index.md), [B4-P5 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p5-validation-commit.md), and [B4-P6 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p6-push-pull-request.md).

## Fact vocabulary

| Query | Command | Result |
|---|---|---|
| `repoIdentity(cwd)` | `git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository` | canonical root, absolute git dir, bare flag |
| `head(cwd)` | `git branch --show-current` + `git rev-parse HEAD` | branch / detached oid / unborn branch |
| `upstream(cwd)` | `git rev-parse --abbrev-ref --symbolic-full-name @{u}` + `git rev-list --left-right --count @{u}...HEAD` | ref with ahead/behind, or `undefined` (no upstream) |
| `worktrees(cwd)` | `git worktree list --porcelain` | per-work-tree path, HEAD, branch, detached, bare |
| `status(cwd)` | `git status --porcelain=v2 --branch -z` | clean/dirty, head header, upstream, entries classified staged/unstaged/untracked/conflict |
| `diff(cwd, scope, path?, wantPatch?)` | `git diff [--cached] --name-status -z` + `--numstat -z` | per-file status, line counts, binary facts, optional bounded patch (`--binary`, re-applicable) |
| `worktreeAdd(cwd, path, branch)` (B4-P3) | `git worktree add -q -b <branch> <path>` | creates a work tree; git rejects a duplicate branch |
| `worktreeRemove(cwd, path)` (B4-P3) | `git worktree remove <path>` | removes a registered work tree; git rejects a dirty one, no `--force` |
| `applyIndexPatch(cwd, patch, reverse)` (B4-P4) | `git apply --cached [--reverse] -` (patch via stdin) | hunk stage/unstage; git validates the context, stale hunk fails raw |
| `stageFile(cwd, path)` (B4-P4) | `git add -- <path>` (both sides of a rename) | stages one whole path incl. untracked and binary files |
| `unstageFile(cwd, path)` (B4-P4) | reverse-apply of the generated `git diff --cached --binary` (both sides of a rename) | index back toward HEAD, work tree untouched, unborn-HEAD safe |
| `revertFile(cwd, path)` (B4-P4) | `git checkout -- <path>` | tracked work-tree restore from the index; untracked/conflict refused up front |
| `authorIdentity(cwd)` (B4-P5) | `git var GIT_AUTHOR_IDENT` | the author a commit would carry, or `undefined` when unconfigured |
| `stagedTree(cwd)` (B4-P5) | `git write-tree` | the index tree oid the caller's user reviews |
| `commit(cwd, message, expectedTree)` (B4-P5) | `git commit -F -` (message via stdin) | guarded commit: conflict/empty-index/identity/drift refusals, then `{ sha, treeMatchesExpected }` — the post-commit HEAD-tree comparison reports the check-to-commit window loudly |
| `remotes(cwd)` (B4-P6) | `git remote -v` | every configured remote with its fetch/push URLs |
| `pushPreview(cwd, remote)` (B4-P6) | `git rev-parse` + `git log --oneline` + `git ls-remote --symref` + `git config --get credential.helper` | push confirmation facts: refs, ahead commits, remote-ref existence (`undefined` when the remote is unreachable, never guessed), default branch, authentication source |
| `push(cwd, remote, localBranch, remoteBranch)` (B4-P6) | `git push <remote> <local>:<remoteBranch>` | explicit external write: refusals classify from git's own stderr (non-fast-forward / protected / auth / not-found / network / rejected, raw stderr included); no upstream write, no retry |

Status and diff parsing are pure functions over the machine formats (NUL-terminated records under `-z`; a `2` rename record carries its original path as a second NUL field).

## Failure classification

Failures classify only by verifiable facts — never by guessing at stderr text:

- `GitUnavailableError` — the git executable cannot be resolved or spawned.
- `GitNotARepositoryError` — the repository probe fails (exit 128).
- `GitUnsupportedVersionError` — `git --version` parses below the porcelain-v2 floor (git >= 2.11).
- `GitCommandFailedError` — any other non-zero exit; carries the exact argv, cwd, exit code, and the raw stderr verbatim. Lock, permission, and configuration failures land here with their original text.
- `GitDiffTooLargeError` — a requested patch exceeded the size bound (default 512 KiB; listings cap at 4 MiB).
- `GitRevertRefusedError` (B4-P4) — a controlled revert was refused up front because the path is untracked or an unmerged conflict entry.
- `GitCommitRefusedError` (B4-P5) — a commit was refused up front: unresolved conflicts, an empty index, or a missing author identity.
- `GitStagedTreeDriftError` (B4-P5) — the index tree no longer equals the reviewed snapshot; re-review is required before committing.
- `GitPushRefusedError` (B4-P6) — a push was refused by the remote or by git itself, classified from git's own stderr vocabulary (non-fast-forward / protected / auth / not-found / network / rejected); the raw stderr always rides along.
- `GitNoSuchRemoteError` (B4-P6) — the named remote is not configured in this repository; the push fails before any network write.

## Consumers

`PushApproval` carries `sourceOid` (the approved commit) and `pushUrl` (the effective destination). The caller captures both from `PushPreview` before approval and supplies them to `push`; source or URL drift refuses the write. Preview accepts explicit source and target branch names. Its candidate commits are an exact difference only when the destination commit is available locally; otherwise they are the full source history. Branch-name validation and qualified refs prevent force/delete refspec syntax.

The DeepSeekGUI B4 `git.*` RPC domain over this seam retired with the upstream dsh 0.1.2 Remote migration (B5-P1); agent coding actions on the seam re-enter through the DeepSeekGUI coding tools (B5-P4) with results logged as session events, and GUI inspection reads official Remote projections. `worktreeAdd`/`worktreeRemove` remain the seam's only worktree writes, reserved for explicit user- or agent-chosen worktree actions.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
