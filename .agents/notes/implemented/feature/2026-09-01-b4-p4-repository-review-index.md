# Agent Note: B4-P4 Repository Review & Index — file/hunk stage, unstage, and controlled tracked revert over git-diff facts

Status: implemented

English | [中文](2026-09-01-b4-p4-repository-review-index.zh.md)

## Problem

B4-P2 projected the work tree read-only; B4-P3 added worktree lifecycle writes. Daily coding needs the index managed from the GUI — staging and unstaging whole files and individual hunks, and reverting tracked work-tree changes — with Git as the sole owner of repository state, no second Git database, and no destructive shortcuts. Every write must re-read the authoritative status, every revert must show the exact target and the content that would be lost before executing, and B4's boundaries stay fixed: untracked files are never deleted, `clean`/`reset --hard` never run, conflicts are never auto-resolved, and the Session Changes panel keeps its own event source while gaining a locate entry into the Repository Review.

## Decision

### The git seam's index/revert write surface

`GitCapability`/`LocalGitCapability` add four methods — the seam's only writes beyond the worktree lifecycle:

- `applyIndexPatch(cwd, patch, reverse)` — `git apply --cached [--reverse] -`, with the patch delivered through the subprocess stdin (`{ data: string }`), never a shell string or a temp file. This is the hunk stage/unstage primitive: stage applies the unstaged-diff hunk forward, unstage applies the staged-diff hunk in reverse, both index-only. Git itself validates the context against the current index, so a stale hunk or an externally changed index fails as `GitCommandFailedError` with the raw stderr — the UI never marks a failed apply as success.
- `stageFile(cwd, path)` — `git add -- <path>`: one whole path, including untracked files (B4 refuses to DELETE untracked files, never to track them), binary files, and both sides of a rename (the status rename pair names the old and new path; staging only the new side would leave the deletion unstaged).
- `unstageFile(cwd, path)` — generates the staged diff itself (`git diff --cached --binary`, covering both sides of a rename) and reverse-applies it to the index: the index moves back toward HEAD, the work tree is untouched. The mechanism is identical for text, binary, rename, and unborn-HEAD entries (a staged new file leaves the index again on a repository with no commits). A path with no staged changes is a no-op.
- `revertFile(cwd, path)` — `git checkout -- <path>`: restores a tracked work-tree file from the index, discarding its unstaged modifications while staged changes stay staged. Refused up front with `GitRevertRefusedError` for untracked paths and for unmerged conflict entries, checked against the authoritative status; git's own refusal is the backstop.

`diff`'s requested patch now carries `--binary`, so binary files produce a literal patch the index operations can re-apply; text patches are byte-identical to plain `git diff` output.

### Wire domain: every write answers with the fresh authoritative status

`git.applyPatch`, `git.stageFile`, `git.unstageFile`, and `git.revertFile` each run the write through the capability, then re-read `git.status` and return it — "every write re-reads Git authoritative state" is enforced host-side, and the panel renders the write's own response instead of a stale snapshot. A failed write returns the raw error (`git-command-failed` with stderr, or the new `git-revert-refused` code with `{ path, reason }`). The connection fixture and both test fake-API clients mirror the domain with a small mutable index mirror.

### Repository Review UI: per-kind actions, hunk patches, revert confirmation

The Repository Changes panel offers per-entry actions by kind: untracked → Stage only; purely unstaged → Stage + Revert; purely staged → Unstage; partially staged (`MM`, one porcelain v2 record) → Stage (completing) + Unstage; conflict → no actions at all.

The per-file diff is split into header plus hunks by a pure function (`splitDiffHunks`), which preserves the patch's line bytes; each hunk renders with a Stage/Unstage-hunk button that reassembles `header + hunk` and sends it to `git.applyPatch` — the applied bytes are the git-diff facts themselves, never reconstructed text. `--binary` patches (no `@@` hunks) render without hunk buttons.

Revert opens a confirmation dialog showing the exact target path and the current unstaged diff (the content that would be lost); Cancel never calls the wire, Confirm runs the controlled revert. After every successful write the panel adopts the returned status and reloads the selected file's diff.

