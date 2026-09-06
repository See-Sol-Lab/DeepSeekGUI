# Agent Note: B3-P5 Session Changes — per-session changed-files panel

Status: implemented

English | [中文](2026-08-31-b3-p5-session-changes.zh.md)

## Problem

After a session edits files, the Workbench had no single surface answering "which files did this session change, and what did they become". The official message flow shows each mutation's diff card in place, but a session-spanning view — one list of every changed file with its before/after — had to be derived from the event window at render time, which the Conversation Node discipline forbids (the append hot path and renderers never scan the full event window).

## Decision

**A `changes` Conversation Node in the Workbench plugin** (`apps/desktop/workbench-plugin/src/client/changes-node.ts`), registered through `ctx.conversationEvents`. It folds each successful file mutation of a Turn into `changes` Turn Location data (`ConversationTurnDataMap.changes`: `ChangeEntry { seq, path, diffs: readonly DiffHunk[] | null, callId }`), published at turn scope. The fold is deterministic by log `seq`, so reopen, refresh, and older-page prepend rebuild the identical list from the same events; only Session events contribute, so a file changed outside the session (an external human edit, another tool's side effect) never appears.

A mutation is recognized by render intent, not tool name — a `card: 'diff'` view, or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents) — so a new mutation tool joins by declaring what it does, and an unknown tool is never guessed. Diff content is authoritative on the result view (the write/edit tools return the applied contextual hunks there, an edit's real before/after, derived from result meta so replay is deterministic); the call view's diff still counts when the result view is absent or generic, and a generic edit's locations exist only on the call view. Wire `diffs` are narrowed at the boundary (`narrowDiffs`, the same policy as ui-tool's diff-card model; this plugin cannot import it): a malformed payload drops the change instead of rendering garbage. A recognized edit without presented diff content is reported honestly as `diffs: null` — the panel says "modified" without inventing a before/after.

**The Workbench Changes panel** (`src/client/ChangesView.tsx`): a `conversation.view` tab (id `changes`, order 30) reading only `useSession(snapshot => snapshot.chat.timeline.turns)` — no node scan, no event window. Entries are grouped per file in first-change order with a per-file change count; each entry renders `DiffBlock` (the shared `ui-primitives` primitive, baseline-external) for hunks, or the localized "modified" line when the tool presented no diff. Displayed paths are cwd-relative when under the session's project cwd (`useSessions` summary), verbatim otherwise. Copy comes from the plugin's own `deepseekgui.workbench` namespace (`view.changes`, `changes.empty`, `changes.count`, `changes.noDiff`).

## Alternatives considered

**Scanning the event window / chat nodes at render time.** Violates the Conversation Node discipline: the append hot path and renderers never scan the full window, and a window that dropped an older page would produce a different list than the same session reopened.

**Deriving the diff from the call view alone.** Call-time `diffs` carry `oldText: null` for overwrites (the presenter has no prior content); the result view's applied hunks are the authoritative before/after and keep replay deterministic through result meta.

**Recognizing mutations by tool name.** B3's "unknown Tool: never guess" acceptance rule — a tool that declares no diff card and no edit locations simply has nothing to report, and a new mutation tool joins by its render intent rather than a name allowlist.

## Consequences

The Workbench plugin now injects `conversationEvents` and registers one Node definition; the `changes` Turn-data key is a plugin-owned augmentation of the official map. The panel reuses the official primitives and snapshot only — no second source of truth. The fold carries no view Node and never touches the event window; per-Turn memory is bounded by the turn's successful mutations. The `groupChanges` derivation is exported for direct testing. Component tests are jsdom-based and were not run on the authoring machine (the local vitest jsdom environment fails to load any jsdom suite — the official `produced-files.client.spec.tsx` fails identically with `No such built-in module: node:` — so they run on the acceptance machine); the Node-environment fold suite (`changes-node.spec.ts`, 10 tests) passes locally, and the end-to-end path was exercised against a real `write` tool call through the mock LLM server: the file lands on disk and the Changes panel lists `notes.txt` with the applied diff.
