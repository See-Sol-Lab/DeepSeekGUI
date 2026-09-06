# Agent Note: B3-P6 Archived Sessions — unarchive operation and Current/Archived view

Status: implemented

English | [中文](2026-08-31-b3-p6-archived-sessions.zh.md)

## Problem

The registry-global archive set (`archivedSessionIds`) already hid sessions from every grouping surface, and the row menu could archive a session — but there was no way back: no unarchive operation anywhere in the stack, and no surface where archived sessions were even visible. A session archived by mistake was gone from the UI forever (only a manual state edit could restore it), and the ui-workspace README documented the gap as a known limitation.

## Decision

**The narrowest unarchive operation, all the way down** (`packages/workspace/workspace`, `packages/host/apiproxy`, `packages/client/runtime`):

- `WorkspaceRegistry.unarchiveSession(sessionId)` removes one id from the durable archive set. It resolves without writing when the id is absent (the archive mirror of `archiveSession`'s idempotence) and never touches workspace accounting — archiving retained the `sessionIds` slot precisely so unarchiving restores the original position. The domain `domain/changed` diff already broadcasts every archive-set write, so the existing `host/archived-sessions-changed` frame fires for unarchive with no new event code.
- `workspace.unarchiveSession` joins the gateway contract (`api/workspace.ts`), its zod schemas, the unary route table, and the carrier client — same shape as `archiveSession`: `{ sessionId }` in, the **full updated set** out. The client runtime's `WorkspaceManager.unarchiveSession` installs that echoed set into the shared snapshot (`installArchived`), exactly like `archiveSession`: the client never maintains a second collection, and a remote tab's changed frame or a reconnect baseline re-installs the same set.
- The workspace-service face (`IWorkspaces.unarchiveSession`) and the test doubles (connection fixture, runtime/connection fakes, the test-support workspaces double) mirror the archive surface.

**The Current/Archived view and the restore action** (`packages/client/ui-workspace`):

- `deriveArchivedRows(list, archivedSessionIds)` derives the archived rows newest-first from the same session-list feed the tree reads — the only surface where archived sessions appear (every grouping derivation excludes them).
- The wide browser renders an **Archived** section pinned beneath the tree/flat list (its own hairline, always reachable without scrolling the list): a header with the row count, and one row per archived session — title, relative time, and a single text **Unarchive** action (the row is not openable: the runtime clears an archived current selection, so a session must be restored to its group before it can be opened). The section hides while a search is active (search derives only visible sessions) and with an empty archive set.
- The row action routes through the injected `unarchiveSession` face to the workspace service; failures are non-fatal console diagnostics, the same posture as archive and reorder rejections.

## Alternatives considered

**A client-side second archive set / local undo.** The instruction is explicit: the client uses the Host echo and maintains no second collection. Every install path (unary echo, changed frame, reconnect baseline) already replaces the full set, so a local mirror would only drift.

**Reusing the row menu for the restore action.** Archived rows carry no menu — the row is not openable, so the ellipsis affordance (hover-revealed) would be invisible on a surface whose single verb must be legible; a text button on the row is the section's one action.

**Deriving the archived view from the conversation/event window.** The list feed already carries the metadata (title, recency) and the archive set is the authoritative membership — scanning events would duplicate state and violate the data-access ladder.

## Consequences

The full archive lifecycle is now round-trip: archive hides, the Archived section shows, unarchive restores the original group (or the Ungrouped bucket). Host durability, the reconnect baseline, and multi-window frames all travel the pre-existing archive-set channel — the unarchive operation added no new wire event or state shape. The ui-workspace known-limitation entry narrowed to "no Session deletion" (deletion semantics stay pending). Tests: registry unarchive durability/idempotence/accounting (`workspace.spec.ts`, 44 passing), gateway RPC + frame echo (`api-proxy-workspace.spec.ts`, 23 passing), client echo install/failure/frame (`workspaces-service.client.spec.ts`, 23 passing), archived-row derivation (`tree.client.spec.ts`, 28 passing). The browser component specs (`workspace-browser.client.spec.tsx`) are jsdom-based and were not run on the authoring machine — the local vitest jsdom environment fails to load any jsdom suite (the official `workspace-browser.client.spec.tsx` fails identically with `No such built-in module: node:`), so they run on the acceptance machine. End-to-end UI verification (archive via the row menu, Archived section visibility, restore, reload persistence, content unchanged) is likewise assigned to the acceptance machine; the authoring machine reached the RPC boundary (archive/unarchive return the correct full set) but the live browser bundle must be rebuilt before UI probing, which the acceptance run covers.
