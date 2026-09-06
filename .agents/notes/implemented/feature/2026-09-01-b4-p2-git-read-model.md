# Agent Note: B4-P2 Git Read Model — the read-only Git capability and Repository Changes panel

Status: implemented

English | [中文](2026-09-01-b4-p2-git-read-model.zh.md)

## Problem

B4's daily coding surface needs repository facts — identity, HEAD/branch/upstream, work trees, status, and diffs — presented beside B3's session-owned Changes panel, with Git as the single owner and no second Git database. B4-P2 must establish the replaceable Git capability (Service Definition + local Provider + Workbench Consumer) using exact system-git argv and stable machine formats, reading only on view open, after operations, or on explicit refresh — no watcher, no Electron exec, no shell strings, and no English-stderr state guessing.

## Decision

### The git seam: `@deepseek-ai/dsh-git` (`ctx.git`) + `@deepseek-ai/dsh-git-local`

A new host-side capability seam modeled on the subprocess split: the Service Definition (`GitCapability`, `ctx.git`) declares six read-only queries, and the local provider executes the system git through `ctx.subprocess` with exact executable + argv (never a shell string), bounded collected output, a 30-second query deadline, and a 5-second terminate grace.

- `repoIdentity(cwd)` — one `git rev-parse --show-toplevel --absolute-git-dir --is-bare-repository` call.
- `head(cwd)` — `git branch --show-current` plus `git rev-parse HEAD`: branch, detached, or unborn.
- `upstream(cwd)` — `git rev-parse --abbrev-ref --symbolic-full-name @{u}` plus `git rev-list --left-right --count @{u}...HEAD`; the definite 128 rejection maps to `undefined` (no upstream), every other failure propagates.
- `worktrees(cwd)` — `git worktree list --porcelain`.
- `status(cwd)` — `git status --porcelain=v2 --branch -z`, parsed by a pure function in `src/parse.ts` (headers are NUL-terminated under `-z` too, and a `2` rename record carries its original path as a second NUL field).
- `diff(cwd, scope, path?, wantPatch?, patchMaxBytes?)` — `git diff [--cached] --name-status -z` plus `--numstat -z` merged per path (status letters, line counts, binary facts); a requested patch over the bound (default 512 KiB) is refused whole with `GitDiffTooLargeError`.

Every query first probes `repoIdentity`, so a non-repository directory fails as `GitNotARepositoryError` before any command runs. The provider resolves `git` and checks the version (`git --version`, porcelain-v2 floor 2.11) once per service lifetime. Failures classify only by verifiable facts: unavailable (resolution/spawn), not-a-repository (probe exit 128), unsupported-version (version parse), command-failed (any other non-zero exit — carrying the exact argv, cwd, exit code, and the raw stderr verbatim, never parsed), and too-large. Lock, permission, and configuration failures land in `GitCommandFailedError` with their original text.

### The wire domain: `git.*`

The api gateway adds the closed `git.*` domain — `repo`, `status`, `diff` — with wire schemas, `RpcMethodMap` rows, the fetch carrier pair, and four new error codes (`git-not-repository`, `git-unsupported-version`, `git-command-failed`, `git-too-large`; `git-unavailable` is reused from B4-P1 with the same `{ workdir }` details shape). `git.repo` fans out to identity/head/upstream/worktrees in parallel. The client connection fixture and both test fake-API clients implement the domain as in-memory doubles.

### The Workbench surface: Repository Changes panel

`apps/desktop/workbench-plugin` registers a fourth `conversation.view` tab (`id: 'repo'`, order 50). The panel reads the current session's cwd and, on open and explicit refresh only (a generation-guarded load, no polling), fetches the repo bundle plus status through the `gitClient` wire wrapper. It renders:

- the branch/detached/unborn badge, the upstream ref with ahead/behind, the clean badge, and the repo root;
- entries grouped as conflicts / staged / unstaged / untracked with their XY status codes and rename arrows;
- a per-file diff view on selection, with staged/unstaged scope switching and the patch (or the too-large/empty states);
- a persistent source label — "Source: Git work tree" — so the panel is explicitly parallel to and distinct from the B3 Changes panel, whose source is session events; nothing here is ever attributed to a Session.

The panel holds no repository state of its own; it never writes (no stage/revert/commit/push paths exist anywhere in B4-P2).

## Verification

- `packages/git/git-local/tests/parse.spec.ts` (12): porcelain v2 records (staged/unstaged/untracked/conflict/rename, NUL-terminated headers, detached/unborn heads), worktree porcelain, name-status -z, numstat -z, and the merge helper.
- `packages/git/git-local/tests/parse-real.spec.ts` (8, REAL command captures): the parser input bytes come from actual `git` stdout — status over clean/mixed/rename/conflict/binary repositories, worktree porcelain, name-status/numstat diff bytes, and the version line — never from hand-written mock records. A hand-written mock and a wrong parser can hide each other; real bytes cannot (review discipline, carried into later phases: whenever a parser consumes an external format, its test fixtures must be captured from the real command, not authored by hand).
- `packages/git/git-local/tests/provider.spec.ts` (6, scripted subprocess): exact argv per query, unavailable/unsupported-version/not-a-repository/command-failed classification, upstream-absent 128 handling, and cwd discipline.
- `packages/git/git-local/tests/local.spec.ts` (11, REAL temporary repositories): identity, non-repo rejection, branch/detached/unborn heads, upstream with ahead/behind, status surfaces (staged/unstaged/untracked, `2 RM` rename-plus-modify, add/add conflict), binary files, work trees, staged/unstaged diffs with patches, the too-large patch refusal, and submodule gitlink changes.
- `packages/host/apiproxy/tests/api-proxy-git.spec.ts` (4, real gateway + real repo): the repo bundle, status groups, diffs with patches, and the not-repository failure codes.
- `apps/desktop/workbench-plugin/tests/git-client.spec.ts` (6): wire envelope, payloads, and error codes of the three git.* methods.
- `apps/desktop/workbench-plugin/tests/repo-changes-view.client.spec.tsx` (6, jsdom): empty state, bundle/status load, grouped entries, per-file diff selection, non-repo error, and detached badge.
- `apply.client.spec.ts` extended to the nine slot contributions including the Repository tab.

## Alternatives considered

**A second Git state layer.** The read model projects Git's machine formats directly; caching, indexes, or a database would duplicate the one owner and drift.

**Classifying stderr text.** Lock/permission/config failures are presented with their raw stderr and exit code instead — actionable without guessing at English text, per the B4-P2 boundary.

**A repository watcher.** Queries run only on view open, after operations, or on explicit refresh; a watcher would be a background process B4-P2 explicitly does not build.

**Integrating the B3 Changes panel.** Session Changes answers "what this session did" (session events); Repository Changes answers "what the work tree is now" (Git). Two panels with a source label keep the facts honest and never attribute human edits to a session.

## Consequences

The web profile composition gains `@deepseek-ai/dsh-git-local` (host) and the gateway's `git.*` domain; the Workbench gains a Repository Changes tab whose facts all live in Git. Every query costs one bounded read-only git invocation plus the identity probe. Windows git path spelling (forward slashes) is presented verbatim as Git's own fact. B4-P3's worktree lifecycle and B4-P4's index operations build on the same seam — the capability is already replaceable, and the read model's failure vocabulary carries forward unchanged.
