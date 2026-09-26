# 技能管理器

[English](skill-manager.md) | 中文

DeepSeekGUI 的[技能库](../../packages/api/skill-manager/README.zh.md)位于当前 DSH home 下（`<home>/deepseekgui/skills/<installId>/`），经官方 Remote 网关提供给桌面的「设置 → Skill」页。来源——技能目录、ZIP 或单个 Markdown 文档——先审阅：候选、它们声明的元数据、审阅对缺项的建议、发现的问题，以及同名候选将替换的现有安装——以安装标识与来源点名，而不是靠显示名去猜。安装是一次完整的目录操作：在 `<home>/deepseekgui/skills-staging/` 下暂存，用[文件系统 provider](skills.zh.md) 的规则校验暂存的 `SKILL.md`，然后重命名进技能库；失败不会留下半份安装。来源里的任何内容都不执行，也不安装依赖。卸载只删除带有管理器清单的目录；原下载包与官方根目录从不被触碰。

技能库刻意不是官方 provider 的根。会话能用什么由**项目选择**（B7-P5）决定：每个项目文件夹一份已保存的安装标识列表（`<home>/storages/deepseekgui_skills/projects/<key>.json`，文件夹经工作区注册表的 `realpath` 规范解析），在会话顶部的「项目管理」视图里编辑，该文件夹的所有会话共用。本服务向[技能注册表](skills.zh.md)的宿主层注册一个 provider——只以技能库为根的官方文件系统 provider，按调用方 cwd 的选择过滤，rank 550，排在官方用户根之后并整体让位于任何 preset 层的 provider——因此模型目录、`skill` 工具、用户的 `/名称` 行与 `/` 选择器看到的都恰是已选的安装，官方同名技能遮蔽受管技能而不是反过来。保存会使注册表目录缓存失效并把 `skill-manager/change` 转发到浏览器；已打开的会话在下一次请求时经技能工具的目录替换消息接收变化，已经注入的技能内容留在历史里。卸载会在每个选中它的项目里留下一条缺失引用，直到项目自己清除。包 README 拥有线上值、上限与失败码。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md)

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
