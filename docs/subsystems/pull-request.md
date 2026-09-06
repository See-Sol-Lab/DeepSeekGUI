# Pull Request

English | [中文](pull-request.zh.md)

The pull-request capability seam (`ctx.pullRequest`): create pull requests through an existing provider login — the product never reads, displays, or stores a token. The provider owns the login (the first local provider, [dsh-pull-request-gh](../../packages/pull-request/pull-request-gh/README.md), calls the user's logged-in `gh` with exact executable + argv, never a shell string); the seam defines availability, the duplicate-creation guard, and creation with the user-confirmed fields. The subsystem is two packages: the Service Definition ([dsh-pull-request](../../packages/pull-request/pull-request), `ctx.pullRequest`) and the local provider ([dsh-pull-request-gh](../../packages/pull-request/pull-request-gh)). Design record: [B4-P6 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p6-push-pull-request.md).

Source: [`packages/pull-request/pull-request/src/types.ts`](../../packages/pull-request/pull-request/src/types.ts)

## The type vocabulary

```ts type-equiv
/** The auth state of the PR provider's login — host and account only, never a token. */
interface PullRequestAuth {
  /** The host the provider is logged in to (`github.com`). */
  host: string
  /** The logged-in account name. */
  account: string
}
```

```ts type-equiv
/**
 * Whether this environment can create pull requests: the provider
 * executable exists AND is logged in. The product never reads, displays, or
 * stores a token — the login lives with the provider (gh's own config).
 */
type PullRequestAvailability =
  | { available: true; auth: PullRequestAuth }
  | { available: false; reason: 'missing-gh' | 'not-authenticated' }
```

```ts type-equiv
/** One existing pull request for a head branch (duplicate-creation guard). */
interface ExistingPullRequest {
  /** The PR's web URL. */
  url: string
  /** The PR's number in the repository. */
  number: number
}
```

```ts type-equiv
/** The durable references of a created pull request. */
interface CreatedPullRequest {
  /** The PR's web URL. */
  url: string
  /** The PR's number in the repository. */
  number: number
}
```

## Semantics

`availability(cwd)` reports whether the provider can run (`gh auth status`): logged in with host/account facts, or the missing precondition (`missing-gh` / `not-authenticated`). `existing(cwd, head)` returns the existing PR for a head branch — the duplicate guard the caller shows before allowing a create. `create(cwd, { title, body, base, head, draft })` creates one PR with the user-confirmed fields: the caller shows the complete preview (title, body, base, head, draft) and obtains explicit confirmation first — a model suggestion is never an authorization. Creation failures classify from the provider's own stderr vocabulary (`already-exists` with the existing PR's URL, `auth`, `other`) as `PullRequestFailedError` with the raw stderr; a provider that cannot run raises `PullRequestUnavailableError('missing-gh' | 'not-authenticated')`. Nothing is retried, auto-merged, auto-reviewed, or auto-labeled. The caller (DeepSeekGUI coding tools, B5-P4) returns the created PR's URL/number directly as the tool result — the platform owns the PR itself.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpullrequest--pullrequestcapability-abstract-seam"></a>

### `ctx.pullRequest` — `PullRequestCapability` (abstract seam)

Abstract pull-request service. Subclass, implement the methods, and load the subclass as a plugin — it registers as `ctx.pullRequest` (one implementation per context; loading a second throws, which is cordis' standard duplicate-service behavior). Implementations must honor these semantics:

- Every command runs the provider executable through the subprocess seam with exact executable + argv (never a shell string).
- Availability reports the provider's own login facts — host and account only; a token is never read, displayed, or persisted by this seam.
- Creation is an explicit external write: the caller shows the full preview (title, body, base, head, draft) and obtains confirmation first.
- Failures classify by the provider's own output: already-exists, auth, or other; nothing is retried, auto-reviewed, auto-labeled, or merged.

```ts cordis-catalog
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
abstract create( cwd: string, opts: { title: string; body: string; base: string; head: string; draft: boolean }, ): Promise<CreatedPullRequest>
```

Source: [`packages/pull-request/pull-request/src/index.ts`](../../packages/pull-request/pull-request/src/index.ts)
<!-- END GENERATED cordis-surface -->
