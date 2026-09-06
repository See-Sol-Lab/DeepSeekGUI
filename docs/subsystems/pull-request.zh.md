# Pull Request

[English](pull-request.md) | 中文

Pull-request capability seam（`ctx.pullRequest`）：经既有 provider 登录态创建 Pull Request——产品绝不读取、显示或保存 token。provider 拥有登录态（首个本地 provider [dsh-pull-request-gh](../../packages/pull-request/pull-request-gh/README.zh.md) 以精确 executable + argv 调用用户已登录的 `gh`，绝无 shell 字符串）；seam 定义可用性、重复创建护栏，以及以用户确认字段创建。子系统由两个包组成：Service Definition（[dsh-pull-request](../../packages/pull-request/pull-request)，`ctx.pullRequest`）与本地 provider（[dsh-pull-request-gh](../../packages/pull-request/pull-request-gh)）。设计记录：[B4-P6 Agent Note](../../.agents/notes/implemented/feature/2026-09-01-b4-p6-push-pull-request.zh.md)。

源码：[`packages/pull-request/pull-request/src/types.ts`](../../packages/pull-request/pull-request/src/types.ts)

## 类型词汇

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

## 语义

`availability(cwd)` 报告 provider 能否运行（`gh auth status`）：已登录并携带 host/账号事实，或缺失前置条件（`missing-gh` / `not-authenticated`）。`existing(cwd, head)` 返回 head 分支已存在的 PR——调用方在允许创建前展示的重复护栏。`create(cwd, { title, body, base, head, draft })` 以用户确认的字段创建 PR：调用方先完整预览（title、body、base、head、draft）并获得显式确认——模型建议绝不是授权。创建失败按 provider 自身 stderr 词汇分类（`already-exists` 携带既有 PR 的 URL、`auth`、`other`）为携带原始 stderr 的 `PullRequestFailedError`；provider 无法运行时抛 `PullRequestUnavailableError('missing-gh' | 'not-authenticated')`。任何情况都不重试、不自动 merge、不自动 reviewer、不自动标签。调用方（DeepSeekGUI coding tools，B5-P4）把创建结果 PR 的 URL/number 直接作为工具结果返回——PR 本身由平台持有。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
