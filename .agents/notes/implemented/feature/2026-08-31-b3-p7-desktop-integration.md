# Agent Note: B3-P7 Desktop Integration — revision-gated control bridge and session-aligned terminal cwd

Status: implemented

English | [中文](2026-08-31-b3-p7-desktop-integration.zh.md)

## Problem

Two desktop gaps survived the P1–P6 migration table review against the current code:

1. The DeepSeekGUI sections inside the official settings page (settings-plugin) polled the loopback control bridge every 2 seconds with an **unconditional full-model pull**: `GET /control/model` always returned the whole serialized `DesktopControlModel` (~tens of KB), and the plugin re-set React state every tick even when nothing had changed.
2. The DSH Terminal's cwd was pinned to the active Profile directory (then Harness Home), with no awareness of the Workbench's current session — opening a terminal while working in a session landed the user in a directory unrelated to what they were doing.

## Decision

**Revision-gated control model** (`apps/desktop`):

- `DesktopControlModel` and `ControlModelInput` carry `revision`, a content version maintained in exactly one place (main). `buildModel()` stamps it by comparing a JSON fingerprint of the freshly built model: the revision increments only when the model's content actually changed, so a broadcast that re-sends identical content never bumps it.
- `GET /control/model?since=<revision>` answers `{ revision, changed: false }` (a small envelope) when the caller's revision is current, and the full `{ revision, changed: true, model }` otherwise. `parseModelSinceParam` (pure, tested) rejects missing/empty/non-numeric/negative values as "pull the full model". `POST /control/command` already returns the post-command model, which now carries the revision.
- The settings-plugin's `useDesktopModel` and the Workbench `DesktopActions` keep their 2s cadence but send `?since=` and skip state updates on `changed: false`; command responses advance the caller's stored revision. Polling remains conditional — a tiny envelope per unchanged tick instead of a full-model download — and neither consumer re-renders an unchanged model.

**Session-aligned terminal cwd** (`apps/desktop/src/terminal-service.ts`, `main.ts`):

- The Workbench action reads the official client-runtime current selection and sends only its `sessionId` through the existing `show-terminal` command. The command parser accepts either the bare tray/chrome form or exactly one non-empty `sessionId`; extra keys and invalid ids are rejected.
- Main resolves that id against the authoritative `session.list` and hands only the matched cwd to `resolveTerminalCwd`; the browser never supplies a path. A missing, stale, cwd-less, or unreachable Session follows the unchanged Profile-directory → Harness Home fallback. Tray and chrome commands carry no Session and use that fallback directly.

## Verified already-current (migration-table items checked, no change needed)

Home watcher already re-arms on Home switch (`watchHarnessTheme` closes and re-watches per `followHarnessPreferences` call); the failed-state main window already has Restart via the chrome menu and tray (same closed command union); the tray menu is derived from the same single `DesktopControlModel`; dynamic punctuation, error copy, and feedback templates already live under their locale owners (chrome `view-model` dictionaries, settings-plugin `STRINGS`, `feedback-issue` zh/en branches, `english-errors` guard); the browser pane's viewport is laid out event-driven on window resize (`layoutViews`, no polling); the control bridge is the one command bus (no second one).

## Alternatives considered

**A push channel (SSE/long-poll) for the control bridge.** Event delivery would remove the settings sections' polling entirely, but the bridge is a plain loopback HTTP pair and the sections live inside the official page; a push channel means a new long-lived connection, reconnect state, and lifecycle handling in main. The revision gate keeps the existing request/response shape and removes the actual cost (full-model transfer), which is what the gap was about.

**Sending the cwd from the browser.** A browser-supplied absolute path would turn the control bridge into a path authority. Sending the official current Session id keeps selection in client-runtime and lets main resolve cwd from Harness facts without storing a second selection.

**Keeping the terminal cwd on the Profile directory.** That was the pre-existing behavior the migration table flagged; the session cwd wins only while a session actually exists, and the fallback chain is unchanged, so a profile-only workflow is unaffected.

## Consequences

The settings sections and Workbench actions no longer re-download the full control model on every tick, and the Workbench Terminal opens in the selected Session's workspace without trusting a browser path. Tray and chrome retain the explicit Profile/Home fallback. The implementation reuses the existing terminal service, browser plugin, control bridge, and official current selection; it adds no persisted state. Focused component and desktop tests cover conditional polling, command revision updates, current-Session dispatch, exact command parsing, authoritative cwd resolution, invalid ids, and fallback behavior.
