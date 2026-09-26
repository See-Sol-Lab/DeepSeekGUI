# Agent Note: Per-folder skill selection served by one filtered provider

Status: implemented

English | [中文](2026-09-13-skill-project-selection.zh.md)

## Problem

The skill library (B7-P4) installs packages under `<home>/deepseekgui/skills/` but nothing could use them: the library is outside every official provider root by design, so that a fresh install is not broadcast to every session. The missing half is the choice — which project may use which install — and it had to be a real switch, not a hidden checkbox: the model's catalog, the `skill` tool, the user's `/name` line and the `/` picker all had to read the same selection, an unticked install had to be unloadable through every entry, official skills had to keep their precedence and invocation controls, an update of an install had to keep its selection, an uninstall had to name the affected projects and must not resolve to another skill of the same name, and the moment a change takes effect in an open session had to be stated honestly.

## Decision

A project is a folder. `packages/api/skill-manager/src/selection.ts` resolves the session's recorded cwd with the workspace registry's own `realpathNormalize` (Windows folds case), hashes it into a per-record key, and stores one record per folder in the `deepseekgui_skills` storage domain (`per-record`, `<home>/storages/deepseekgui_skills/projects/<key>.json`): the canonical path, the selected install ids, a revision, and the save time. Every session of a folder reads that record; other folders have their own; a session without a folder or whose folder is gone cannot save. Records hold install ids, never display names, so a replacement (same id) keeps its ticks and a fresh install is ticked nowhere.

`provider.ts` is the switch. At mount the service registers `deepseekgui-skills` into the host layer of `ctx.skills`: an official `FileSystemSkillProvider` built with `includeDefaultRoots: false` and the library as its only custom root, whose candidates are filtered to the calling cwd's selected ids and relabelled `deepseekgui-managed` at rank 550. Because every official consumer already reads the registry with the session cwd, one filter covers all four entries with no registry change; an unticked install is absent from `list()` and `get()` returns undefined for it. The rank sits after the official user roots and before the bundled root, and a preset-layer provider shadows the host layer outright, so an official skill of the same name always wins; the page reports that as `shadowed` instead of hiding it. The provider never grants anything: invocation policy comes from the installed frontmatter as the official provider parses it.

The service exposes `projectView(sessionId)` — the folder, the revision, and one row per install plus one per dangling reference, each with its effect computed from `ctx.skills.snapshot` under the session's live agent or its recorded preset's standing scope (`active`, `shadowed` with the winner's source, `inactive`, `invalid`, `missing`) — and `setProjectSelection({ sessionId, enabled, revision })`, which refuses a stale revision (`revision-conflict`, returning the winning page) and an unknown id (`unknown-install`), serializes with installs and uninstalls, then invalidates the registry catalog and emits `skill-manager/change { kind: 'selection' }`. `uninstall` reports `affected` projects and `installReferences` answers the same list beforehand; the dangling reference stays as `missing` until the project unticks it.

Effect timing is the registry's: a save invalidates the collect cache, so an open session's next request rebuilds the catalog and `dsh-tool-skill` appends its catalog-replacement message; content already injected stays in the session log. The event is forwarded to the browser through one new entry in `@deepseek-ai/dsh-api-remotes` (the declaration lives in the library's client-safe `types.ts`), `ui-skill` clears its cached `/` catalogs on it, and the `@see-sol-lab/deepseekgui-skills` plugin's Project management view (session-top, order 22 beside Git and Memory) re-reads on it; the view keys every read and save by session and generation so a late result never overwrites a newer target, and the settings section's uninstall confirmation shows the affected projects.

## Alternatives considered

**Copying selected packages into `<project>/.dsh/skills`.** Rejected: a tick would duplicate files, an update would have to chase copies, and the official project root would broadcast the copy to tools outside the selection's control.

**Filtering in the client only.** Rejected: the model catalog and the `skill` tool read the host registry; a hidden checkbox would leave every unticked skill loadable.

**A patched registry or a custom `tool-skill`.** Rejected: the registry already keys its cache by cwd and consults every provider with it; one provider is the smallest correct change and keeps the official precedence rules untouched.

**Identity by `WorkspaceId`.** Rejected: it is a registry record that can be deleted and recreated, and sessions created outside the sidebar have none; the canonical folder path is what every session actually carries.

**Forwarding `skills/change` instead of the library's own event.** Rejected for now: its declaration lives in the host-only registry module, which the client compiler face cannot import; the library event is declared client-safe and carries the selection kind the pages need.

## Consequences

Ticking is the only switch and it is the same for every entry point; the tests drive the real registry: unticked installs are absent from `list()` and `get()`, two folders stay apart, two sessions of one folder share one record, a stale page loses, a restart keeps the selection, another home starts empty, a replacement keeps its tick, an uninstall leaves a named missing reference, and a same-name official provider shadows the managed row. The client specs cover ticking, saving with the rendered revision, conflict and refusal display, no-folder and gone-folder states, and stale-result discard across a session switch. Live checks of the model catalog with a mock model, two windows on one folder, and a Harness restart remain acceptance work; the library root binds at mount, so switching the DSH home relies on the Harness restart the desktop already performs. The provider also refuses a selected install whose document disagrees with its manifest. The page leaves its save response in control while that save broadcasts a change; otherwise the resulting reload invalidates the completion and leaves the controls disabled.
