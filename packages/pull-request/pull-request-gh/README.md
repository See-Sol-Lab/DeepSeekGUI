---
description: "The gh-backed pull-request provider for developers creating pull requests through the user's logged-in gh CLI, and for maintainers of its exact executable-plus-argv invocation."
kind: "package-reference"
---

# dsh-pull-request-gh

English | [中文](README.zh.md)

## Summary

GitHub CLI implementation of the DeepSeek Harness pull-request capability seam (B4-P6): the user's logged-in `gh`, invoked with exact executable + argv through the subprocess seam — never a shell string, bounded collected output. The login lives entirely in gh's own configuration (keyring, config file, or `gh auth login`); this provider only asks gh for its facts and never reads, displays, or stores a token.

## Table of Contents

- [Commands](#commands)
- [Failure classification](#failure-classification)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="commands"></a>
## Commands

- `gh auth status` — availability: exit 0 means logged in; the `Logged in to <host> account <account>` line supplies the reported host and account.
- `gh pr list --head <head> --state all --json number,url` — the duplicate-creation guard.
- `gh pr create --title <title> --body <body> --base <base> --head <head> --json number,url [--draft]` — creation; title/body/base/head ride argv verbatim, the draft is a flag, and the result is the PR's number and URL.

-----

<a id="failure-classification"></a>
## Failure classification

Creation failures classify from gh's own stderr vocabulary: `already-exists` (the existing PR's URL is extracted from the stderr), `auth`, or `other` — the raw stderr always rides along. A missing executable surfaces as `PullRequestUnavailableError('missing-gh')`.

-----

<a id="model-experience"></a>
## Model Experience

### Pull request creation

#### What the model sees

Nothing. This provider serves the `ctx.pullRequest` seam for host-side consumers only: no tools, no prompts, no session events.

#### Token effect

Zero direct tokens on every request; the login lives in gh's own configuration and is never read here.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The provider speaks only to hosts gh is logged in to; a repository whose remote host has no gh login fails clearly at availability or creation.
- No retry, no auto-merge, no auto-reviewer, no auto-label — creation is one explicit user-confirmed action.

**Runtime invariant:** No companion is published. The login lives with gh's own configuration and every call is an explicit action over its facts; the provider exposes no independent event sequence or mutable data relation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

DeepSeekGUI owns this package; upstream ships no equivalent. Since B5-P4 its only consumer is the coding-tools plugin, which registers the DSH tools that call this seam — the retired Task capability no longer sits in between.

</details>
