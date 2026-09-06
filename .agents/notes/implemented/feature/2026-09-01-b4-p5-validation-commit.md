# Agent Note: B4-P5 Validation & Commit — explicit task actions with streamed runs and a tree-guarded commit

Status: implemented

English | [中文](2026-09-01-b4-p5-validation-commit.zh.md)

## Problem

B4-P4 managed the index; committing still required the user to leave the GUI. Validation and commit need to become one reviewable path: the task owns explicit validation commands (never parsed shell strings), runs stream their real output with honest cancel/timeout/exit facts, and the commit page shows the staged diff, the validation results, the author identity, and the message — executing only after explicit confirmation, with a guarantee that the committed tree is the tree the user actually reviewed.

## Decision

### Task Actions: exact executable/argv/cwd, run state stays with the process owner

`TaskRecord` gains `actions` — the user's explicit validation configuration, each entry an exact `{ name, executable, argv, cwd?, timeoutMs? }` pair (validated non-blank at the wire boundary; `cwd` defaults to the task workdir). `setActions` replaces the whole list durably; the record never holds run state — a validation run lives in the gateway's run table (`validationRuns`: runId → subprocess handle + timeout signal + settled/streamOpened flags), keyed by nothing in the task record, and dies with the run.

`task.startValidation` spawns the action through the subprocess seam with piped stdout/stderr and an optional `AbortSignal.timeout` bound; `task.validationStream` is a dedicated SSE route (`/api/task.validationStream?runId=…`) that forwards output chunks and ends with one `validation/done` frame carrying the independent facts — `exitCode`, `signal`, `timedOut` (the timeout signal's own fact, never inferred), and `error` (a spawn-level failure such as a missing executable rides the done frame, so the UI renders "could not start", never "the user cancelled"). `task.cancelValidation` terminates the tree. No path leaves an orphan: closing the stream terminates a still-running tree (the cleanup is wired to the request signal, not only to generator finalization — an unstarted generator's `return()` never runs its body, a real hazard the tests caught); an aborted start request reaps a run that never opened a stream (an already-aborted signal is checked synchronously); and when the start resolved but the stream never attached, the client cancels best-effort by run id. The UI renders output as it streams and reports the exit facts verbatim: a failed run shows its exit code, a timed-out run its own message, a cancelled run is never marked as passing, and a spawn failure is never marked as cancelled.

### The guarded commit

The git seam adds `authorIdentity(cwd)` (`git var GIT_AUTHOR_IDENT`, `undefined` when unconfigured), `stagedTree(cwd)` (`git write-tree`), and `commit(cwd, message, expectedTree)` (`git commit -F -` with the message on stdin — any characters are safe, nothing is shell-interpreted). `commit` checks in order, writing nothing on refusal: unresolved conflicts (`GitCommitRefusedError('conflict')`), an empty index (`'empty-index'`), a missing author identity (`'identity'`), and staged-tree drift — the index tree must equal the `expectedTree` the user reviewed (`GitStagedTreeDriftError`). A hook refusal or other git failure surfaces as `GitCommandFailedError` with the raw stderr. After the commit, HEAD's tree is compared against `expectedTree` once more: the result `{ sha, treeMatchesExpected }` reports the millisecond window between the drift check and the commit loudly instead of letting it pass silently.

The Commit page (`conversation.view` tab `commit`, sharing the Tasks panel's selection store) renders `task.commitContext`: the author identity, the reviewed tree snapshot, the staged paths and full patch (git-diff facts), and a readiness verdict with the refusal reason — an unready page shows the reason and no confirm path. A staged patch over the size bound degrades to `patchTooLarge` (no patch rides the response; the Repository panel shows it) instead of failing the whole context, so a lockfile-level diff never takes away the commit capability. The confirm button stays disabled until a message is entered; confirming sends the message plus the reviewed tree; drift refuses with an explicit error and the page reloads the fresh context for re-review. On success the task record stamps `lastCommitSha` — a reference only, the tree and message stay with Git — and the SHA feedback survives the post-commit context reload (it clears only when the selected task changes).

### Boundaries held

No automatic stage-all anywhere (the Repository panel remains the only staging surface); a failed validation is shown as failed, never hidden; a model suggestion is not an authorization — the confirm is the user's own click on a page showing the exact staged content. Commit refuses a conflicted index and never runs `clean`/`reset --hard`.

## Verification

- `packages/git/git-local/tests/commit.spec.ts` (6, REAL repositories): author identity facts (configured and unconfigured — the unconfigured case caps the global config away through `HOME`); a successful commit with quotes/Chinese in the stdin-delivered message, the returned SHA, and `treeMatchesExpected: true`; empty-index and conflict refusals (nothing committed); identity refusal; hook refusal with the raw stderr; staged-tree drift naming both trees, then a successful commit after re-review against the fresh tree.
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (B4-P5 block, real gateway + real repos + real spawned processes): setActions durability and the unknown-action code; a real `node -e` validation streamed stdout/stderr chunks and the done facts; commitContext + commit success with the SHA stamped on the task and `treeMatchesExpected: true`; empty-index refusal and drift codes; cancel terminating the tree with the done frame; timeout reporting the independent `timedOut` fact; stream close terminating a still-running tree (registry drops the run); a spawn failure arriving as a done frame with the failure fact; a start request aborted before the stream opening being reaped (nothing to cancel later); a too-large staged patch degrading to `patchTooLarge` while the commit still succeeds.
- `apps/desktop/workbench-plugin/tests/commit-view.client.spec.tsx` (jsdom): no-task hint; author/staged/patch rendering; refusal without a confirm path; confirm disabled until a message, then the wire carries message + reviewed tree; drift as an explicit error with context reload; validation run with honest pass facts; the committed SHA surviving the post-commit context reload; a spawn failure rendering as an error, never as cancelled; the `patchTooLarge` notice keeping the confirm path; the `treeMatchesExpected: false` warning rendered loudly.
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx` (jsdom, extended): adding a validation action saves the exact executable/argv list; running one reports the exit facts.
- `apply.client.spec.ts` extended to the ten slot contributions including the Commit tab.

## Alternatives considered

**Parsing a shell command string for Task Actions.** A string invites quoting bugs and injection surface; the action is stored and spawned as exact executable/argv, and argv is entered as separate arguments.

**Validation via `git add -p`-style or TTY protocols.** The subprocess seam's piped streams plus the SSE route give the GUI the raw output with no terminal dependency, and cancellation is tree-scoped by the seam.

**Committing without a tree guard.** A user could confirm a staged diff that no longer matches the index (external edits, another GUI action); the `expectedTree` snapshot makes the drift a hard refusal with an explicit re-review message instead of a silent surprise commit.

**Persisting run state or commit content in the task record.** Run state is process-owner state and dies with the run; the commit's tree and message stay with Git — the record keeps only the SHA reference.

## Consequences

Validation and commit are one reviewable GUI path: explicit actions, streamed real output, honest exit facts, and a commit that can only ever build the tree the user confirmed. The git seam's write vocabulary gains exactly the guarded commit; push remains a later phase. The task record grew two configuration/reference fields and no run state.
