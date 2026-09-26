# Skill manager

English | [中文](skill-manager.zh.md)

DeepSeekGUI's [skill library](../../packages/api/skill-manager/README.md) lives under the active DSH home (`<home>/deepseekgui/skills/<installId>/`) and is served to the desktop's Settings → Skills page through the official Remote gateway. A source — a skill directory, a ZIP, or a single Markdown document — is reviewed first: candidates, the metadata they declare, what the review proposes for what is missing, the problems found, and the existing install a same-name candidate would replace, named by install id and origin rather than guessed from a display name. Installing is one complete directory operation: stage under `<home>/deepseekgui/skills-staging/`, validate the staged `SKILL.md` with the [filesystem provider](skills.md)'s rules, then rename into the library; a failure leaves no half-installed entry. Nothing inside a source is executed and no dependency is installed. Uninstall removes only directories carrying the manager's manifest; the original download and the official roots are never touched.

The library is deliberately not one of the official provider roots. What a Session can use is the **project selection** (B7-P5): one saved list of install ids per project folder (`<home>/storages/deepseekgui_skills/projects/<key>.json`, the folder resolved through the workspace registry's `realpath` canon), edited from the session-top Project management view and shared by every session of that folder. The service registers one provider into the host layer of the [skill registry](skills.md) — an official filesystem provider rooted at the library alone, filtered to the calling cwd's selection, at rank 550 behind the official user roots and behind any preset-layer provider outright — so the model catalog, the `skill` tool, the user's `/name` line and the `/` picker all see exactly the selected installs, and an official skill of the same name shadows a managed one rather than the reverse. A save invalidates the registry catalog and forwards `skill-manager/change` to the browser; an open session picks the change up at its next request through the skill tool's catalog-replacement message, and skill content already injected stays in its history. Uninstalling leaves a missing reference in every project that selected the install until the project clears it. The package README owns the wire values, bounds and failure codes.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxskillmanager--skillmanager"></a>

### `ctx.skillManager` — `SkillManager`

Skill library queries, directory-complete installs, and the per-project selection.

```ts cordis-catalog
/**
 * List installed, orphaned and read-only skills.
 * @param signal - Cancellation.
 * @returns the inventory.
 */
@Remote async inventory(signal: AbortSignal): Promise<SkillInventory>

/**
 * Review a directory, archive or Markdown file without writing anything.
 * @param path - Absolute source path picked by the user.
 * @param signal - Cancellation.
 * @returns candidates with their issues and proposals, plus source problems.
 */
@Remote async previewImport(path: string, signal: AbortSignal): Promise<SkillImportPreview>

/**
 * Install the reviewed selections of one source.
 * @param request - Source path and selections confirmed from the preview.
 * @param signal - Cancellation; checked before the first write only.
 * @returns installs and per-selection failures.
 */
@Remote async applyImport(request: SkillImportRequest, signal: AbortSignal): Promise<SkillImportOutcome>

/**
 * Remove one managed install. Project selections that name it keep the
 * reference as missing; the outcome lists those projects.
 * @param installId - Directory name under the library.
 * @param signal - Cancellation; checked before the write only.
 * @returns the outcome; refusals carry an issue and remove nothing.
 */
@Remote async uninstall(installId: string, signal: AbortSignal): Promise<SkillUninstallOutcome>

/**
 * Projects whose selection references an install, for the uninstall confirmation.
 * @param installId - Directory name under the library.
 * @param signal - Cancellation.
 * @returns the referencing projects.
 */
@Remote async installReferences(installId: string, signal: AbortSignal): Promise<SkillInstallReferences>

/**
 * The project page of one session: its folder, the saved selection, and
 * what each tick does in the session's real catalog.
 * @param sessionId - Session whose recorded cwd names the project.
 * @param signal - Cancellation.
 * @returns the page.
 */
@Remote async projectView(sessionId: SessionId, signal: AbortSignal): Promise<SkillProjectView>

/**
 * Save the selection of the session's project. The registry catalog is
 * invalidated on success, so open sessions of the folder pick the change
 * up at their next request; already injected skill content stays in their
 * history until a new session.
 * @param request - Session, complete install-id list, and the page's revision.
 * @param signal - Cancellation; checked before the write only.
 * @returns whether it saved, and the page as it reads afterwards.
 */
@Remote async setProjectSelection(request: SkillProjectSelectionRequest, signal: AbortSignal): Promise<SkillProjectSelectionOutcome>
```

Types: [SessionId](core.md)

Source: [`packages/api/skill-manager/src/index.ts`](../../packages/api/skill-manager/src/index.ts)

<a id="skill-manager-events"></a>

### `skill-manager/*` events

<a id="skill-managerchange--emit"></a>

#### `skill-manager/change` — emit

The library or a project selection changed: an install, a replacement, an uninstall, or a saved selection. Declared here, in the client-safe types module, so the Remote assembly can forward it to the browser.

```ts cordis-catalog
/**
 * The library or a project selection changed: an install, a replacement,
 * an uninstall, or a saved selection. Declared here, in the client-safe
 * types module, so the Remote assembly can forward it to the browser.
 * @mode emit
 * @param change - What happened, to which installId or projectKey.
 */
'skill-manager/change'(change: SkillLibraryChange): void
```

Source: [`packages/api/skill-manager/src/types.ts`](../../packages/api/skill-manager/src/types.ts)
<!-- END GENERATED cordis-surface -->
