---
description: "The ctx.pullRequest capability contract for developers creating pull requests over an existing provider login, and for maintainers of its availability and duplicate-creation guards."
kind: "package-reference"
---

# dsh-pull-request

English | [中文](README.zh.md)

## Summary

Pull request capability Service Definition (`ctx.pullRequest`) for the DeepSeek Harness (B4-P6): create pull requests through an existing provider login — the product never reads, displays, or stores a token. The provider owns the login (the first local provider, [@deepseek-ai/dsh-pull-request-gh](../pull-request-gh/README.md), calls the user's logged-in `gh` with exact executable + argv); this seam defines what a caller can rely on: availability, the duplicate-creation guard, and creation.

## Table of Contents

- [Semantics](#semantics)
- [Failure vocabulary](#failure-vocabulary)
- [Boundaries held](#boundaries-held)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="semantics"></a>
## Semantics

- `ctx.pullRequest.availability(cwd)` — whether this environment can create pull requests: the provider executable exists AND is logged in. Reports host and account only — never a token.
- `ctx.pullRequest.existing(cwd, head)` — the existing pull request for a head branch, when one already exists: the duplicate-creation guard the caller shows before allowing a create.
- `ctx.pullRequest.create(cwd, { title, body, base, head, draft })` — create one pull request with the user-confirmed fields. An explicit external write: the caller shows the complete preview (title, body, base, head, draft) and obtains explicit confirmation first — a model suggestion is never an authorization.

-----

<a id="failure-vocabulary"></a>
## Failure vocabulary

- `PullRequestUnavailableError('missing-gh' | 'not-authenticated')` — the provider cannot run.
- `PullRequestFailedError(stderr, reason, url?)` — creation failed; the reason classifies the provider's own output (`already-exists` carries the existing PR's URL, `auth`, or `other`) and the raw stderr always rides along.

Nothing here retries, auto-merges, auto-reviews, or auto-labels.

-----

<a id="boundaries-held"></a>
## Boundaries held

No token ever crosses this seam in either direction; the login lives entirely with the provider. The task record keeps only a URL/number reference of a created PR — the platform owns the PR itself.

-----

<a id="model-experience"></a>
## Model Experience

### Pull request creation

#### What the model sees

Nothing. `ctx.pullRequest` serves host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Login lives with the provider** — this seam never holds, reads, or displays a token; a provider without a login simply reports `not-authenticated`.
- **No retry, no automation** — creation is one explicit user-confirmed action; nothing auto-merges, auto-reviews, or auto-labels.

**Runtime invariant:** No companion is published. The provider owns the login and every call is an explicit action over its facts; the seam exposes no independent event sequence or mutable data relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

DeepSeekGUI owns this package; upstream ships no equivalent. Since B5-P4 its only consumer is the coding-tools plugin, which registers the DSH tools that call this seam — the retired Task capability no longer sits in between.

</details>
