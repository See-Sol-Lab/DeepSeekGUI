# Agent Note: Skill library with reviewed, directory-complete installs

Status: implemented

English | [中文](2026-09-13-skill-library-install-management.zh.md)

## Problem

DeepSeekGUI users collect skills as directories, ZIP downloads and single Markdown documents, and had no way to bring them into the desktop without hand-copying into an official root — where everything is immediately visible to every session, a half-copied package is picked up as-is, a document without frontmatter is silently ignored, and nothing records where a skill came from. The B7 plan separates installing (a library the desktop owns) from enabling (a per-project choice), and needs the install side first: an inventory, an import that reviews before it writes, whole-package installs that either complete or leave nothing, and an uninstall that cannot reach beyond what it installed.

## Decision

A host package, `@deepseek-ai/dsh-skill-manager`, owns a library at `<DSH_HOME>/deepseekgui/skills/<installId>/` — one directory per install carrying the complete package plus a `deepseekgui-skill.json` manifest (schema version, install id, name, description, origin, times, file count). The `skillManager` Remote namespace has four methods. `inventory` reads the library from disk on every call (a switched DSH home moves it), separates managed installs (with a re-validation status) from orphan directories the manager never removes, and lists the official user roots and the bundled root read-only by scanning them with the provider's own frontmatter rules. `previewImport` loads a directory (walked, links skipped and reported), a ZIP (read in memory with `fflate`; entry paths with `..`, absolute or drive-letter prefixes, backslashes, control characters or trailing dots refused; inflation bounded before any write) or a `.md`, and finds candidates: a root `SKILL.md` as one candidate for the whole package, otherwise nested `SKILL.md` up to three levels, otherwise root Markdown files. Each candidate carries the declared name and description, proposals for what is missing (kebab-case from the file or directory name, the first plain body line), issues split into fixable (name, description) and blocking (legacy invocation keys, invalid booleans, unparsable frontmatter), and the existing install it would replace — matched by origin first and by name second, and returned as install id plus origin so the page names the actual target. `applyImport` installs each selection independently: stage a complete directory under `<DSH_HOME>/deepseekgui/skills-staging/` (the `SKILL.md` rewritten only when metadata changes; everything else copied), write the manifest, re-validate the staged `SKILL.md`, then rename into the library as `<name>-<8 hex>`; a confirmed `replaces` keeps the install id and first-install time with the old directory parked and restored on a failed swap; any failure removes the stage and reports a coded issue. Name uniqueness is enforced at apply time against the install id the client confirmed, never by looking a name up. `uninstall` renames a directory into staging and removes it only when its manifest names that id. Writes are serialized; every change emits `skill-manager/change`. Nothing inside a package is executed and no dependency is installed.

The page is a separate client plugin, `@see-sol-lab/deepseekgui-skills`, registered as the sixth DeepSeekGUI settings section (**Skills (Local)**, order 45) through the same launcher overlay pattern as the others; the host service is mounted by the web-app bundle beside the workbench inspector. It renders the inventory, drives the review — candidates with editable name and description, issues localized by code, the replacement target — and uninstall with inline confirmation. Source picking goes through one new desktop command, `skill-pick-source { kind }`, which opens the system dialog and reports the path in the control model; outside the desktop window the page takes a typed path. No project tick lives on the page: the library is deliberately not an official provider root, so an install is visible to no session until the follow-up phase's project selection registers a provider for it.

## Alternatives considered

**Copying into `~/.dsh/skills` directly.** Rejected: that root is scanned for every session, so installing would equal enabling, and the manager could not tell its own files from the user's.

**Registering a provider for the library now.** Rejected: the project selection and its per-project storage are the next phase; a provider without it would broadcast every install to every session.

**Matching replacement targets by display name at apply time.** Rejected: two sources can declare the same name; the target must be the install id the person saw in the review.

**Auto-repairing the source document in place.** Rejected: the proposal is written only into the library copy; the download stays as the person received it.

**Extracting straight into the library.** Rejected: a failed extraction would leave a directory the future provider treats as a skill; staging outside the library plus a final rename keeps the root free of partial entries.

## Consequences

Users install skill packages from where they have them and see exactly what will be written before it is; same-name conflicts are explicit; uninstall is bounded to the manager's own directories. The library's identity model (origin plus install id) is what the follow-up phases key project selections on, so replacements do not lose enablement. ZIP symbolic links are not preserved (the reader has no link attributes) and files are copied whole within size caps. Unit coverage in `packages/api/skill-manager/tests` drives frontmatter rules, archive safety, inventory and orphan classification, nested and Markdown candidates, proposals, replacement and name-conflict rules, staging failures, uninstall refusals and a switched home; the plugin's tests cover the review drafts, the bridge command and the page's flows against a fake namespace. Typert generation, plugin bundling and the assembled composition are verified by the acceptance run.
