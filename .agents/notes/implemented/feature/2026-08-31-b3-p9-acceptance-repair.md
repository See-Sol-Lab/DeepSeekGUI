# Agent Note: B3-P9 acceptance repair — exact session ownership and isolated evidence

Status: implemented

English | [中文](2026-08-31-b3-p9-acceptance-repair.zh.md)

## Problem

B3 requires each Workbench action and asynchronous result to remain owned by the Session the user selected. Without that ownership, a Files response can settle into another Session's view, status polling can transfer unchanged full models, and Terminal cwd can follow global recency instead of selection. Acceptance instances also need a port they own, while user-path masking must recognize system-provided 8.3 aliases as the same Home shown by its long spelling.

## Decision

### Session-owned asynchronous work

Each Files view owns a request generation for one `(sessionId, cwd)` pair. A Session/cwd change or unmount aborts that generation, replaces its pending-path sets, and prevents every late success, failure, or settlement callback from changing the new view. `DesktopActions` carries the last desktop-model revision through the existing conditional endpoint and leaves React state untouched for `changed: false`.

### Exact Terminal and test-instance identity

The Workbench sends the official current `sessionId` through the existing closed `show-terminal` command; main resolves cwd from the matching Harness Session summary. The browser cannot provide a path, and commands without a valid Session use the Profile/Home fallback. Packaged e2e owns port 3081 through `DEEPSEEKGUI_TEST_PORT`; readiness, URLs, Compatibility View, process lookup, cleanup, and teardown consume that one test fact, while production remains on 3080.

### Windows path aliases

`maskWindowsLiterals` replaces every system-resolved spelling of the same Home with one placeholder. Main probes the actual 8.3 Home spelling once on Windows and passes the alias set to UI masking and diagnostics normalization; no `~1` name is guessed. Public screenshots show the placeholder rather than a local long or short path.

## Verification

Deferred-response component tests switch from Session A to B before A settles and prove that B issues its own root request while A cannot publish entries, previews, or errors. Conditional-polling tests cover initial full fetch, `since`, unchanged envelopes, command revision updates, failure recovery, and unmount. Desktop tests cover bare/scoped Terminal command parsing, invalid payload rejection, exact Session cwd resolution, and fallback. Port and path tests pin the isolated e2e environment and system-derived alias masking; parser-level regression cases cover every accepted and rejected scoped-command wire form.

## Alternatives considered

**Keep pending paths global to the component.** A path such as `''` has meaning only under one Session root; sharing it across Session generations can suppress the new root request and publish stale data.

**Use the newest or running Session for Terminal cwd.** Recency is not selection. It can open another repository when several Sessions are active, while the official client already owns the current id.

**Send cwd through the control bridge.** That would trust browser input as a host-path authority. A Session id lets main resolve the path from Harness without a second selection store.

**Clear production port 3080 before e2e.** Tests do not own the resident application. A dedicated fixed test port provides deterministic cleanup without a production multi-instance mechanism.

**Guess the user's 8.3 name.** Short-name allocation is a Windows filesystem fact, not a string convention. Only the system-resolved alias is eligible for masking.

## Consequences

Files has one AbortController and pending ledger per visible Session generation. Workbench status retains a low-frequency request, but unchanged ticks carry only the revision envelope. `show-terminal` has an optional validated Session id and no new persistence; non-Workbench callers retain the previous fallback. Test instances can coexist with the resident product, and path masking performs one Windows alias probe at startup. No Agent runtime, Session store, command bus, filesystem implementation, or B4 Git/worktree state was added.
