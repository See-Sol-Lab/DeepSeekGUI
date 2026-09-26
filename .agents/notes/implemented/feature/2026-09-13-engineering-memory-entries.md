# Agent Note: Versioned engineering memory entries over the storage domain

Status: implemented

English | [中文](2026-09-13-engineering-memory-entries.zh.md)

## Problem

DeepSeekGUI's memory was two flat Markdown files — `<home>/memory.md` and `<folder>/<folder name>.memory.md` — read whole into a session once and edited as text. Nothing in them was addressable: a fact could not be corrected without rewriting the file, a wrong line could not be forgotten in a way that kept it out of the next session, an edit made in one window could silently overwrite an edit made in another, and a "saved" that had not reached the disk looked the same as one that had. The B7 memory line needs entries a person and an assistant can point at — remember, correct, forget, undo — with one storage authority, project isolation, honest conflicts, and a way to bring the existing files across without pretending a heading is a fact.

## Decision

`packages/api/workbench-memory` owns one storage domain, `deepseekgui_memory`, in the `per-record` layout the projection cache already uses: one JSON document per entry under `<home>/storages/deepseekgui_memory/entries/`, forgotten copies under `forgotten/`, and the injection mode in the global slot. No second database, no vectors, no companion Core: entries are a few hundred JSON files the storage backend already publishes atomically.

An entry is the smallest record that supports the three edits: a stable `m_<12 hex>` id, a scope (`global`, or `project` with the skill manager's project key — the sha256 of the canonical folder path, so two folders named `proj` are two projects), a closed `kind` (`fact` / `preference` / `continuation`), content and keywords, the origin `source` (who, from which session, when, on what evidence), a monotonic `version`, the latest change in `revised`, and the state before it in `previous`. A correction quotes the version it read; a different stored version answers `MEMORY_CONFLICT` with the current one, and writes are serialized inside the service, so two windows editing one entry cannot lose an update — the loser re-reads. The origin source is never overwritten: the correction's source is appended in `revised`. Undo restores `previous` one level and makes the undone state the new `previous`, so undo twice redoes. Forgetting moves the whole entry to the `forgotten` table and leaves a tombstone in `entries`; every read, search and undo consults `entries` alone, so the text is out from the tombstone on, a stale window's correction answers `MEMORY_FORGOTTEN`, and `restore` is a separate explicit method that nothing calls on its own. Every write resolves only after the domain's durable put; a backend failure answers `MEMORY_IO` and the in-memory state is unchanged.

The legacy files are imported after review: `previewImport` cuts the file into paragraphs, list items (with continuation lines) and fenced blocks under their heading path, marks segments whose normalized content already lives in the target scope, and writes nothing; `applyImport` writes the chosen segments in order with `source.kind = 'import'` (file and heading in `detail`, line in `evidence`), skips duplicates, honours edits, and stops at the first failure reporting what landed. The file itself is never modified. The global slot stays `injection: 'markdown'`: this phase is the data capability alone, the legacy files remain what sessions read, and nothing syncs Markdown and entries in the background.

## Alternatives considered

**SQLite through `storage-sqlite`.** Rejected: it is not in the runtime closure of the release, the session index built on it is a derived `:memory:` store, and the entry count does not need it; per-record JSON is readable and already atomic.

**Editing entries inside the Markdown files.** Rejected: there is no stable identity in a text file, so conflicts, forgetting and undo cannot be expressed; the files stay as the import source and the live memory until the migration switches.

**Overwriting the source on correction.** Rejected: "who said this first" is what a person needs when a correction turns out wrong; the origin stays and the correction's source is appended.

**Hard-deleting on forget.** Rejected: a window still holding the old version would recreate the text with its next write; the tombstone makes that write a visible conflict, and the kept-aside copy makes restore an explicit, reviewable act instead of a guess.

**Heading-per-fact import.** Rejected: a heading may cover several facts or half of one; the preview offers the structural segments for review and the apply writes what the person chose.

## Consequences

The tests drive the real storage stack under a temp home: an entry survives a restart and reads back byte-equal; global, one project, another project with the same folder name and the union view stay apart; two concurrent corrections of one entry produce exactly one success and one `MEMORY_CONFLICT`; a write the backend refuses reports `MEMORY_IO` and leaves the read state untouched, including a forget whose tombstone fails and whose copy is taken back out; a forgotten entry is gone from `get`, `list` and text search, refuses a stale correction, and returns only through `restore`; the import marks duplicates, keeps the file, skips what already exists, and stops mid-way with the written ids. The Remote surface is ready for the tool phase and the pages, but no session sees an entry yet — the injection switch, the tools and the UI are the follow-up phases' work.
