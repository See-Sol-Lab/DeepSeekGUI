---
description: "Import, list and uninstall skill packages in DeepSeekGUI's local skill library, and select per project folder which installs a session may use; review sources before anything is written and configure size bounds."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-manager

English | [中文](README.zh.md)

## Summary

DeepSeekGUI's local skill library under the active DSH home. The `skillManager` Remote namespace reviews a directory, ZIP or Markdown source, installs the reviewed selection as a complete directory, uninstalls only what it wrote, and keeps each project folder's selection of installs. The library is not an official provider root: the one provider this service registers lists, for a session, exactly the installs its project selected.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The DeepSeekGUI Web composition mounts this plugin as a Loader row beside the workbench inspector. Custom compositions need the typert, storageDomain, skills and sessionQuery providers; it is not an installable bundle by itself.

| Field | Default | Meaning |
| --- | --- | --- |
| dshHome | `$DSH_HOME` or `~/.dsh` | Explicit harness home; re-read on every call so a switched home moves the library |
| agentsHome | `$DSH_AGENTS_HOME` or `~/.agents` | Agents home for the read-only listing |
| bundledSkillDir | `$DSH_BUNDLED_SKILL_DIR` | Bundled root for the read-only listing |
| libraryDir | `<home>/deepseekgui/skills` | Install directory root |
| stagingDir | `<home>/deepseekgui/skills-staging` | Staging and trash root, outside the library |
| maxZipBytes | 268435456 | Inclusive cap on an archive file |
| maxFileBytes | 67108864 | Inclusive cap on one file inside a source |
| maxTotalBytes | 536870912 | Inclusive cap on all files of one source |
| maxFiles | 4000 | Inclusive cap on the number of files of one source |
| watchLibrary | true | Whether the provider watches the library directory for changes made outside this service |

`inventory` returns a SkillInventory: the library directory, every managed install as a SkillInstalledView (manifest fields plus `location` and a `status` of `ok` or `invalid` with the issue), the `orphans` (directories under the library without a manifest written by this manager; never removed), and the read-only SkillReadOnlyView rows discovered under `<home>/skills`, `<agents home>/skills` and the bundled root with the same frontmatter rules the official filesystem provider applies.

`previewImport(path)` reads a source without writing: a directory is walked (symbolic links are skipped and reported, `.git` is not copied), a `.zip` is read in memory with every entry path checked (`..`, absolute, drive-letter, backslash, control-character and trailing-dot segments are refused), and a `.md` is one candidate. A root `SKILL.md` yields one candidate holding the whole package; otherwise every nested `SKILL.md` up to three levels deep is a candidate, and failing that every root-level Markdown file. Each SkillImportCandidate carries the declared `name` and `description` (null when missing or invalid), the review's `proposed` values for what is missing (a kebab-case name from the file or directory name, a description from the first plain line), its `issues` (the fixable ones are exactly missing or invalid name and description), the file count and bytes, `installable`, and `replaces` — the existing install the candidate would replace, matched by origin first and then by name, named by install id and origin so the actual target is visible.

`applyImport({ path, selections })` installs each SkillImportSelection independently: the candidate is staged under the staging root as a complete directory (the `SKILL.md` is rewritten only when the final name or description differs from the entry, or the entry lacks frontmatter; every other file is copied unchanged), a `deepseekgui-skill.json` manifest is written, the staged `SKILL.md` is re-validated, and only then is the directory renamed into the library as `<name>-<8 hex>`. A `replaces` install id keeps its directory name and first-install time; the old directory is parked in staging during the swap and put back if the rename fails. Any failure removes the stage and reports one SkillIssue for that selection — `name-conflict` when the name is installed under an id the selection did not confirm, `replace-target-missing`, `library-unwritable`, `skill-invalid`, `io-error`. Nothing inside a source is executed and no dependency is installed. An import exceeding the file-count or byte limits is refused as a whole; it cannot publish a skill with omitted resources. ZIP count and total-byte checks run before inflation.

`uninstall(installId)` removes one directory only when its manifest names that install id; anything else answers `not-managed` and removes nothing. The original download and the official roots are never touched. The outcome's `affected` lists the projects whose selection still names the install; `installReferences(installId)` answers the same list beforehand, for the confirmation. Every library change emits `skill-manager/change`. Directory links are not managed installs and cannot be uninstalled through this operation.

### Project selection

