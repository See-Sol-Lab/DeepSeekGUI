/** Git reads and explicit mutations through composed providers.
 * @module @deepseek-ai/dsh-git
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AuthorIdentity, CommitInfo, DiffResult, DiffScope, HeadState, RepoIdentity, RepoStatus, UpstreamInfo, WorktreeInfo,
} from './types.ts'

export type {
  AuthorIdentity, CommitInfo, DiffFileSummary, DiffResult, DiffScope, GitCommitResult, HeadState, PushOutcome,
  PushApproval, PushPreview, RemoteInfo, RepoIdentity, RepoStatus, StatusCode, StatusEntry, UpstreamInfo, WorktreeInfo,
} from './types.ts'
import type { GitCommitResult, PushApproval, PushOutcome, PushPreview, RemoteInfo } from './types.ts'

/** Remove URL credentials and token parameters from Git diagnostics and displayed remote addresses.
 * @param text - Git output or a displayed remote URL.
 * @returns Text with recognized credentials removed.
 */
export function redactGitText(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/giu, '$1<redacted>@')
    .replace(/([?&](?:token|access_token|private_token|password)=)[^\s&#]*/giu, '$1<redacted>')
    .replace(/github_pat_[A-Za-z0-9_]{16,}/gu, 'github_pat_<redacted>')
    .replace(/gh[pousr]_[A-Za-z0-9]{16,}/gu, 'gh*_<redacted>')
}

/** The git executable could not be resolved or executed in this environment. */
export class GitUnavailableError extends Error {
  /**
   * @param detail - Resolution or spawn failure detail.
   */
  constructor(detail: string) {
    super(`git is unavailable: ${redactGitText(detail)}`)
    this.name = 'GitUnavailableError'
  }
}

/** The queried directory is not inside a Git repository. */
export class GitNotARepositoryError extends Error {
  /**
   * @param cwd - The directory that failed the repository probe.
   */
  constructor(readonly cwd: string) {
    super(`'${cwd}' is not inside a Git repository`)
    this.name = 'GitNotARepositoryError'
  }
}

/**
 * The installed git is older than the machine-format floor (porcelain v2
 * needs git >= 2.11). The version is a fact from `git --version`, never a
 * stderr guess.
 */
export class GitUnsupportedVersionError extends Error {
  /**
   * @param version - The version git reported.
   * @param minimum - The lowest supported version.
   */
  constructor(readonly version: string, readonly minimum: string) {
    super(`git ${version} is too old; the read model needs git >= ${minimum}`)
    this.name = 'GitUnsupportedVersionError'
  }
}

/**
 * A git command failed (non-zero exit). Lock, permission, and configuration
 * failures all land here: the exit code and the raw stderr are presented
 * verbatim for an actionable diagnosis and never classified by guessing at
 * stderr text.
 */
export class GitCommandFailedError extends Error {
  /**
   * @param command - The argv that failed.
   * @param cwd - The working directory the command ran in.
   * @param exitCode - The process exit code.
   * @param stderr - Captured stderr, redacted before presentation.
   * @param timedOut - Whether the command exceeded its deadline.
   */
  constructor(
    readonly command: readonly string[],
    readonly cwd: string,
    readonly exitCode: number | null,
    readonly stderr: string,
    readonly timedOut = false,
  ) {
    super(
      redactGitText(`git ${command.slice(1).join(' ')} ${timedOut ? 'timed out' : `failed (exit ${String(exitCode)})`}: ${stderr.trim()}`),
    )
    this.command = command.map(redactGitText)
    this.stderr = redactGitText(stderr)
    this.name = 'GitCommandFailedError'
  }
}

/** A requested diff patch exceeded the caller's size bound and was refused whole. */
export class GitDiffTooLargeError extends Error {
  /**
   * @param path - The path whose patch exceeded the bound.
   * @param maxBytes - The bound that was exceeded.
   */
  constructor(readonly path: string, readonly maxBytes: number) {
    super(`diff of '${path}' exceeds the ${String(maxBytes)}-byte patch bound`)
    this.name = 'GitDiffTooLargeError'
  }
}

/**
 * A tracked revert was refused by the capability's own precondition: the
 * path is untracked (B4 never deletes or restores untracked files) or is an
 * unmerged conflict entry (B4 never auto-resolves conflicts).
 */
export class GitRevertRefusedError extends Error {
  /**
   * @param path - The refused path.
   * @param reason - Which precondition failed.
   */
  constructor(readonly path: string, readonly reason: 'untracked' | 'conflict') {
    super(`cannot revert '${path}': the path is ${reason === 'untracked' ? 'untracked' : 'an unmerged conflict entry'}`)
    this.name = 'GitRevertRefusedError'
  }
}

/**
 * A commit was refused by the capability's own precondition, checked in
 * this order: unresolved conflicts (B4 never auto-resolves), an empty index
 * (nothing staged), or a missing author identity (`git var GIT_AUTHOR_IDENT`
 * fails). Nothing is written.
 */
export class GitCommitRefusedError extends Error {
  /**
   * @param reason - Which precondition failed.
   */
  constructor(readonly reason: 'conflict' | 'empty-index' | 'identity') {
    super(reason === 'conflict'
      ? 'cannot commit: the work tree has unresolved conflicts'
      : reason === 'empty-index'
        ? 'cannot commit: nothing is staged'
        : 'cannot commit: no author identity is configured (user.name/user.email)')
    this.name = 'GitCommitRefusedError'
  }
}

/**
 * The staged tree changed between the caller's confirmation snapshot and the
 * commit itself: the caller must re-show the staged diff and obtain a fresh
 * confirmation — a commit is never built from a tree the user did not see.
 */
export class GitStagedTreeDriftError extends Error {
  /**
   * @param expected - The tree oid the caller confirmed.
   * @param actual - The tree oid the index holds now.
   */
  constructor(readonly expected: string, readonly actual: string) {
    super(`staged tree changed since review (${expected} → ${actual}); re-review the staged diff before committing`)
    this.name = 'GitStagedTreeDriftError'
  }
}

/**
 * A push was refused by the remote or by git itself (B4-P6). The reason
 * classifies the failure from git's own stable stderr vocabulary; the raw
 * stderr always rides along for diagnosis. Nothing is retried.
 */
export class GitPushRefusedError extends Error {
  /**
   * @param reason - The classified refusal.
   * @param stderr - The raw git stderr, verbatim.
   */
  constructor(
    readonly reason: 'non-fast-forward' | 'protected' | 'auth' | 'not-found' | 'network' | 'rejected',
    readonly stderr: string,
  ) {
    super(`git push refused (${reason}): ${stderr}`)
    this.name = 'GitPushRefusedError'
  }
}

/** The named remote does not exist in this repository's configuration (B4-P6). */
export class GitNoSuchRemoteError extends Error {
  /**
   * @param remote - The remote name that is not configured.
   */
  constructor(readonly remote: string) {
    super(`no remote '${remote}' is configured in this repository`)
    this.name = 'GitNoSuchRemoteError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitCapability
  }
}

/**
 * Abstract Git service. Subclass, implement the methods, and load the
 * subclass as a plugin — it registers as `ctx.git` (one implementation
 * per context; loading a second throws, which is cordis' standard
 * duplicate-service behavior). Implementations must honor these semantics:
 * - Every command runs the system git through the subprocess seam with exact
 *   executable + argv (never a shell string) and a bounded collected output.
 * - Queries are read-only; the only writes are the B4-P3 worktree lifecycle
 *   (`worktreeAdd`/`worktreeRemove`) and the B4-P4 index/revert operations
 *   (`applyIndexPatch`, `stageFile`, `unstageFile`, `revertFile`). No commit,
 *   no push, no clean, no `reset --hard` anywhere.
 * - Failures are classified only by verifiable facts: `GitUnavailableError`
 *   for resolution/spawn failures, `GitNotARepositoryError` when the
 *   repository probe fails, `GitUnsupportedVersionError` from `git --version`
 *   parsing, and `GitCommandFailedError` (with the raw stderr) for everything
 *   else.
 */
export abstract class GitCapability extends Service {
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * Resolve the git executable in this provider's execution world.
   * @returns the canonical executable path.
   */
  abstract resolveGit(): Promise<string>

  /**
   * The minimum supported git version (porcelain v2 floor).
   */
  abstract readonly minimumGitVersion: string

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
  abstract diff(
    cwd: string,
    scope: DiffScope,
    path?: string,
    wantPatch?: boolean,
    patchMaxBytes?: number,
  ): Promise<DiffResult>

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
   * @param expectedPatch - Optional approved unstaged patch; changed content refuses the revert.
   * @returns resolution after the work tree was restored.
   */
  abstract revertFile(cwd: string, path: string, expectedPatch?: string): Promise<void>

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
  abstract push(
    cwd: string,
    remote: string,
    localBranch: string,
    remoteBranch: string,
    expected?: PushApproval,
  ): Promise<PushOutcome>
}

export default GitCapability
