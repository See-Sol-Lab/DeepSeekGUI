# Agent Note: B5-P1 — APIProxy retirement and official Remote reads on the desktop

Status: implemented

English | [中文](2026-09-03-b5-p1-apiproxy-retirement-and-remote-reads.zh.md)

## Problem

dsh 0.1.2 removed the APIProxy host RPC layer the DeepSeekGUI B4 GUI was built on. The retained `packages/host/apiproxy` tree referenced modules 0.1.2 deleted (its official-domain files were removed by the upstream merge) and could not compile. Every runtime caller pointed at dead endpoints: the Workbench browser plugin (`task.*`/`fs.*`/`git.*`/`pr.*` HTTP clients over `POST /api/<domain>.<method>`) and the Electron main process (`harness-api` settings/session/task RPC, `harness-events` WS `events.mux`/`events.host` notification streams). B5-P0 kept the package out of the build graph as P1's migration input and kept `workbench-plugin` out of the client graph until B5-P2; P1 retires the proxy and moves the readable surface onto the official Remote endpoints without rebuilding a look-alike.

## Decision

The old APIProxy surface retires in B5-P1; each former caller either moves to an official 0.1.2 Remote method or is removed with its recovery phase recorded:

| Former surface | Disposition | Official equivalent / recovery |
|---|---|---|
| `packages/host/apiproxy` (schemas, handler, client, tests, exports, tsconfig aliases/exclusions, tsdown workspace entry, generator exemptions, subsystem docs) | deleted in B5-P1 | none — the remote-migration Agent Note 2026-08-10-unary-apiproxy-remote-migration.md already moved the official domains to their business Remote owners |
| main-process `harness-api` `settings.describe`/`settings.mutate` | migrated | `settings/describe` (no args), `settings/mutate` (flat args `{ ns, ops, expectedRevision? }`) |
| main-process `session.list`/`session.create`/`session.prompt` | migrated | `session/list` (single-request endpoint whose host parameter is named `_request`, so args are `{ _request: {} }`), `session/create`/`session/prompt` wrapped as `{ args: { request } }`; `session/prompt` requires a client-minted `requestId` |
| main-process `session.history` tail poll (feedback AI draft) | removed | no unary tail exists in 0.1.2 (`session/page` needs a follow-opening cut; `session/follow` is a stream) — the feedback AI draft is paused on the static template and resumes over the official follow/WS channel (B5-P2/P6) |
| main-process `task.get` (Task Terminal cwd, declared-service URL check) | removed | `show-task-terminal`/`open-service-url` commands left the control model and dispatcher; tool-native task paths restore the entry (B5-P4) |
| main-process `harness-events` (`events.mux`/`events.host` WS notifications) | removed | the endpoints are gone and the wire protocol has no 0.1.2 equivalent; desktop notifications pause (service, dedup memory, and click-to-navigate wiring stay in git history) and resume over the official gateway WebSocket once token alignment lands (B5-P2/P6) |
| `workbench-plugin` B4 conversation views (Files, Session Changes, Tasks, Repository Changes, Commit, Push, Review) and their `fsClient`/`gitClient`/`taskClient`/stores | removed | the plugin keeps the brand seat, the session-header marker, and the desktop status action only. Recovery: agent coding actions re-enter as DSH tools with results logged as session events (B5-P4); Files/Changes/Git/Review inspection re-enters as on-demand inspectors over official projections (B5-P5); direct conversation entry ends the Tasks navigation role (B5-P3); the plugin itself remounts on the 0.1.2 client modules (B5-P2) |
| Session event reads (workbench) | migrated in principle | the client never holds a second full events copy; official `ctx.sessions`/`SessionEventStream` (`session/page`/`follow`, seq cursors, `loadOlder`/`loadThrough`) is the replacing read path once B5-P2 remounts the plugin |

No compatibility shim, alias, or renamed re-creation of the old proxy exists after B5-P1. Generated catalog/doc-graph sources were edited in the same change; regenerated artifacts belong to the acceptance build.

## Alternatives considered

- Run the old APIProxy HTTP domain beside the official Remote API during the migration (two wire planes, two auth paths); rejected — the retirement is one move onto official Remote with a single cookie/token channel.
- Carry the B4 Files/Changes/Tasks/Git/Review views over onto the official client as-is (they talked to deleted `task.*`/`git.*`/`fs.*` domains); rejected — the views retire with the domains and re-enter phase by phase as official projections and tools.
- Authenticate desktop reads with a long-lived token stored in the page instead of the one-shot launch token exchanged over the service stdout; rejected — the one-shot channel plus cookie keeps the credential surface minimal.

## Verification

- Desktop host graph typechecks (`tsc -b apps/desktop`).
- Focused unit suites green: apps/desktop tests (152 tests including the rewritten `harness-api.spec.ts` endpoint/args/envelope cases) plus the node-environment workbench specs (`apply`, `bridge`). The jsdom workbench specs fail on a pre-existing React-production-build resolution issue in the plugin's private `node_modules`, owned by B5-P2.
- Real-path check passed (B5-P1 rework): the migrated main-process client, authenticated through the official one-shot token exchange (`GET /?token=` → session cookie), called a real dsh 0.1.2 web service and received `ok:true` for both `settings/describe` and `session/list` — with `session/list` args carried as `{ _request: {} }`, matching the host `list(_request, signal)` signature the Typert gateway derives wire fields from.

## Consequences

- Nothing imports `@deepseek-ai/dsh-host-apiproxy` after B5-P1: remaining text references live in frozen archived notes and in `apps/desktop/runtime.package-lock.json`, which the B5-P9 packaging run regenerates.
- The B4 flat tabs are gone before their B5-P5 replacement, so the pre-P2 Workbench shows brand/status only — the planned P0/P2 sequencing, not a silent gap; every removed entry names its recovery phase above.
- The 2026-09-01-b4-p1-task-repository-ownership note moved to `archived/feature/` in the same change; its mechanism is superseded by this retirement.
