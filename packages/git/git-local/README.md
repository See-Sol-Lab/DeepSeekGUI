---
description: "The local git provider for developers running the ctx.git contract against the system git through the subprocess seam, and for maintainers of its stable machine command formats."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-local

English | [中文](README.zh.md)

## Summary

Local implementation of the [git capability seam](../git/README.md) (`ctx.git`): repository facts through the subprocess seam — system git, exact executable + argv, never a shell string, bounded collected output, and stable machine formats only. Machine-format parsers live in `src/parse.ts` (pure functions): porcelain v2 status (`--porcelain=v2 --branch -z`, NUL-terminated headers included), worktree porcelain, name-status -z, and numstat -z.

## Table of Contents

- [Shape](#shape)
- [Failure classification](#failure-classification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="shape"></a>
## Shape

- Resolves `git` once per service lifetime and verifies the version once (`git --version`, floor 2.11 for porcelain v2); later queries trust the result.
- Every query first probes `repoIdentity` so a non-repository directory fails as `GitNotARepositoryError` before any command runs.
- Every local command runs with a 30-second timeout, a 5-second terminate grace, a 4 MiB collected-output bound, and a bounded stderr capture; `ls-remote` gets 60 seconds and `push` 10 minutes, because they wait on the network. A command killed by its timeout has no exit code and is reported as terminated, never as a refusal. A truncated listing refuses the result (`GitDiffTooLargeError`) rather than returning a partial one.
- The version probe runs in the harness cwd; every query runs in the caller's working directory.
- `worktreeAdd(cwd, path, branch)` and `worktreeRemove(cwd, path)` (B4-P3) — `git worktree add -q -b <branch> <path>` and `git worktree remove <path>`, consumed by the managed-worktree task lifecycle. No `--force` is ever passed; git itself refuses a duplicate branch and a dirty work tree.
- Index/revert operations (B4-P4): `applyIndexPatch(cwd, patch, reverse)` feeds the patch to `git apply --cached [--reverse] -` through the subprocess stdin; `stageFile(cwd, path)` runs `git add -- <path>` (both sides of a rename); `unstageFile(cwd, path)` reverse-applies the staged diff it generates itself (`git diff --cached --binary`, both sides of a rename) so the index moves back toward HEAD with the work tree untouched; `revertFile(cwd, path)` runs `git checkout -- <path>` after refusing untracked and conflict paths up front with `GitRevertRefusedError`. Every write re-verifies the authoritative status where the semantics need it (rename pairs, revert preconditions).
- Commit operations (B4-P5): `authorIdentity(cwd)` reads `git var GIT_AUTHOR_IDENT` (undefined when unconfigured); `stagedTree(cwd)` runs `git write-tree`; `commit(cwd, message, expectedTree)` checks conflicts, empty index, identity, and staged-tree drift in order (nothing written on refusal), then runs `git commit -F -` with the message on stdin. After the commit, `git rev-parse HEAD^{tree}` is compared against `expectedTree` once more: the result `{ sha, treeMatchesExpected }` reports the check-to-commit window loudly instead of letting it pass silently. The same bounded-subprocess discipline covers every write.
- Push operations resolve one effective push URL and validate branch names with git check-ref-format. Preview selects the requested source/destination; candidate history is exact only when the target commit is available locally. Push sends a resolved commit to refs/heads/<destination>, never force/delete syntax, and rejects a changed approved source or URL. Multiple push URLs require an explicit configuration choice. After a successful push the remote-tracking ref (`refs/remotes/<remote>/<destination>`) is advanced to the pushed commit, as git itself does for a push through the remote name; the exact-URL push would otherwise leave status reporting the branch ahead until the next fetch. GitPushRefusedError retains classified refusal details; upstream configuration is untouched and nothing is retried.

-----

<a id="failure-classification"></a>
## Failure classification

See the [seam README](../git/README.md#failure-classification): unavailable, not-a-repository, unsupported-version, command-failed (raw stderr presented, never parsed), and too-large.

-----

<a id="model-experience"></a>
## Model Experience

None, as this provider serves the same read-only facts as the seam — no tools, no prompts, no session events.

#### KV Cache effect

Independent of live requests: the provider adds nothing to the request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Bounded write surface** — status/diff/identity queries are read-only; the only writes are the worktree lifecycle, the B4-P4 index/revert operations, and the B4-P5 guarded commit. Push is a later B4 phase.
- **Windows path style** — git reports paths with forward slashes; the provider presents them verbatim (Git's own spelling) and does not rewrite them.
- **No lock/permission classification** — those failures surface as `GitCommandFailedError` with the original stderr and exit code.
- **No auto-resolution** — revert refuses conflict entries and commit refuses a conflicted index; there is no untracked-file deletion, no `clean`, and no `reset --hard`.

**Runtime invariant:** No companion is published. Every query is a read-only projection of Git facts and failures classify at the seam; the provider exposes no independent event sequence or mutable data relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

DeepSeekGUI owns this package; upstream ships no equivalent. Since B5-P4 its only consumer is the coding-tools plugin, which registers the DSH tools that call this seam — the retired Task capability no longer sits in between.

</details>

File operations use literal pathspecs. Revert can compare the approved patch, and push validates an opaque proof of its exact destination. Public remote URLs and command errors redact credentials; timeouts remain failures.
