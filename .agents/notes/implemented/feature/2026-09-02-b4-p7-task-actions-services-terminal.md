# Agent Note: B4-P7 Task Actions, Services & Terminal — task-rooted processes with one owner and redacted output

Status: implemented

English | [中文](2026-09-02-b4-p7-task-actions-services-terminal.zh.md)

## Problem

B4-P5 ran one-shot validation commands, but the task's everyday coding loop still lacked a rootable terminal, long-running project processes with honest process facts, and a browser that opens only what the task declares. Two worktree tasks must never cross cwd; a service must have exactly one owner (stop, app quit, and task archive all run the same kill → await exit teardown); no stop/crash/quit/archive/cancel may leave an orphan; and project output must be credential-redacted on the wire while project processes never receive Harness credentials in their environment.

## Decision

### Task Terminal: the desktop terminal rooted at the task workdir

A new closed control command `show-task-terminal { taskId }` opens the existing DSH Terminal at the task workdir. The browser sends only the taskId; main resolves the workdir from authoritative `task.get` (a new strict `taskGet` client on the desktop's minimal Harness RPC client) — never a browser-supplied path, the same rule session terminals follow. `openDshTerminal` gained an optional task-cwd override: when the resolved workdir still exists, the pty host gets `DEEPSEEKGUI_TERMINAL_CWD` set to it and the welcome line says the cwd follows the task; a missing/unresolvable task falls back to the Profile/Home chain like the tray entry — never a guessed path. Session terminals are untouched: `show-terminal { sessionId }` still resolves through `session.list`.

### Project Services: controlled definitions, process-owner run state

`TaskRecord` gains `services` — the user's explicit service configuration, each entry an exact `{ name, executable, argv, cwd?, port?, url? }` (wire-validated: port 1–65535; `url` must be an absolute loopback http(s) URL, `isLoopbackHttpUrl` at the wire boundary). `setServices` replaces the whole list durably; the record never holds run state.

Runs live in the gateway's run table (`serviceRuns`: runId → subprocess handle + task/service identity + startedAt + declared port/url + settle facts), keyed by nothing in the task record. `task.startService` refuses `service-not-found`, `service-already-running`, `service-port-conflict` (another running service of the gateway declares the same port), and `service-port-busy` (a one-shot loopback probe — a single declared port, never a scan — found the port taken on the host); a synchronous spawn failure resolves as an `exited` run with the error fact (a pid −1 handle is awaited to its settle fact before the call answers), never a silent success. `task.stopService` terminates the tree then awaits its exit before answering — kill → await exit. `task.serviceRuns` projects the latest run per service name, running first. `task.serviceStream` is an SSE route streaming output and one done frame with the exit facts.

The decisive difference from validation runs: **closing the service stream detaches only** — a dev server keeps running when the panel closes (unlike validation, where closing cancels). A service ends through exactly four paths: user stop, task archive (the archive handler runs `stopServicesOfTask` — kill → await exit — before the record flips), harness stop (the subprocess seam's disposal terminates every managed tree and awaits exit), and app quit (the desktop already awaits the harness process-tree exit). No supervisor, no self-healing restart, no generic process orchestration.

### Browser: only declared service URLs

A new closed command `open-service-url { taskId, url }` navigates the embedded browser pane. main verifies the URL is a declared service URL of that task (it appears in some service definition's `url` field, read from authoritative `task.get`) and passes a second loopback check (`isLoopbackServiceUrl`) before `loadURL`. No port scanning, no guessing services, no inference of arbitrary background processes; failures reject through the control bridge (HTTP 500) so the Tasks panel shows the reason inline. The pane's navigation still runs under the existing SSRF proxy rules.

### Redaction and environment at the process owner

Project processes spawn through the subprocess seam, whose `scrubbedParentEnv` already refuses credential-shaped names (`KEY`/`PASSWORD`/`SECRET`/`TOKEN`) and all `DSH_*` variables — Harness credentials never enter a project command's environment. Output is redacted at the wire in the gateway: a new streaming redactor (`task-stream-redact.ts`, one per stream so chunk boundaries stay per-stream) replaces literal values of sensitive parent environment entries plus credential-shaped tokens (`sk-`, `gh*_`, `xox*`, `AKIA`, `Bearer`, URL userinfo, `KEY=value`). The token patterns carry word-boundary and length floors deliberately: `sk-` inside ordinary text (`task-service-…`) or a short `key=undefined` must never be mangled. Both the validation stream and the service stream apply it, and both flush the held tail before the done frame so short runs lose no output.

## Verification

- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (B4-P7 block, real gateway + real repos + real processes): setServices durability across a restart (configuration only, never run state); start with full process-owner facts (pid, command, cwd, startedAt, port, url) and stop reporting `stopped` then `false` for the settled run; a real service streaming stdout/stderr and the done exit facts; **closing the stream leaving the service running** (runs list still shows `running`); port conflicts — another running service (`service-port-conflict`) and an external listener (`service-port-busy`); a missing executable resolving as an exited run with the error fact; credential scrub (the child prints `key=undefined`) plus literal and shaped-token redaction (never `sk-…`, always `<redacted>`); two worktree tasks' service processes printing their own cwds and never the other's; archive killing and awaiting the running service.
- `packages/host/apiproxy/tests/task-stream-redact.spec.ts` (5): token redaction; the no-false-positive cases (`task-service-cwd-a-9Ns44I`, `desk-scan`, `key=undefined`, `PORT=8080`); literal env-value redaction; `collectSensitiveEnvSecrets` picking credential-shaped entries and nothing else; single-character chunk splitting never emitting a half-redacted secret.
- `apps/desktop/tests/control-model.spec.ts`: the two new closed commands parsed strictly (missing/empty/extra fields rejected) and `isLoopbackServiceUrl` (loopback http(s) only).
- `apps/desktop/tests/harness-api.spec.ts`: `taskGet` envelope, strict parse of workdir + declared service urls, fail-closed on bad shapes.
- `apps/desktop/tests/control-dispatch.spec.ts`: routing to the injected exits; `open-service-url` errors propagate (the bridge 500 path).
- `apps/desktop/workbench-plugin/tests/task-client.spec.ts` (7 new): the five RPC verbs and the SSE service stream parser.
- `apps/desktop/workbench-plugin/tests/tasks-view.client.spec.tsx` (8 new): saving a service definition with port/URL; rendering the process-owner facts and the running-state buttons; stop; start; port-conflict error inline; the Task Terminal bridge command carrying only the taskId; the browser bridge command carrying the declared URL; the bridge failure shown inline.

## Alternatives considered

**Services owned by the desktop process.** The harness gateway already owns the subprocess seam and the task records; a desktop-side registry would need a second cross-process protocol for archive-time teardown. Keeping the run table next to the validation table gives archive, stream, and redaction one home, while app quit inherits the harness process-tree teardown the desktop already awaits.

**Port conflict as "let the service fail and read its output".** The service would print its own bind error, but the user gets a confusing "running" card. The one-shot loopback probe before spawn makes the refusal explicit and typed (`service-port-busy`); the probe is a single declared port, not a scan, and its race window (probe → spawn) is documented — the service's own bind failure still surfaces through its real output.

**Redacting only credential-shaped patterns.** Literal env values (a custom `DEEPSEEK_*` or user key with an unusual shape) would slip through pattern matching; literal replacement from the same names the scrub refuses to forward closes that gap, with an 8-character floor so short ambient values are never over-redacted.

## Consequences

Each task now has a terminal rooted at its own workdir, explicit service definitions whose runs report pid/port/command/cwd/startedAt and stream real redacted output, and a browser that opens only declared loopback URLs. Every teardown path (stop, archive, harness stop, app quit) kills and awaits; stream detach never kills; nothing restarts itself. The task record grew one configuration field and no run state; the wire grew five task methods, two SSE routes, four error codes, and two closed control commands; the desktop Harness client grew one strict reader.