A project is a folder: `projectView(sessionId)` resolves the session's recorded cwd through the same `realpath` canon the workspace registry uses (Windows folds case), hashes it into a key, and returns the page — the folder, the saved `revision` (0 before the first save), and one SkillProjectEntry per library install plus one per selection entry whose install is gone. Each entry says what the tick does in the session's real catalog, read through `ctx.skills.snapshot` under the session's live agent or its recorded preset's standing scope: `active` (the winning skill of that name is this install), `shadowed` (an official skill of the same name wins; `shadowedBy` names its source), `inactive`, `invalid` (the installed copy fails validation), or `missing` (uninstalled; the reference stays until the project clears it — nothing switches to another skill of the same name). A session without a folder, or whose folder is gone, reports `problem` and cannot save.

`setProjectSelection({ sessionId, enabled, revision })` stores the complete install-id list for the folder as `<home>/storages/deepseekgui_skills/projects/<key>.json` (the `deepseekgui_skills` storage domain, `per-record` layout). The save must quote the revision the page was rendered from; a different stored revision answers `revision-conflict` together with the winning page, an id that is neither installed nor already referenced answers `unknown-install`, and saves are serialized with installs and uninstalls. A saved selection invalidates the registry catalog and emits `skill-manager/change` with `kind: 'selection'`. Selections hold install ids, so a replacement keeps them and a fresh install is in no selection until a project ticks it.

### The managed provider

At mount the service registers `deepseekgui-skills` into the host layer of `ctx.skills`: an official `FileSystemSkillProvider` rooted at the library alone (no default roots, so the bundled and user roots never re-appear under this name), filtered to the calling cwd's selected install ids and relabelled with source `deepseekgui-managed` at rank 550 — after the official user roots, before the bundled root, and behind any preset-layer provider outright. Every official consumer reads the registry with the session cwd — the model catalog message, the `skill` tool, the user's `/name` line, and the `/` picker's Remote — so a tick is the only switch: unticked installs are absent from the catalog and `ctx.skills.get()` returns undefined for them. The library root is bound when the service mounts; a switched DSH home restarts the Harness. Selected installs must also pass manifest and document validation; a changed declared name cannot activate a different skill under the saved install id.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Directory-complete installs and identity</summary>

`library.ts` owns the disk layout. Writes are serialized inside the service so an install and an uninstall never interleave; each write is stage → validate → rename, so a crash leaves at most a stray directory under the staging root and never a half-installed entry the provider could pick up. Identity is the manifest's `origin` (source kind, absolute path and entry) plus the install id; the display name is never used to pick a replacement target at apply time — the client passes the id it showed.

`frontmatter.ts` mirrors the official provider's rules (kebab-case name, non-empty description, canonical `disable-model-invocation` / `user-invocable` booleans, legacy keys refused) as issues instead of silent rejection, and renders the installed copy with `yaml`. `zip.ts` bounds inflation with `fflate` before any file is written.

`selection.ts` owns the storage domain, the project key, and the page assembly; `provider.ts` wraps the official filesystem provider. The selection is the only mutable replica and it is authoritative: a save is one durable `put`, and the registry cache is invalidated on the fact rather than on a watcher. The inventory is read from disk on every call.

No invariant companion is published: the only mutable replica is the per-project selection, whose in-memory view is the persisted record, and the library itself is read from disk on every call.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Skill provider registry](../../skill/skill/README.md)
- [Filesystem skill provider](../../skill/skill-filesystem/README.md)
- [Storage domains](../../storage/storage-domain/README.md)
- [Workspace registry](../../workspace/workspace/README.md) (the path canon)
- [DSH home paths](../../util/home-paths/README.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through the skill tool package (`dsh-tool-skill`), whose catalog message, `skill` tool and `/name` injection render the installs this service's provider lists for a project.

#### KV Cache effect

A saved selection changes the catalog-replacement message the skill tool package appends at an open session's next request, which invalidates the prefix from that point on; skill content already injected stays in the session's history, and importing or uninstalling a package alone does not alter a model request.

## Known Limitations and Deferred Work

- Symbolic links inside a ZIP are not preserved: the reader has no link attributes, so a link entry becomes a plain file holding its target text; links inside a directory source are skipped and reported.
- Files are copied whole; there is no streaming, so the size caps are the memory bound for archives.
- Read-only rows are discovered by scanning the official roots directly rather than through `ctx.skills`, whose host-plane listing cannot see preset-layer providers; the project page's effect column does read the session's scope.
- Two installs of one name cannot coexist in the library, so a selection never has to choose between same-name installs; an official skill of the same name always wins and is reported as shadowing.
- The selection is per folder, not per session: two work trees are two folders.

### Dev Note

None.
