# Agent Note: B4-P8 Background Work, Review & Notifications — official projections aggregated, one-shot event-driven notifications

Status: implemented

English | [中文](2026-09-02-b4-p8-background-review-notifications.zh.md)

## Problem

B4-P7 gave each task a terminal, services, and a browser bound to its workdir; the task's everyday loop still scattered its background facts — jobs, subagents, goals, plans, todos, approvals — across the official per-session UI, and long-running work had no way to reach the user outside the window. P8 must organize the existing Harness capabilities into a task-level view without copying any capability's state into a task record, keep a Review queue that references only Repository Changes, validation, commit/PR, and pending approvals, and turn authoritative completion/failure/approval events into desktop notifications that never duplicate and click through to the right session.

## Decision

### Task page: the official projections, aggregated per attached session

The Tasks panel's expanded detail gains a "Background work" section (`TaskBackgroundWork`) with one row per attached session. Every fact rides the official client-runtime list store through the framework `useSessions` seat — nothing is copied into a task record and nothing polls: jobs (`jobsBySession`), subagents (`subagentsByParent`), the pending-interaction marker (`pendingInteraction`: approval / plan-review), and the host-computed session projections via the list row's `projectionValues` (goal phase+objective, plan active/pending, todo done/total). On reconnect/restart the official owners rebuild all of it. Workflow runs and produced deliverables are per-turn chat data rendered by the official conversation view, so the aggregate rows are the entry point: clicking a row opens that session, where those official components live. A session that left the official list renders its raw id with a "left the list" badge — never a guessed state.

### Review queue: references only, loaded on open

A new `conversation.view` tab (`review`, sharing the Tasks selection store) lists every open task with exactly the facts its name promises: Repository Changes from `git.status` (conflict count first, then staged/unstaged/untracked), the latest validation results from the new `task.validationRuns` RPC (per action, from the process owner's run table — a settled run stays until the next run of the same action or the task's archive, and after a host restart the column honestly shows "no runs"), the commit and PR references from the task record, and pending approvals from the official session projection. Loading happens on open and on explicit refresh only; one row's failure degrades that row, never the queue. Clicking a row selects the task in the shared store, so Commit/Push pick it up.

### Validation run table: kept for the Review queue

The gateway's `validationRuns` table gains the task/action identity plus settle facts (`exitCode`/`signal`/`timedOut`/`error`, updated by the handle's done promise independent of any stream) and keeps settled runs until the next start of the same action or the task's archive — the same lifecycle the P7 service table uses. Closing a validation stream still terminates a still-running tree (never an orphan) but no longer deletes the run; `task.archive` now terminates and awaits running validations and drops the task's run facts alongside the service teardown.

### Desktop notifications: authoritative events, dedup, focus-gated, click-to-session

A new `harness-events` client consumes the official `events.mux` and `events.host` SSE streams (narrow parsing of `session/jobs`, `approval/requested`, `host/agent-error`; everything else ignored, malformed frames fail closed). A new `notification-service` turns them into one-shot requests: the first `session/jobs` snapshot per session is a baseline and never notifies (reconnect replays therefore cannot misreport); only a status transition into `completed` / `failed` notifies once per job id (`killed` stays quiet — an explicit termination is known); an approval notifies once per approval id (the mux replay of pending approvals is deduped); `host/agent-error` dedupes per session+message inside a cooldown window. The memory is a small desktop file (loss = at most one duplicate notification, never data), so restart/reconnect replays stay quiet. The main process connects the streams only while the harness phase is `running`, disconnects on every other phase, and reconnects with a bounded delay after a transport failure — notifications are an enhancement, never a status source. A system notification is skipped while the main window is visible and focused (the user is already looking at the official UI); clicking one focuses the window and writes a one-shot `navigateRequest { sessionId, nonce }` into the control model, which the Workbench sidebar actions consume through their existing model poll (once per nonce) by opening the session via the official `sessions.open`. Compatibility View has no Workbench plugin and only receives the focus.

### Unarchive: navigation-only reversal

`task.unarchive` flips `open` back to `true` durably and idempotently — archiving hid navigation only, so unarchiving reverses exactly that flag: Git, sessions, and process facts are untouched (archive already runs the kill → await exit teardown for that task's services and validations). The archived section's rows gain a Restore button; the wire gains `task.unarchive`.

## Verification

- `packages/task/task/tests/task.spec.ts`: unarchive durability, workdir/identity unchanged, idempotence (no write, no stamp).
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (B4-P8 block): unarchive over the wire including a restart; `task.validationRuns` answering latest-per-action exit facts (pass/fail/timedOut, argv/cwd, replacement by a newer run); archive terminating running validations and dropping the task's run facts; the P5 stream-close test updated to the kept-settled-run lifecycle.
- `apps/desktop/tests/notification-service.spec.ts` (8): baseline-never-notifies; transition-only notifications (completed/failed once, killed/stopping quiet); per-session isolation; approval id dedup; agent-error cooldown; memory parse/serialize (bad shapes fall back empty).
- `apps/desktop/tests/harness-events.spec.ts` (5): mux jobs/approval parsing, host agent-error parsing, ignored frames, malformed frames fail closed, HTTP error rejection, abort-driven shutdown.
- `apps/desktop/tests/control-model.spec.ts`: `navigateRequest` passthrough and null default.
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx`: aggregate rows rendering jobs/subagents/goal/plan/todos/approval projections from the official list store; row click opens the session; no-sessions hint; Restore posting `task.unarchive`.
- `apps/desktop/workbench-plugin/tests/review-view.client.spec.tsx` (4): queue rows referencing git status/validation/commit/PR/approvals; clean + no-runs + no-commit + no-PR states; a failed repo read degrading that row only; row click selecting the shared task.
- `apps/desktop/workbench-plugin/tests/desktop-actions.client.spec.tsx`: navigateRequest opens the session once per nonce; a new nonce navigates again; absent request never navigates.
- `apply.client.spec.ts` extended to the twelve slot contributions including the Review tab.

## Alternatives considered

**Host-side aggregated RPC for the task page.** A `task.overview`-style projection would double the data path the official client-runtime already maintains; the list store's `jobsBySession`/`subagentsByParent`/`projectionValues` are the official per-session projections, readable through the one framework hook, and they rebuild on reconnect by their own owners.

**Persisting notification memory inside uiState.** The UI-state schema is a strict whitelist; notification memory is a loss-tolerant dedup aid, so it lives in its own small file with a lenient parser instead of growing the strict schema.

**Job completion as an incremental event.** The official stream carries `session/jobs` as whole snapshots (the registry holds no durable event); the service diffs snapshots against its own baseline, which is what makes reconnect replay and restart safe.

## Consequences

Each task now aggregates the official background projections per attached session with zero copied state; the Review queue references only named owners and never polls; desktop notifications are one-shot, deduplicated across reconnect/restart, gated by focus, and click through to the exact session via a nonce-guarded navigation request. The task record gained no field; the wire gained `task.unarchive` and `task.validationRuns`; the gateway's run table gained the Review lifecycle; the desktop gained one SSE client, one notification state machine, and one model field.
