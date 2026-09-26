/**
 * DeepSeekGUI's local skill library, exposed to the desktop client as the
 * `skillManager` Remote namespace: list what is installed, review a source
 * before anything is written, install the reviewed selections, uninstall
 * only what the manager wrote, and keep each project folder's selection of
 * installs. The library directory is deliberately not one of the official
 * provider roots: the one provider this service registers lists, for a
 * session, exactly the installs its project selected, and every official
 * consumer (model catalog, `skill` tool, `/name`, the `/` picker) reads
 * through that provider.
 * @module @deepseek-ai/dsh-skill-manager
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SkillCatalogSnapshot } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { applyImport, previewImport, resolveLibraryPaths, scanInventory, uninstallSkill, validInstallName, type LibraryOptions } from './library.ts'
import { ManagedSkillProvider } from './provider.ts'
import {
  buildProjectView,
  enabledFor,
  referencesTo,
  resolveProject,
  saveSelection,
  skillSelectionDomainSpec,
  type ProjectResolution,
  type ProjectTable,
} from './selection.ts'
import type {
  SkillImportOutcome,
  SkillImportPreview,
  SkillImportRequest,
  SkillInstallReferences,
  SkillInventory,
  SkillLibraryChange,
  SkillProjectSelectionOutcome,
  SkillProjectSelectionRequest,
  SkillProjectView,
  SkillUninstallOutcome,
} from './types.ts'

export type * from './types.ts'
export { SKILL_MANIFEST_FILE, SKILL_MANIFEST_SCHEMA_VERSION } from './types.ts'
export { resolveLibraryPaths } from './library.ts'
export type { LibraryLimits, LibraryOptions, LibraryPaths } from './library.ts'
export { MANAGED_PROVIDER_NAME, projectKeyOf, resolveProject, skillSelectionDomainSpec } from './selection.ts'
export type { ProjectResolution } from './selection.ts'
export { MANAGED_RANK, MANAGED_SOURCE } from './provider.ts'

/** Default deployment bounds; the Config schema applies them, callers that construct a Config in TS spread them. */
export const SKILL_MANAGER_LIMITS = {
  maxZipBytes: 256 * 1024 * 1024,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFiles: 4000,
} as const

/** Deployment bounds and optional location overrides. */
export interface Config {
  /** Explicit DSH home; defaults to `$DSH_HOME` or `~/.dsh`, re-read on every call. */
  dshHome?: string
  /** Explicit agents home for the read-only listing; defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Bundled skill root for the read-only listing; defaults to `$DSH_BUNDLED_SKILL_DIR`. */
  bundledSkillDir?: string
  /** Explicit library directory; defaults to `<DSH home>/deepseekgui/skills`. */
  libraryDir?: string
  /** Explicit staging directory; defaults to `<DSH home>/deepseekgui/skills-staging`. */
  stagingDir?: string
  /** Inclusive cap on an archive file. */
  maxZipBytes: number
  /** Inclusive cap on one file inside a source. */
  maxFileBytes: number
  /** Inclusive cap on all files of one source. */
  maxTotalBytes: number
  /** Inclusive cap on the number of files of one source. */
  maxFiles: number
  /** Whether the provider watches the library directory for changes made outside this service. */
  watchLibrary: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** DeepSeekGUI's local skill library and per-project selection. */
    skillManager: SkillManager
  }
}

/** Skill library queries, directory-complete installs, and the per-project selection. */
export class SkillManager extends TypertRemoteService {
  static inject = ['typert', 'storageDomain', 'skills', 'sessionQuery']
  static Config: Schema<Config> = Schema.object({
    dshHome: Schema.string(),
    agentsHome: Schema.string(),
    bundledSkillDir: Schema.string(),
    libraryDir: Schema.string(),
    stagingDir: Schema.string(),
    maxZipBytes: Schema.natural().min(1).default(SKILL_MANAGER_LIMITS.maxZipBytes),
    maxFileBytes: Schema.natural().min(1).default(SKILL_MANAGER_LIMITS.maxFileBytes),
    maxTotalBytes: Schema.natural().min(1).default(SKILL_MANAGER_LIMITS.maxTotalBytes),
    maxFiles: Schema.natural().min(1).default(SKILL_MANAGER_LIMITS.maxFiles),
    watchLibrary: Schema.boolean().default(true),
  })

  private readonly options: LibraryOptions
  /** Serializes writes: installs, uninstalls and selection saves never interleave. */
  private queue: Promise<unknown> = Promise.resolve()
  /** The selection table; every reader awaits `ready`, after which it is set. */
  private projects!: ProjectTable
  /** Resolves when the domain is open; provider reads wait on it. */
  private readonly ready: Promise<void>
  private markReady!: () => void
  /** Invalidates the registry catalog; the provider registration in the constructor sets it. */
  private invalidateCatalog!: () => void