### Session Changes locate entry

The Changes panel (session-event source, unchanged) gains a per-group "locate" button that writes `{ path, seq }` into a small shared store (`createRepoLocateStore`, one handle shared by the changes and repo registrations inside apply). The Repository Changes panel consumes the request when it mounts (the user switches to the Repository tab): it matches the path against `repoRoot + entry.path` in git-style spelling, opens that entry's diff, and acknowledges by clearing. No event is ever re-attributed; the request is a same-session navigation aid and is deliberately not persisted.

## Verification

- `packages/git/git-local/tests/index-ops.spec.ts` (10, REAL temporary repositories): partial stage (one hunk of a two-hunk change stages the index half-way; the authoritative status shows the single `MM` record, and the staged/unstaged diffs carry exactly their own hunks); reverse unstage of the staged hunk; stale hunk (the index advances while the patch was computed against the older snapshot → `GitCommandFailedError`, nothing half-applied); external concurrency during unstage (the re-read status reflects the external edit); rename (work-tree move reads as deleted + untracked, staging both sides produces the staged rename, unstage reverts both index sides); binary stage/unstage; untracked stage and unborn-HEAD unstage; garbage and stale-context patch refusals; tracked revert (discards unstaged, keeps staged); untracked and conflict revert refusals with the conflict markers intact; no-op unstage. All patch bytes come from real `git diff` captures (the B4-P2 review discipline).
- `packages/host/apiproxy/tests/api-proxy-git.spec.ts` (8, real gateway + real repo, includes the B4-P4 block): hunk stage over the wire with the fresh status response, whole-file stage/unstage (including untracked), failed/stale apply codes, and the revert refusal/confirmation path.
- `apps/desktop/workbench-plugin/tests/diff-hunks.spec.ts` (4): line-preserving split, hunk reassembly, no-hunk header, `+@@` content lines, out-of-range safety.
- `apps/desktop/workbench-plugin/tests/git-client.spec.ts` (extended): the four write methods' envelopes, the fresh-status returns, and the failure codes.
- `apps/desktop/workbench-plugin/tests/repo-changes-view.client.spec.tsx` (jsdom, extended): per-kind action buttons (conflict rows have none), file stage/unstage calls, hunk stage sending `header + hunk`, revert confirmation showing the target and the lost content with Cancel never writing and Confirm reverting, failed-apply error display, and locate-request consumption.
- `apps/desktop/workbench-plugin/tests/changes-view.client.spec.tsx` (jsdom, adapted): the locate button hands the exact path to the store; the panel's event source is untouched.
- Machine note: the previous-phase discovery still holds — the development machine's home directory contains a stray `.git`, so tests keep using `GIT_CEILING_DIRECTORIES` for "outside any repository" scenarios.

## Alternatives considered

**Interactive `git add -p` / `git reset -p`.** These are terminal-interactive and parse into the process's TTY; a GUI needs a non-interactive, fact-based mechanism. `git apply --cached` over the git-diff bytes is that mechanism, and git's own context validation replaces any hand-rolled staleness check.

**Unstaging via `git reset -q HEAD -- <path>`.** Simple, but it fails on unborn HEADs (no HEAD to reset to) and handles rename pairs incompletely; the reverse-apply of the self-generated staged diff covers text, binary, rename, and unborn-HEAD with one mechanism.

**`git checkout -f` / `git reset --hard` for revert.** These discard staged and unstaged changes alike and can touch more than the target path; the controlled revert restores from the index only and refuses untracked and conflict paths before git is even asked.

**Auto-resolving conflicts or deleting untracked files.** Both are destructive guesses about user intent; B4 leaves conflict markers in place and never offers untracked-file deletion.

## Consequences

The Repository Changes panel now manages the index end-to-end: file and hunk stage/unstage, controlled tracked revert with explicit confirmation, and fresh authoritative status after every write. The git seam's write vocabulary is closed and bounded — no commit, no push, no `clean`, no `reset --hard` anywhere — and its read-model failure classification carries forward unchanged. The Session Changes panel gains a locate entry without changing its event source. B4-P5's commit flow builds on the same staged-review surface.
