/**
 * Pull request capability Service Definition (B4-P6): create pull requests
 * through an existing provider login — the product never reads, displays, or
 * stores a token. The provider owns the login (the first local provider
 * calls the user's logged-in `gh` with exact argv); this seam defines what a
 * caller can rely on: availability, the duplicate guard, and creation.
 * @module @deepseek-ai/dsh-pull-request
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CreatedPullRequest, ExistingPullRequest, PullRequestAvailability,
} from './types.ts'

export type {
  CreatedPullRequest, ExistingPullRequest, PullRequestAuth, PullRequestAvailability,
} from './types.ts'

/**
 * The PR provider is unavailable in this environment: the provider
 * executable is missing, or it exists but no login is available.
 */
export class PullRequestUnavailableError extends Error {
  /**
   * @param reason - Which precondition failed.
   */
  constructor(readonly reason: 'missing-gh' | 'not-authenticated') {
    super(reason === 'missing-gh'
      ? 'no pull-request provider executable is available (gh)'
      : 'the pull-request provider is not logged in')
    this.name = 'PullRequestUnavailableError'
  }
}

/**
 * A pull request creation failed. The reason classifies the failure from the
 * provider's own output; the raw stderr rides along verbatim. Nothing is
 * retried and nothing is auto-merged or auto-labeled.
 */
export class PullRequestFailedError extends Error {
  /**
   * @param stderr - The raw provider stderr, verbatim.
   * @param reason - The classified failure.
   * @param url - The existing PR's URL when the failure is a duplicate.
   */
  constructor(
    readonly stderr: string,
    readonly reason: 'already-exists' | 'auth' | 'other',
    readonly url?: string,
  ) {
    super(`pull request creation failed (${reason}): ${stderr}`)
    this.name = 'PullRequestFailedError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pullRequest: PullRequestCapability
  }
}

/**
 * Abstract pull-request service. Subclass, implement the methods, and load
 * the subclass as a plugin — it registers as `ctx.pullRequest` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior). Implementations must honor these
 * semantics:
 * - Every command runs the provider executable through the subprocess seam
 *   with exact executable + argv (never a shell string).
 * - Availability reports the provider's own login facts — host and account
 *   only; a token is never read, displayed, or persisted by this seam.
 * - Creation is an explicit external write: the caller shows the full
 *   preview (title, body, base, head, draft) and obtains confirmation first.
 * - Failures classify by the provider's own output: already-exists, auth,
 *   or other; nothing is retried, auto-reviewed, auto-labeled, or merged.
 */
export abstract class PullRequestCapability extends Service {
  constructor(ctx: Context) {
    super(ctx, 'pullRequest')
  }

  /**
   * Whether this environment can create pull requests: the provider
   * executable exists and is logged in. The reported facts are host and
   * account — never a token.
   * @param cwd - Working directory (the repository the PR would target).
   * @returns availability with the login facts, or the missing precondition.
   */
  abstract availability(cwd: string): Promise<PullRequestAvailability>

  /**
   * The existing pull request for a head branch, when one already exists —
   * the duplicate-creation guard the caller shows before allowing a create.
   * @param cwd - Working directory inside the repository.
   * @param head - The head branch to look up.
   * @returns the existing PR, or `undefined` when none exists.
   */
  abstract existing(cwd: string, head: string): Promise<ExistingPullRequest | undefined>

  /**
   * Create one pull request with the user-confirmed title, body, base, and
   * head, optionally as a draft. The caller shows the complete preview and
   * obtains explicit confirmation before invoking this — a model suggestion
   * is never an authorization. Failures classify as already-exists (the
   * existing PR's URL is extracted), auth, or other, with the raw stderr.
   * @param cwd - Working directory inside the repository.
   * @param opts - The confirmed PR fields.
   * @returns the created PR's URL and number.
   * @throws {@link PullRequestUnavailableError} when the provider cannot run.
   * @throws {@link PullRequestFailedError} when creation fails.
   */
  abstract create(
    cwd: string,
    opts: { title: string; body: string; base: string; head: string; draft: boolean },
  ): Promise<CreatedPullRequest>
}

export default PullRequestCapability
