# Agent Note: B4-P3 Local/Worktree Task Lifecycle — three honest work modes with an explicit managed-worktree transaction

Status: implemented

English | [中文](2026-09-01-b4-p3-task-worktree-lifecycle.zh.md)

## Problem

B4-P1 tasks point at the user's current checkout only. Coding work needs parallel checkouts without touching the user's main working tree: the GUI must create, attach, and remove Git work trees, each bound to a task record, with Git as the sole owner of repository state and no hidden state anywhere. The lifecycle must be honest about every failure (a created-but-unrecorded work tree, a dirty removal, a tree removed outside the GUI), and a session handed from one task's checkout to another must carry visible context through the official mechanisms — never a rewritten cwd, never a copied hidden transcript.

## Decision

### The git seam gains the only writes it will ever offer

`GitCapability` (Service Definition) and `LocalGitCapability` (local provider) add exactly two write methods, both consumed by the task lifecycle and both delegating refusal to git itself:

- `worktreeAdd(cwd, path, branch)` — `git worktree add -q -b <branch> <path>`. A branch that already exists fails as `GitCommandFailedError` with the raw stderr.
- `worktreeRemove(cwd, path)` — `git worktree remove <path>`, never with `--force`; a dirty work tree is refused by git, and the task layer refuses it before the command even runs.

Both run through the same bounded subprocess discipline as every read (30-second deadline, 5-second grace, bounded collected output). The seam stays read-only for everything else; stage/revert/commit/push remain out of scope.

### TaskRegistry: three honest modes, one explicit transaction

`TaskMode` now means what it says: `local` (the user's checkout), `managed-worktree` (owned by the task, created and removed through the git capability), `attached-worktree` (referenced; the GUI never deletes it — no removal path exists for this mode).

`createManagedWorktree({ repoRoot, branch, path, title? })` is one explicit transaction over exactly the resources this call can identify: validate (branch non-blank, path absolute, path not already registered via `ctx.git.worktrees`, path not existing) → `ctx.git.worktreeAdd` → record put. A record-write failure rolls back by removing the work tree this call created; if that rollback also fails, the thrown `AggregateError` names the orphan path so it stays recognizable. No force, no prune, no lease, no retry.

`createAttachedWorktree(workdir, title?)` verifies the directory is a registered work tree of its repository through `ctx.git.worktrees` and refuses the main checkout. The main checkout is identified as the FIRST record of `git worktree list --porcelain` (git-worktree(1) documents the ordering) — never from `git rev-parse --show-toplevel`, because inside a linked worktree that probe reports the worktree itself, which made an early implementation mis-identify every attached worktree as the main checkout. The record's `repoRoot` is the main checkout root, shared by every task of the repository.

`removeManagedWorktree(taskId)` checks in this order and refuses — nothing removed, record kept — when any fails: task exists, mode is `managed-worktree` (`TaskWorktreeNotManagedError`), the work tree is still registered (`TaskWorktreeNotFoundError` when removed outside the GUI — the task then reports `missing-dir`), the status is clean (`TaskWorktreeDirtyError`), and no attached session is live (`TaskWorktreeBusyError`, read through `ctx.get('sessions')`). After removal the record stays for the user to archive; there is no task deletion path. Post-crash re-alignment needs no lease or repair: the task record and the Git worktree fact each survive independently, and every removal re-verifies the live facts before acting.

### The wire domain and the Workbench surface

The gateway adds `task.createManaged`, `task.createAttached`, and `task.removeManagedWorktree` with five new error codes (`task-worktree-conflict`, `task-worktree-dirty`, `task-worktree-busy`, `task-worktree-not-managed`, `task-worktree-not-found`); the git capability's rejections map through the shared git-domain codes. The connection fixture and both test fake-API clients mirror the domain.

The Workbench Tasks panel gains a three-mode create form (local / managed-worktree / attached-worktree with mode-specific fields), mode badges on every row, a removal button for managed tasks (only while the directory exists), and a handoff button on every task. Handoff uses only official visible mechanisms: `session.create({ cwd: task.workdir })` creates a NEW session at the target checkout, then `session.prompt` delivers an explicit handoff message (target task title, workdir, source session title) as a normal model-visible user message. The old session's cwd is never changed and no hidden transcript is copied; the handoff text is part of the new session's own log.

## Verification

- `packages/task/task/tests/task-worktree.spec.ts` (11, REAL temporary repositories): managed creation records the real Git fact; two parallel worktrees in one repository; path-exists/already-registered/relative-path rejections; record-write-failure rollback (the created work tree is gone again); attach of an existing worktree; main-checkout and non-worktree rejections; clean removal (record kept, `missing-dir`); dirty refusal; live-session refusal (clears on detach); removal refused when the tree was removed outside the GUI; restart re-alignment then removal.
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (14, real gateway + real repo, includes the B4-P3 block): managed create over the wire with the real Git fact; conflict/relative/blank-branch/duplicate-branch codes; attached create, main-checkout/non-worktree/plain-dir codes, and the not-managed removal code; clean removal, dirty and externally-removed refusals, live-session refusal; restart re-alignment.
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts` (20): the three new methods' wire envelopes and codes, plus `promptSession` and the `handoffSessionToTask` sequence (session.create then session.prompt with the handoff text).
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx` (jsdom): managed/attached create forms, mode badges, removal button visibility rules, removal call, and the handoff sequence.
- Machine-dependence fix: the home directory on the development machine accidentally became a Git repository mid-phase (an empty `.git` with no commits, created by an external tool, not part of this project). Temp-root directories therefore sit inside a repository, which broke every "outside any repository" test. The tests now cap discovery at the temp root with `GIT_CEILING_DIRECTORIES` (set via `vi.stubEnv`; the ceiling reaches the spawned git through the inherited environment), making "outside any repository" deterministic on every machine. The stray home `.git` was left untouched (user data).
- The mock-honesty discipline from B4-P2 review continues: the worktree-porcelain parser's fixtures come from real `git worktree list` output (parse-real.spec.ts), never hand-written bytes.

## Alternatives considered

**Force-removing a dirty work tree.** `git worktree remove --force` would destroy uncommitted user work; the task layer refuses dirty removals before git is even asked, and the seam passes no `--force` anywhere.

**Reusing the old session for a handoff.** Changing the old session's cwd would rewrite history the session log already records; copying its transcript into the new session would duplicate model-visible content outside the log. A new session at the target cwd plus an explicit, logged handoff message is the only mechanism that keeps every fact in its owning log.

**Pruning or repairing on startup.** A worktree removed outside the GUI leaves its task record reporting `missing-dir`; the user archives it. A lease, watchdog, or auto-repair would guess about user intent; re-alignment is purely re-verification of live Git facts at each operation.

## Consequences

The web profile's task domain and Workbench Tasks panel now cover all three work modes; the git seam's write surface is exactly two worktree lifecycle methods and nothing else. Every removal path re-verifies dirty/live/ownership facts immediately before acting, so a stale record can never cause data loss or a surprise git failure. Handoffs are ordinary logged user messages in the new session. B4-P4 index operations (stage/revert) extend the same seam, and its read-model failure vocabulary carries forward unchanged.
