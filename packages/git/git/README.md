---
description: "The ctx.git capability contract for developers reading repository facts — identity, HEAD, upstream, work trees, status and diffs — and for maintainers of its guarded write operations."
kind: "package-reference"
---

# @deepseek-ai/dsh-git

English | [中文](README.zh.md)

## Summary

Git capability Service Definition (`ctx.git`) for the DeepSeek Harness (B4-P2 Git Read Model): repository identity, HEAD/branch/upstream, work trees, status, and diff summaries served through stable machine formats, plus the B4-P3 worktree lifecycle writes, the B4-P4 index/revert operations, and the B4-P5 guarded commit. Git owns the repository; the read model never writes, and the seam's only writes are the worktree lifecycle (`worktreeAdd`/`worktreeRemove`), the index operations (`applyIndexPatch`, `stageFile`, `unstageFile`, `revertFile`), and the guarded `commit` — no push, no clean, no `reset --hard` anywhere. The local implementation lives in [@deepseek-ai/dsh-git-local](../git-local/README.md), which executes the system git through the subprocess seam with exact executable + argv, never a shell string.

## Table of Contents

- [Shape](#shape)
- [Failure classification](#failure-classification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="shape"></a>
## Shape

- `ctx.git.repoIdentity(cwd)` — `git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository`; the canonical root, the absolute git dir, and the bare flag. A directory outside any repository rejects with `GitNotARepositoryError`.
- `ctx.git.head(cwd)` — `git branch --show-current` plus `git rev-parse HEAD`: the branch, the detached oid, or the unborn branch (no commit yet).
- `ctx.git.upstream(cwd)` — `git rev-parse --abbrev-ref --symbolic-full-name @{u}` plus `git rev-list --left-right --count @{u}...HEAD`: the upstream ref with ahead/behind counts, or `undefined` when the branch has no upstream (the definite 128 rejection of the probe).
- `ctx.git.worktrees(cwd)` — `git worktree list --porcelain`: every registered work tree with its HEAD, branch, detached, and bare facts.
- `ctx.git.status(cwd)` — `git status --porcelain=v2 --branch -z`: clean/dirty facts, the HEAD header, upstream with ahead/behind, and every changed path classified as staged, unstaged, untracked, or conflict (renames carry their original path and similarity score).
- `ctx.git.log(cwd, max)` — `git log -n <max>` with a unit-separated format: the newest commits (sha, subject, author, committer time) newest first; an unborn branch yields an empty list.
- `ctx.git.diff(cwd, scope, path?, wantPatch?, patchMaxBytes?)` — `git diff [--cached] --name-status -z` plus `--numstat -z`: per-file status, line counts, and binary facts; a requested patch (generated with `--binary`, so binary files carry a literal patch `git apply` can consume) is refused whole with `GitDiffTooLargeError` when it exceeds the bound (default 512 KiB).
- `ctx.git.worktreeAdd(cwd, path, branch)` (B4-P3) — `git worktree add -q -b <branch> <path>`: creates a work tree for the managed-worktree task lifecycle. Git itself rejects a branch that already exists.
- `ctx.git.worktreeRemove(cwd, path)` (B4-P3) — `git worktree remove <path>`: removes a registered work tree; git itself refuses a dirty one (modified or untracked files). No `--force` is ever passed.
- `ctx.git.applyIndexPatch(cwd, patch, reverse)` (B4-P4) — `git apply --cached [--reverse] -` with the patch delivered through the subprocess stdin: the hunk stage/unstage primitive. The patch must be a git-diff fact (the exact bytes `diff` produced, or a hunk subset of them); git itself validates the context against the current index, so a stale hunk or an externally changed index fails with `GitCommandFailedError` and the raw stderr. The work tree is never touched.
- `ctx.git.stageFile(cwd, path)` (B4-P4) — `git add -- <path>`: stages one whole path, including untracked files, binary files, and both sides of a rename. Staging an untracked file is allowed — B4 only refuses to DELETE untracked files.
- `ctx.git.unstageFile(cwd, path)` (B4-P4) — the staged diff (index against HEAD, `--binary`, both sides of a rename) applied in reverse to the index: the index moves back toward HEAD, the work tree is untouched. Works on unborn HEADs; a path with no staged changes is a no-op.
- `ctx.git.revertFile(cwd, path)` (B4-P4) — `git checkout -- <path>`: restores a tracked work-tree file from the index, discarding its unstaged modifications; staged changes stay staged. Refused up front with `GitRevertRefusedError` for untracked paths (B4 never restores or deletes untracked files) and for unmerged conflict entries (B4 never auto-resolves conflicts); git's own refusal is the backstop. The caller shows the exact target and the content that would be lost and obtains explicit confirmation before invoking.
- `ctx.git.authorIdentity(cwd)` (B4-P5) — `git var GIT_AUTHOR_IDENT`: the author a commit would actually carry (including environment overrides), or `undefined` when no identity is configured.
- `ctx.git.stagedTree(cwd)` (B4-P5) — `git write-tree`: the index's current tree oid — the snapshot a caller's user reviews before confirming a commit.
- `ctx.git.commit(cwd, message, expectedTree)` (B4-P5) — `git commit -F -` with the message delivered through stdin: the guarded commit. Checks in order, writing nothing on refusal: unresolved conflicts (`GitCommitRefusedError('conflict')`), an empty index (`GitCommitRefusedError('empty-index')`), a missing author identity (`GitCommitRefusedError('identity')`), and staged-tree drift — the index tree must equal the `expectedTree` the user reviewed (`GitStagedTreeDriftError`; the caller re-shows the staged diff and asks again). A hook refusal or other git failure surfaces as `GitCommandFailedError` with the raw stderr. Success resolves with `{ sha, treeMatchesExpected }`: after the commit, HEAD's tree is compared against `expectedTree` once more, so the millisecond window between the drift check and the commit is reported loudly (`treeMatchesExpected: false`) instead of passing silently.
- `ctx.git.remotes(cwd)` (B4-P6) — `git remote -v`: every configured remote with its fetch/push URLs.
- `ctx.git.pushPreview(cwd, remote, localBranch?, remoteBranch?)` returns the exact source commit and effective push URL. Omitted branches use the checked-out branch and its name as destination. Candidate commits compare the remote target object with the source when available locally; otherwise the full source history is returned, not an exact ahead count. An unreachable remote leaves remoteRefExists undefined; an unconfigured remote throws GitNoSuchRemoteError.
- `ctx.git.push(cwd, remote, localBranch, remoteBranch, expected?)` sends a resolved commit to a qualified branch ref at one effective push URL. Ref names reject force/delete syntax. Passing `{ sourceOid, destinationToken }` from the approved preview rejects drift before writing. A successful push also advances the remote-tracking ref for that destination so status stays truthful. GitPushRefusedError classifies remote refusals; upstream configuration is untouched and nothing is retried.

-----

<a id="failure-classification"></a>
## Failure classification

Failures classify only by verifiable facts, never by guessing at stderr text:

- `GitUnavailableError` — the git executable cannot be resolved or spawned.
- `GitNotARepositoryError` — the repository probe fails (exit 128).
- `GitUnsupportedVersionError` — `git --version` parses below the porcelain-v2 floor (git >= 2.11).
- `GitCommandFailedError` — any other non-zero exit; it carries the exact argv, cwd, exit code, and the raw stderr verbatim for an actionable diagnosis. Lock, permission, and configuration failures land here with their original text.
- `GitDiffTooLargeError` — a requested patch exceeded the size bound.
- `GitRevertRefusedError` (B4-P4) — a controlled revert was refused up front: the path is untracked or an unmerged conflict entry.
- `GitCommitRefusedError` (B4-P5) — a commit was refused up front: unresolved conflicts, an empty index, or a missing author identity.
- `GitStagedTreeDriftError` (B4-P5) — the index tree no longer equals the snapshot the user reviewed; re-review is required before committing.
- `GitPushRefusedError` (B4-P6) — a push was refused by the remote or by git itself, classified from git's own stderr vocabulary (`non-fast-forward`, `protected`, `auth`, `not-found`, `network`, `rejected`); the raw stderr always rides along.
- `GitNoSuchRemoteError` (B4-P6) — the named remote is not configured in this repository.

-----

<a id="model-experience"></a>
## Model Experience

### Repository facts

#### What the model sees

Nothing. `ctx.git` serves read-only repository facts to host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Bounded write surface** — status/diff/identity queries never write; the seam's only writes are the worktree lifecycle (`worktreeAdd`/`worktreeRemove`) and the B4-P4 index/revert operations. Commit/push arrive in later B4 phases through the same seam.
- **Lock/permission failures are presented, not classified** — `GitCommandFailedError` carries the raw stderr and exit code for display; the seam deliberately does not parse stderr text into states.
- **Large diffs are bounded** — status/diff listings cap at 4 MiB of output and per-file patches at 512 KiB; exceeding either refuses the result rather than returning a truncated one.
- **No change frames** — the seam is query-only; consumers load on view open, after their own operations, or on explicit refresh (no watcher, no polling).
- **Worktree removal never forces** — `worktreeRemove` passes no `--force`; a dirty work tree stays (the managed-worktree task refuses to remove it before the command is even run).
- **Revert is tracked-only and never auto-resolves** — `revertFile` refuses untracked and conflict paths; there is no untracked-file deletion, no `clean`, and no `reset --hard` anywhere.

**Runtime invariant:** No companion is published. Git owns the repository and every query is a read-only projection of its facts; the seam exposes no independent event sequence or mutable data relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

DeepSeekGUI owns this package; upstream ships no equivalent. Since B5-P4 its only consumer is the coding-tools plugin, which registers the DSH tools that call this seam — the retired Task capability no longer sits in between.

</details>
