/**
 * Pull request capability type vocabulary (B4-P6): availability (never a
 * token), the existing-PR duplicate guard, and the created-PR reference.
 * @module @deepseek-ai/dsh-pull-request/src/types
 */

/** The auth state of the PR provider's login — host and account only, never a token. */
export interface PullRequestAuth {
  /** The host the provider is logged in to (`github.com`). */
  host: string
  /** The logged-in account name. */
  account: string
}

/**
 * Whether this environment can create pull requests: the provider
 * executable exists AND is logged in. The product never reads, displays, or
 * stores a token — the login lives with the provider (gh's own config).
 */
export type PullRequestAvailability =
  | { available: true; auth: PullRequestAuth }
  | { available: false; reason: 'missing-gh' | 'not-authenticated' }

/** One existing pull request for a head branch (duplicate-creation guard). */
export interface ExistingPullRequest {
  /** The PR's web URL. */
  url: string
  /** The PR's number in the repository. */
  number: number
}

/** The durable references of a created pull request. */
export interface CreatedPullRequest {
  /** The PR's web URL. */
  url: string
  /** The PR's number in the repository. */
  number: number
}
