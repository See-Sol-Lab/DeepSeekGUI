# Agent Note: B4-P6 Push & Pull Request — previewed external writes over existing Git/gh credentials

Status: implemented

English | [中文](2026-09-01-b4-p6-push-pull-request.zh.md)

## Problem

B4-P5 committed locally; publishing still required leaving the GUI. Push and Pull Request are external writes with their own failure vocabulary (auth, protected branches, moved remotes, duplicates), and the product must never hold a second credential. The push page needs every fact the user confirms — remote URL, local/remote refs, ahead commits, whether the branch is new — and the PR path needs a provider capability that reuses the user's existing login.

## Decision

### Push: a previewed, classified external write

The git seam gains `remotes(cwd)` (`git remote -v`, tab-separated so URLs with spaces parse), `pushPreview(cwd, remote)` and `push(cwd, remote, localBranch, remoteBranch)`. The preview assembles only facts: the remote URL, the local branch and its target remote ref, the ahead commits (`upstream..HEAD`, or the full local branch when there is no upstream), whether the remote ref exists (`git ls-remote --symref`; an unreachable remote degrades the preview to local facts with `remoteRefExists: undefined` rather than guessing), the remote's default branch, and the effective `credential.helper` — the authentication source, never a token. `push` runs `git push <remote> <local>:<remoteBranch>` and classifies refusals from git's own stderr vocabulary into `GitPushRefusedError` (`non-fast-forward`, `protected`, `auth`, `not-found`, `network`, `rejected` — the raw stderr always rides along); an unconfigured remote fails with `GitNoSuchRemoteError` before any network write. The upstream configuration is never touched by a push, nothing is retried, and there is no force push anywhere.

### Pull Request: an independent provider capability over the existing login

A new capability pair — [dsh-pull-request](../../../../packages/pull-request/pull-request/README.md) Service Definition (`ctx.pullRequest`) and the first local provider [dsh-pull-request-gh](../../../../packages/pull-request/pull-request-gh/README.md) — reuses the user's logged-in `gh` with exact executable + argv through the subprocess seam. `availability(cwd)` runs `gh auth status` and reports host and account only — never a token, in either direction; the login lives entirely in gh's own configuration. `existing(cwd, head)` (`gh pr list --head … --state all`) is the duplicate-creation guard shown before a create; `create(cwd, { title, body, base, head, draft })` runs `gh pr create` with every field verbatim on argv (nothing shell-interpreted; draft is a flag) and classifies failures from gh's own stderr (`already-exists` with the existing PR's URL extracted, `auth`, `other`).

### The task records references only

On success the task stamps `lastPullRequest` (`recordPullRequest`) — URL and number, a reference the platform owns; the PR title/body/base/head stay with the platform. The wire exposes `task.remotes` / `task.pushPreview` / `task.push` / `task.recordPullRequest` and the parallel `pr.availability` / `pr.existing` / `pr.create` domain; error codes `git-push-refused`, `git-no-remote`, `pr-unavailable`, `pr-failed`.

## Verification

- `packages/git/git-local/tests/push.spec.ts` (10, REAL repositories + REAL bare remotes): new-branch preview and push (the remote really holds the pushed SHA, the upstream config is untouched); the credential helper as the authentication source; fast-forward with an upstream and the ahead range emptying after the push; non-fast-forward refusal (two clones diverge); a pre-receive hook refusing as `protected`; a missing remote repository as `not-found`; an unconfigured remote refused before any network write; an unreachable remote degrading the preview to local facts; a detached-HEAD preview refusal; and the classification function across git's stderr vocabulary.
- `packages/pull-request/pull-request-gh/tests/gh.spec.ts` (11, driven fake subprocess — no network, no login): availability logged-in/not-authenticated/missing-gh (login facts only, never a token); the duplicate guard; create with exact argv (Chinese title, multi-line body, draft flag position asserted); duplicate classification with the existing URL extracted; auth and generic failures with the raw stderr.
- `packages/host/apiproxy/tests/api-proxy-task.spec.ts` (push block): remotes/preview/push over real bare remotes with the wire codes; `recordPullRequest` surviving a restart.
- `packages/host/apiproxy/tests/api-proxy-pr.spec.ts`: the pr domain over a fake provider — availability, duplicate guard, create, and the `pr-failed` / `pr-unavailable` mappings.
- `apps/desktop/workbench-plugin/tests/push-view.client.spec.tsx` (jsdom): preview facts; push only after confirmation with the confirmed refs; classified push refusal; provider login facts (never a token); no-auth message; the complete PR preview with create payload assertion and the recorded reference; duplicate guard blocking creation.
- `apply.client.spec.ts` extended to the eleven slot contributions including the Push tab.

## Alternatives considered

**Reading or persisting a token.** The product reads no credential: git uses its own credential helpers, gh its own config/keyring; the preview shows the helper name, availability reports host/account — and nothing else. A second credential store would violate the B4 non-goal and the acceptance that the repository holds no credential.

**Creating a PR by posting to the platform API.** The provider capability with a logged-in `gh` reuses the existing login with zero new credential surface; a raw API client would need a token the product must not hold.

**Guessing push failures from stderr text.** Failures classify only from git's own stable stderr vocabulary into the six named reasons; everything else is a generic rejection with the raw stderr verbatim — a failure is never dressed up as anything else, and nothing is retried.

## Consequences

Push and Pull Request are explicit, previewed external writes: the user confirms the refs, the commits, the authentication source, and the full PR fields (title/body/base/head/draft) before anything leaves the machine. The git seam's write vocabulary gains exactly the explicit push; the pull-request capability is provider-pluggable with the login staying where it belongs. The task record grew one more reference field and no credential and no PR content. The duplicate guard, protected-branch refusal, and moved/unreachable remote all fail clearly; the acceptance path is a real new-branch push plus a real draft PR under explicit user authorization.
