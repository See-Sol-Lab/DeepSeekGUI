# Agent Note: B5-P6 — interaction & background continuity

Status: implemented

English | [中文](2026-09-04-b5-p6-interaction-and-background-continuity.zh.md)

## Problem

B4-P8 notifications consumed two SSE streams (`events.mux` / `events.host`) that the APIProxy removal (B5-P1) deleted, leaving the desktop with an inert events scaffold and no product path for approvals, questions, background completion, or click-to-session. The GUI must not grow a second queue for running-turn input, must not re-infer job/validation/service state from retired task tables, and must not recreate heartbeat/reconnect logic the official connection already owns.

## Decision

- Running-turn interjection stays purely official: the GUI adds no queue and no steer machinery — composer queueing and the official queue dock are the only paths.
- The Web consumer watches official pending interactions and job lists. It deduplicates approvals by correlated call id, or by the pending request key when uncorrelated; questions use their pending request key, not reusable question-item ids. Job notices follow completed/failed transitions with baseline suppression. The Session-aware consumer suppresses only a fact currently being viewed, and the desktop does not apply a second blanket focus filter.
- The desktop displays the authenticated, length-bounded notify command and writes a one-shot navigateRequest on click. The existing Workbench consumer opens the exact target Session. Notification state and reconnection remain with their existing owners.
- Runtime detail extends with read-only owner rows (B5-P6 ruling): background jobs and subagent sessions exactly as the official lists publish them, single-line Plan/Todo/Goal projection facts (`plan`/`goal`/`todos` keys narrowed structurally), and a pending approval/question marker from the official interaction fact. No state machine, no local aggregation, no interaction (no start/stop/tick), and validation/service rows appear only when the owner publishes them as jobs — never inferred from task tables or history.
- Process ownership is unchanged and verified: stop and app quit already await the full DSH process tree (`taskkill /T` with retry/wait), terminal trees, and plugin-operation trees; session-end cancellation is official tool/agent semantics. No new owner was introduced.

## Alternatives considered

- Have the desktop main process connect its own official gateway WebSocket (packaging a second connection client and re-implementing its compensation); rejected — the official web connection consumes the facts and the stateless control bridge carries one-shot notifications.
- Keep a local heartbeat/reconnect compensation beside the official connection; rejected — deleted with the retired events stream scaffold.
- Infer job/validation/service state from the retired task tables into Runtime detail; rejected — rows come from the owners (jobs lists, projections, pending interactions), read-only.

## Verification

- Plugin: `tsc -b apps/desktop/workbench-plugin` clean, oxlint 0 errors, 63 focused tests pass (registration surface incl. the notifier entry and the fourth locale namespace, notifier-model dedup/baseline specs, owner-facts narrowing, jsdom watcher one-shot behavior, control-model notify parse cases).
- Desktop: `tsc -b apps/desktop` clean; control-dispatch/harness-controller/dsh-service/quit-confirm suites pass (129 tests).
- `verify-client-ui-i18n` green. Real-path smoke: desktop Electron against a real dsh 0.1.2 service prints `[deepseekgui] window loaded` with no loader/console errors; after quit the service port is free and no orphan process remains. Visual notification behavior and model-driven end-to-end evidence are handed to acceptance.
- Pre-existing `no-unnecessary-condition` findings in `apps/desktop/src/main.ts` (spawn stdio lines untouched by this phase) were confirmed identical on the committed HEAD file and left for the owning sweep rather than silently changed here.

## Consequences

- Notification diagnostics use the control response and page state. The [current-inspection decision](../feature/2026-09-05-workbench-current-inspection.md) owns the implemented fs/Git query route; no desktop event stream or duplicate reconnect loop is introduced.
