# Agent Note: B5-P7 — session-record tree and flat-file memory

Status: implemented

English | [中文](2026-09-04-b5-p7-session-tree-and-flat-file-memory.zh.md)

## Problem

B5-P1..P6 left the GUI with no way to see or resume the durable session history, and no product memory: every project re-explained itself to a fresh session window. The phase spec required a read-only session-record tree (fork/parent facts from the official JSONL) plus Claude-Code-grade basic memory — with the explicit B7 red line: no recall/write tools, no memory engine, no retrieval/vectors, no Persona kernel, no MCP adapters.

## Decision

- Memory is two flat files (句芒 ruling superseding the earlier index design; no index, no one-fact-one-file, no directories, no metadata files): `<DSH home>/memory.md` (cross-project user preferences, model read-only) and `<project cwd>/memory.md` (project facts, model-maintained with ordinary fs tools). Project memory lives inside the workspace, so official workspace-write semantics apply — no new permission face, no backdoor, never full-access as a default. The official 0.1.2 has no directory-level writable-declaration face (verified: writable roots are mode-derived only), which is why the global file is user-edited (desktop writes it under native permissions) rather than model-written.
- Injection uses the official system-prompt context (`deepseekgui:memory`) and a variable value so template syntax inside memory remains literal. A WeakMap keyed by the loaded Session captures text on first assembly; subsequent steps perform no memory-file reads. Unloading and reopening a Session captures edited files. The official context snapshot logs the injected text; missing/empty files have explicit status lines.
- Host code lives in `src/session-memory.ts`; its asset path works from both `src/` and the bundled `lib/`. Browser code lives in `src/client/memory/` and `src/client/tree/`. Saving global memory uses the desktop's atomic writer and propagates failures to the control response; the panel confirms only success.
- The memory panel manages files without a second data surface: open-in-file-manager and save-global-memory are closed desktop commands (only `sessionId`/`which`/`content` travel; main derives every path from authoritative facts — active home or official `session.list` cwd). Reading content and maintaining the project file go through the assistant via the official composer. Panel copy distinguishes AGENTS.md (human project manual) from memory.md (accumulated facts) and notes that project memory may be committed — the user decides about `.gitignore`.
- The session-record tree is a read-only flattening of the official session list lineage (`parentId` mirrors the JSONL `parentSession`, forks and subagents alike), rendered inside the existing on-demand inspector; clicking a row opens (restores) that official session. No second session store, no operable tree.

## Alternatives considered

- The originally planned index + one-fact-one-file + directory + metadata layout; superseded by the flat-file ruling — two files are all the current scale needs, and no index layer is built.
- Keep memory under the DSH home outside the workspace and have the model write it (requires a directory-level writable-declaration face 0.1.2 does not have); rejected — the global file is user-edited via the desktop, and project memory lives inside the workspace under workspace-write.
- Ship dedicated recall/write tools or any memory engine/retrieval/Persona/MCP surface; rejected by the B7 red line.

## Verification

- Plugin: `tsc -b` clean; oxlint 0; 70 focused tests (host memory text/three-state specs, tree flattening incl. orphan/cycle/blank semantics, memory-command parse cases, full registration spec).
- Desktop: `tsc -b apps/desktop` clean; control-model suite 62 pass. `verify-client-ui-i18n` green; client bundle rebuilt.
- Real-path smoke: desktop Electron against a real dsh 0.1.2 service boots (`[deepseekgui] window loaded`), no loader/console errors; quit leaves the service port free and no orphan process.
- Model-driven evidence (path A: model writes a project fact with fs tools → new window sees it; path B: tree restore → continue) requires a live model and is handed to acceptance; the harness service itself is model-keyless here.
- All test data is synthetic (temp files); no real relationships, credentials, personal paths, or private memory entered the repo.

## Consequences

- The workbench plugin has grown across P5–P7 (tool cards, inspectors, notifier, owner rows, memory, tree); the phase report records current file counts and responsibilities so P8 can decide whether to split by responsibility.
- When the official writable-declaration face (or a future Memory Core, B7) appears, the global file can move/upgrade without touching the permission gate: the contract text and the desktop command are the only owners of its path.
