# Agent Note: Split the desktop main process by owned responsibility

Status: implemented

English | [中文](2026-09-10-b6-p8-main-process-responsibility-split.zh.md)

## Problem

`apps/desktop/src/main.ts` was the entire Electron entry point: startup assembly, window and tray lifecycle, the DSH terminal, the browser pane, plugin recovery, permission switching, the update state machine, the Managed Home migration sequence, feedback, and diagnostics — all inside one `app.whenReady()` closure, with module-level helpers mixed into the same file. A reader could not tell which responsibility owned which mutable fact, and the pure helpers could only be exercised through the whole application.

Three kinds of leftover had no call-site evidence. Exported values had no importer anywhere, including tests. Git-seam methods whose GUI and task consumers retired with the APIProxy had no in-repo caller. And the Node experimental warning seen in packaging logs had never been traced to its process.

## Decision

Extract only responsibilities that are cohesive, independently nameable, and own no mutable state; `main.ts` keeps assembly and every state owner.

- `harness-settings.ts` reads scalar preferences (`ui-theme.preference`, `locale.preference`) from the official `settings.yaml`. The settings watcher, the locale cache, and `applyTheme` stay in main: they own mutable state and drive Electron surfaces.
- `update-view.ts` owns the update surface's facts — feed configuration read, install-stamp read/write with its process cache, streamed installer digest, and the `UpdateView` default shape. The update state machine, downloads, verification, and the install handoff stay in main, which is the only writer of update state.
- `crash-evidence.ts` gains `collectCrashDumpEvidence`, joining the collection plan it already owned; that file is now the one home for crash evidence.
- `migration.ts` gains `nodeMigrationFacts`, the production `MigrationTargetFacts`. Target judgement and its file-system facts now live together. The three migration entry points keep their order and stay in main, because that order is the safety property: `runHomeMigration` validates, stops the service, copies and verifies, writes the manifest, switches the pointer, and then asks the user to restart; `verifyMigrationOnStartup` re-checks the manifest against the new location on the next start; `runMigrationCleanup` refuses to delete anything unless the manifest says `verified`. Nothing in this change moves verification into the migrating process or exposes the delete entry earlier.

Cleanup decisions in the same phase:

- Un-exported twelve value exports with no importer (verified by searching `apps/desktop` including `tests-e2e`), and deleted one e2e helper with no caller.
- `worktrees()` is a live call from the workbench inspector; `stageFile`, `unstageFile`, and `revertFile` are live calls from the coding-tools plugin's model tools. `worktreeAdd`, `worktreeRemove`, and `applyIndexPatch` have no in-repo caller, but they remain the Service Definition of the published `@deepseek-ai/dsh-git` release package, so they are kept and the ledger conclusion is corrected rather than the methods deleted.
- The Node experimental warning is `stripTypeScriptTypes is an experimental feature`, emitted by upstream `dsh-code-runtime-worker-thread` when the `run_code` tool strips types. It is kept and recorded.

## Alternatives considered

**Move every stateful cluster behind a factory.** Rejected. Plugin recovery, the terminal, the browser pane, the update machine, and feedback each read and write several closure facts that are also read by the control model, the tray, and the command dispatcher. A factory per cluster is a Manager layer with an injected dependency list — the phase forbids it, and it would not reduce coupling, only rename it.

**Add an event bus between main and the extracted modules.** Rejected. The control model is already the single observable projection of runtime facts; an event bus would add a second path to the same state.

**Move single functions to satisfy a line target.** Rejected. Line count is not the objective; the extracted units are chosen by owned responsibility, and the remaining ones are not.

**Delete the three git-seam methods with no caller.** Rejected for this phase. They are part of the published `@deepseek-ai/dsh-git` Service Definition (a release-family package, also published to the fork's npm baseline), so removing them changes a provider contract. The correct action is to record the evidence and let the owner decide; the ledger entry is corrected.

**Silence the Node experimental warning with `NODE_NO_WARNINGS` or `--disable-warning`.** Rejected. Both are process-wide, and the warning comes from an upstream package documented as relying on that experimental API.

## Consequences

The main process still owns every mutable fact and the Electron lifecycle; the extracted modules are pure enough to test without an Electron instance. `main.ts` loses about 400 lines of helpers without changing any behavior, state owner, or call order.

The update and migration sequences are unchanged by construction: their functions were not moved, and their call sites still run in the same order. The migration delete entry remains gated by a manifest written by a previous run.

The repository keeps its existing dynamic-entry surface. Knip stays the fork's ad-hoc baseline rather than a gate — upstream removed it in [Remove Knip from repository gates](../process/2026-08-19-remove-knip.md), and this fork re-added `knip.json` in commit `4e7868d671`. Its remaining findings are snapshot fixtures, e2e drivers, and corpus files loaded by name, plus module data shapes; none is dead code.

## Verification

`pnpm run typecheck` and `pnpm run build:desktop` exit 0. `NODE_ENV=development vitest run apps/desktop/tests apps/desktop/workbench-plugin/tests` — 72 files, 1220 passed, 1 skipped. Added `tests/harness-settings.spec.ts` (settings document shape, quoting, CRLF, degradation) and `tests/update-view.spec.ts` (default view shape, feed configuration, digest, install stamp with a fresh module per cache case), and extended `tests/crash-evidence.spec.ts` (collection from a synthetic Crashpad directory, missing directory) and `tests/migration.spec.ts` (`nodeMigrationFacts` existence, emptiness, writability, free space).
