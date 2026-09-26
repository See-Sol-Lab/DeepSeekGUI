/**
 * The one skill provider of the managed library (B7-P5). It delegates
 * discovery and loading to an unregistered official filesystem provider
 * rooted at the library alone, then keeps only the installs the calling
 * session's project selected. Every official consumer — the model catalog,
 * the `skill` tool, the user's `/name` line, the `/` picker — reads the
 * registry with the session cwd, so this one filter is the selection.
 *
 * The provider registers into the host layer at rank 550: after the
 * official user roots (400/500), before the bundled root (600), and behind
 * any preset-layer provider outright — an official skill of the same name
 * shadows a managed one, which the project page reports rather than hides.
 */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { MANAGED_PROVIDER_NAME } from './selection.ts'

/** Source label the managed candidates carry into catalogs and prompts. */
export const MANAGED_SOURCE = 'deepseekgui-managed'

/** Rank inside the host layer: after the official user roots, before the bundled root. */
export const MANAGED_RANK = 550

/** What the provider needs from the manager. */
export interface ManagedProviderOptions {
  /** Absolute library directory bound for this Harness generation. */
  libraryDir: string
  /** Whether the delegate watches the library for changes. */
  watch: boolean
  /**
   * The install ids the session's project selected; undefined when the cwd
   * resolves to no project (no folder, or the folder is gone).
   */
  enabledFor: (cwd: string, signal: AbortSignal | undefined) => Promise<readonly string[] | undefined>
  /** Discovery seam for tests; production builds the official filesystem provider over the library. */
  delegate?: Pick<SkillProvider, 'list' | 'get'>
}

/** Managed-library provider: official discovery, project-filtered. */
export class ManagedSkillProvider implements SkillProvider {
  readonly name = MANAGED_PROVIDER_NAME
  private readonly delegate: Pick<SkillProvider, 'list' | 'get'>

  /**
   * @param ctx - Host context (logger and optional filesystem service for the delegate).
   * @param control - The registration's control; the delegate's watcher invalidates through it.
   * @param options - Library root, watch flag, and the selection lookup.
   */
  constructor(ctx: Context, control: SkillProviderControl, private readonly options: ManagedProviderOptions) {
    // No default roots: the library is the only root, so the app's bundled
    // skills and the user roots never re-appear under this provider's name.
    // The delegate closes its own watchers when the registration's control
    // signal aborts, so this class has no disposal of its own.
    this.delegate = options.delegate ?? new FileSystemSkillProvider(ctx, control, {
      providerName: MANAGED_PROVIDER_NAME,
      includeDefaultRoots: false,
      customSkillDirs: [options.libraryDir],
      watch: options.watch,
    })
  }

  /**
   * List the installs the session's project selected.
   * @param options - lookup options; `cwd` selects the project.
   * @returns the selected candidates at the managed rank; nothing without a project or a selection.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    if (options.cwd === undefined) return []
    const enabled = await this.options.enabledFor(options.cwd, options.signal)
    if (enabled === undefined || enabled.length === 0) return []
    const output = await this.delegate.list(options)
    const observation: SkillProviderObservation = 'candidates' in output ? output : { candidates: output, complete: true }
    const selected = new Set(enabled)
    const candidates = observation.candidates
      .filter(candidate => selected.has(basename((candidate.locator as { directory: string }).directory)))
      .map(candidate => ({ ...candidate, source: MANAGED_SOURCE, rank: MANAGED_RANK }))
    return observation.complete ? candidates : { candidates, complete: false }
  }

  /**
   * Load one selected skill through the delegate.
   * @param candidate - a candidate this provider listed.
   * @param options - lookup options.
   * @returns the definition, or undefined when the file is gone.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    return await this.delegate.get(candidate, options)
  }
}