  /**
   * @param ctx - Composed host providers.
   * @param config - Validated bounds and overrides.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'skillManager', { namespace: 'skillManager' })
    this.options = {
      ...config.dshHome === undefined ? {} : { dshHome: config.dshHome },
      ...config.agentsHome === undefined ? {} : { agentsHome: config.agentsHome },
      ...config.bundledSkillDir === undefined ? {} : { bundledSkillDir: config.bundledSkillDir },
      ...config.libraryDir === undefined ? {} : { libraryDir: config.libraryDir },
      ...config.stagingDir === undefined ? {} : { stagingDir: config.stagingDir },
      limits: {
        maxZipBytes: config.maxZipBytes,
        maxFileBytes: config.maxFileBytes,
        maxTotalBytes: config.maxTotalBytes,
        maxFiles: config.maxFiles,
      },
    }
    this.ready = new Promise((resolve) => { this.markReady = resolve })
    // The library root is bound for this Harness generation: a switched DSH
    // home restarts the Harness, so the provider never has to re-root.
    const libraryDir = this.libraryDir
    ctx.skills.registerProvider((control) => {
      this.invalidateCatalog = control.invalidate
      return new ManagedSkillProvider(ctx, control, {
        libraryDir,
        watch: config.watchLibrary,
        enabledFor: async (cwd) => {
          await this.ready
          const resolution = await resolveProject(cwd)
          if (resolution.project === null) {
            ctx.logger.warn(`skill selection unavailable for cwd ${cwd}: ${resolution.problem}`)
            return undefined
          }
          const selected = enabledFor(this.table(), resolution.project.key)
          const valid = await Promise.all(selected.map(async id => await validInstallName(libraryDir, id) === undefined ? undefined : id))
          return valid.filter((id): id is string => id !== undefined)
        },
      })
    })
  }

  /** Open the selection domain; the provider and the Remote methods read it after this. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(skillSelectionDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'skill-manager: selection domain')
    this.projects = domain.table('projects')
    this.markReady()
  }

  /** Absolute library directory for the current environment. */
  get libraryDir(): string {
    return resolveLibraryPaths(this.options).libraryDir
  }

  /**
   * List installed, orphaned and read-only skills.
   * @param signal - Cancellation.
   * @returns the inventory.
   */
  @Remote
  async inventory(signal: AbortSignal): Promise<SkillInventory> {
    signal.throwIfAborted()
    return await scanInventory(this.options)
  }

  /**
   * Review a directory, archive or Markdown file without writing anything.
   * @param path - Absolute source path picked by the user.
   * @param signal - Cancellation.
   * @returns candidates with their issues and proposals, plus source problems.
   */
  @Remote
  async previewImport(path: string, signal: AbortSignal): Promise<SkillImportPreview> {
    signal.throwIfAborted()
    return await previewImport(this.options, path)
  }

  /**
   * Install the reviewed selections of one source.
   * @param request - Source path and selections confirmed from the preview.
   * @param signal - Cancellation; checked before the first write only.
   * @returns installs and per-selection failures.
   */
  @Remote
  async applyImport(request: SkillImportRequest, signal: AbortSignal): Promise<SkillImportOutcome> {
    signal.throwIfAborted()
    return await this.serialized(() => applyImport(this.options, request, (change) => { this.changed(change) }))
  }

  /**
   * Remove one managed install. Project selections that name it keep the
   * reference as missing; the outcome lists those projects.
   * @param installId - Directory name under the library.
   * @param signal - Cancellation; checked before the write only.
   * @returns the outcome; refusals carry an issue and remove nothing.
   */
  @Remote
  async uninstall(installId: string, signal: AbortSignal): Promise<SkillUninstallOutcome> {
    signal.throwIfAborted()
    await this.ready
    return await this.serialized(async () => {
      const outcome = await uninstallSkill(this.options, installId, (change) => { this.changed(change) })
      return { ...outcome, affected: referencesTo(this.table(), installId) }
    })
  }

  /**
   * Projects whose selection references an install, for the uninstall confirmation.
   * @param installId - Directory name under the library.
   * @param signal - Cancellation.
   * @returns the referencing projects.
   */
  @Remote
  async installReferences(installId: string, signal: AbortSignal): Promise<SkillInstallReferences> {
    signal.throwIfAborted()
    await this.ready
    return { installId, projects: referencesTo(this.table(), installId) }
  }

