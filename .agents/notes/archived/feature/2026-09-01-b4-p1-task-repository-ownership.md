# Agent Note: B4-P1 Task–Repository Ownership Spike — the minimal task capability and Workbench task navigation

Status: implemented
Archived: 2026-09-03

English | [中文](2026-09-01-b4-p1-task-repository-ownership.zh.md)

## Problem

B4 organizes sessions around real Git repositories: a task references a working directory and one or more Harness sessions without becoming a second Agent runtime or a second Git state. B4-P1 must prove that minimal ownership with a durable task record, a Workbench task surface, and no Git writes, no worktree, no task prompt, and no Electron/browser persistence.

## Decision

### The task package: `@deepseek-ai/dsh-task` (`ctx.taskRegistry`)

A new host-side package modeled on `dsh-workspace`: a durable registry over the domain data form (`task` domain v1, one `tasks` table keyed by `TaskId`). A task record holds exactly the B4-specified facts — opaque uuid id, user title, canonical `workdir` (`fs.realpath` at create), canonical `repoRoot` (the `fs.realpath` of `git rev-parse --show-toplevel` output), the work mode (schema carries `'local' | 'managed-worktree' | 'attached-worktree'`; B4-P1 creates only `'local'`), the ordered `sessionIds` account, the `open` lifecycle flag, and ISO timestamps. Git owns the repository and Harness owns the sessions; the record references both and copies neither.

Creation confirms the Git identity **read-only** through the subprocess seam — `resolveExecutable('git')` plus `spawn(['git', 'rev-parse', '--show-toplevel'], cwd: workdir)` with collected stdio, exact executable + argv, never a shell string, a 10-second probe deadline, and a 5-second terminate grace. A non-repository directory rejects with `TaskNotARepositoryError`, an unresolvable git with `GitUnavailableError`, and neither writes anything. No worktree creation and no Git write path exists in B4-P1.

Session attachment reuses the workspace membership discipline: the session must exist (live or in session persistence, else `TaskUnknownSessionError`) and its header cwd must canonicalize to an existing directory equal to the task `workdir` (else `TaskAttachMismatchError`); mismatches reject without writing. `sessionIds` is the synchronous id-plus-canonical-cwd projection, filtered and pruned like workspace accounting. `status()` is the uncached directory check (`'ok' | 'missing-dir'`) that never mutates the record and never fabricates a replacement directory.

The domain needs no global singleton and no display order: listing derives from record timestamps (newest first, stable id tiebreak), archiving is the record's own `open` flag, and a single-table write needs no pending-mutation marker. The package ships the `task-invariant` companion asserting the entity cache mirrors the `tasks` table.

### The wire domain: `task.*`

The api gateway (`dsh-host-apiproxy`) adds the closed `task.*` domain — `list`, `get`, `create`, `rename`, `archive`, `status`, `attachSession`, `detachSession` — with wire schemas, the `RpcMethodMap` rows, the fetch carrier pair, and five new error codes (`task-not-found`, `task-invalid-path`, `task-not-repository`, `git-unavailable`, `task-attach-mismatch`) in `RpcErrorDetailsMap` and the error schema. `create` maps only the registry's business rejections to domain codes; durability failures propagate as internal errors. The client connection fixture implements the domain as an in-memory double so the official client test lane can exercise the surface without a host.

### The Workbench surface: Tasks panel

`apps/desktop/workbench-plugin` registers a third `conversation.view` tab (`id: 'tasks'`, order 40). The panel talks to `task.*` through the standard JSON-RPC wire envelope (a `taskClient` fetch wrapper in the B3-P4 `fsClient` pattern) and renders:

- the task list (open tasks; archived tasks in a collapsible section) with the `local` mode badge and a live `unavailable` badge when the workdir is missing;
- the current task selection, an entry-level viewing store (`deepseekgui.tasks.view.v1`) that survives session switches and panel remounts;
- per-task details: title rename (inline), `workdir`/`repoRoot`, the attached sessions (click to open through the official selection; detach per row), `New session in this task` (official `session.create` RPC with `cwd: task.workdir`, then open), `Attach current session` (validated by the host), and `Archive task`;
- the create form (title + workdir path) whose failures render the wire message.

The panel holds no task facts beyond the viewing selection: every mutation re-fetches host truth, and no Electron or browser persistence exists (the only persisted client state is the viewing store, which the workspace browser precedent already uses).

### Deliberately absent in B4-P1

No Git writes, no worktree creation, no task prompt or auto title, no task state machine or queue, no second session store, no `host/*` change frames (clients refresh after their own mutations), and no unarchive or task deletion — each waits for its B4 phase or a documented consumer.

## Verification

- `packages/task/task/tests/task.spec.ts` (21) and `invariant.spec.ts` (3): create over a mocked read-only git probe (exact argv asserted), non-repository/git-unavailable/missing-path rejections without writes, list order, rename, archive idempotence, attach/detach with cwd validation and clear unknown-session errors, status after external directory removal, restart recovery through a shared medium, and startup filtering of stale session accounts; the invariant companion suite pins the cache/table relationship.
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (7): the composed gateway over real Session/Agent/Storage/Subprocess/Task services with a **real `git init` fixture** — create/list/get/rename/archive, subdirectory repoRoot, non-repository and invalid-path codes, restart recovery over a shared medium, unavailable status after directory removal, attach/detach of real sessions by cwd with `session-not-found` / `task-attach-mismatch`, and the independence of the native session store.
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts` (11): wire envelope, payloads, and error-code surface of every task.* method plus the `session.create` passthrough.
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx` (12, jsdom): list/status rendering, selection, session open/detach/attach, archive, create form, archived section, injected session creation, and mutation error rendering.
- `apply.client.spec.ts` extended to the eight slot contributions including the Tasks tab.
- Focused `tsc -b` over task, apiproxy, connection, and the workbench plugin.

## Alternatives considered

**Client runtime TaskRuntime projection.** The workspace pattern (runtime domain + list baseline + changed frames) is heavier than B4-P1 needs: the spike requires one panel whose mutations re-fetch, and B4-P2's Git read model will decide the real-time projection shape. The `fsClient`-style direct wire client keeps B4-P1 minimal without prejudging that decision.

**Git probing through a second mechanism.** The subprocess seam is the harness's one execution world; probing anywhere else (Electron exec, raw `child_process`) would bypass provider and policy semantics.

**A registry-global display order and archive set.** Task listing derives from record timestamps and archiving is a record flag; a second order/archive table would duplicate state the record already owns.

**Host change frames for tasks.** Unary responses already echo the full updated task; a frame system would be an unrequested second channel until a multi-surface consumer (B4-P8 notifications) exists.

## Consequences

The web profile composition gains `@deepseek-ai/dsh-task` (host) and the gateway's `task.*` domain; the Workbench gains a Tasks tab whose facts all live in the host registry. Task creation costs one bounded read-only `git` probe. Session attach validates cwd against the task workdir, so sessions created in other directories fail clearly instead of silently drifting. The B3 workspace/session surface is untouched: closing the Tasks panel or entering Compatibility View leaves native Workspace/Session use fully independent. B4-P2's Git read model and B4-P3's worktree lifecycle build on this record without a schema rewrite (the mode union is already durable).