  /**
   * The project page of one session: its folder, the saved selection, and
   * what each tick does in the session's real catalog.
   * @param sessionId - Session whose recorded cwd names the project.
   * @param signal - Cancellation.
   * @returns the page.
   */
  @Remote
  async projectView(sessionId: SessionId, signal: AbortSignal): Promise<SkillProjectView> {
    signal.throwIfAborted()
    await this.ready
    await using session = await this.sessionFacts(sessionId, signal)
    return await this.viewFor(sessionId, session, signal)
  }

  /**
   * Save the selection of the session's project. The registry catalog is
   * invalidated on success, so open sessions of the folder pick the change
   * up at their next request; already injected skill content stays in their
   * history until a new session.
   * @param request - Session, complete install-id list, and the page's revision.
   * @param signal - Cancellation; checked before the write only.
   * @returns whether it saved, and the page as it reads afterwards.
   */
  @Remote
  async setProjectSelection(request: SkillProjectSelectionRequest, signal: AbortSignal): Promise<SkillProjectSelectionOutcome> {
    signal.throwIfAborted()
    await this.ready
    const sessionId = request.sessionId as SessionId
    await using session = await this.sessionFacts(sessionId, signal)
    const resolution = await resolveProject(session.cwd)
    if (resolution.project === null) {
      return {
        saved: false,
        issue: { code: 'no-project', message: `session has no usable project folder (${resolution.problem})` },
        view: await this.viewFor(sessionId, session, signal),
      }
    }
    const project = resolution.project
    const result = await this.serialized(async () => {
      const inventory = await scanInventory(this.options)
      return await saveSelection(this.table(), {
        project,
        enabled: request.enabled,
        expectedRevision: request.revision,
        installed: new Set(inventory.installed.map(item => item.installId)),
        now: () => new Date(),
      })
    })
    if (result.saved) {
      this.invalidateCatalog()
      this.changed({ kind: 'selection', projectKey: project.key })
    }
    const view = await this.viewFor(sessionId, session, signal)
    return result.saved ? { saved: true, view } : { saved: false, issue: result.issue, view }
  }

  private changed(change: SkillLibraryChange): void {
    // Library writes land through renames the delegate's watcher may or may
    // not observe promptly; invalidate on the fact itself.
    if (change.kind !== 'selection') this.invalidateCatalog()
    this.ctx.emit('skill-manager/change', change)
  }

  private table(): ProjectTable {
    return this.projects
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * The session's cwd and the scope its catalog resolves under (live agent, else the recorded preset's
   * standing scope). Upstream 0.1.7 replaced `standingKeyFor` with a reference-counted `acquireScope`
   * lease, so the facts are disposable: hold them for the read, then `await using` releases the revision.
   */
  private async sessionFacts(sessionId: SessionId, signal: AbortSignal): Promise<SessionFacts> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
    const cwd = observation.header.cwd
    const agentPreset = observation.projections?.values.agentPreset ?? undefined
    const none = async () => {}
    const live = this.ctx.get('agents')?.get(sessionId)
    if (live !== undefined) return { cwd, scope: live, [Symbol.asyncDispose]: none }
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { cwd, scope: undefined, [Symbol.asyncDispose]: none }
    try {
      const lease = await presets.acquireScope(agentPreset)
      return { cwd, scope: lease.key, [Symbol.asyncDispose]: () => lease[Symbol.asyncDispose]() }
    } catch {
      // An unknown or unusable recorded preset reads the global layer alone, as the official catalog Remote does.
      return { cwd, scope: undefined, [Symbol.asyncDispose]: none }
    }
  }

  private async viewFor(sessionId: SessionId, session: SessionFacts, signal: AbortSignal): Promise<SkillProjectView> {
    const resolution: ProjectResolution = await resolveProject(session.cwd)
    const inventory = await scanInventory(this.options)
    const record = resolution.project === null ? undefined : this.table().get(resolution.project.key)
    let catalog: SkillCatalogSnapshot | undefined
    if (resolution.project !== null) {
      try {
        catalog = await this.ctx.skills.snapshot({ cwd: session.cwd, scope: session.scope, signal })
      } catch (error) {
        this.ctx.logger.warn(`skill catalog unavailable for session ${sessionId}: ${String(error)}`)
      }
    }
    return buildProjectView({ sessionId, resolution, record, installed: inventory.installed, catalog })
  }
}

/** What a session contributes to the project page. */
interface SessionFacts extends AsyncDisposable {
  cwd: string | undefined
  scope: ScopeKey | undefined
}

export default SkillManager
