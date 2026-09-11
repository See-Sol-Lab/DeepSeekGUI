# Agent Note: Widen reveal containment to the session's repository root

Status: implemented

English | [中文](2026-09-09-reveal-containment-repository-root.zh.md)

## Problem

The Changes view lists Git status entries, whose paths are repository-relative, while `reveal-path` resolved and contained every target against the session cwd alone. A session opened in a repository subdirectory therefore could not reveal any row the view showed for the rest of the repository: the joined absolute path necessarily lands outside the cwd and was refused. Joining the row onto `repository.root` in the renderer fixed the spelling but not the judgement, so the failure only changed shape from a silent no-op into a refusal.

The same comparison also refused targets whose spelling differed from the cwd's by case. Windows `realpathSync` returns the caller's spelling for every segment rather than the on-disk one, so a cwd taken from the session header and a root taken from Git could disagree without either being wrong.

## Decision

`reveal-target.ts` keeps the session cwd as the sole resolution base and widens only the containment root. `revealTargetOf` judges the target against the cwd first; only an `outside` verdict is judged a second time against the session's repository root. Each judgement runs its own lexical and `realpath` stages through `containedTargetOf`, so one root's spelling is never matched against another root's canonical identity, and the ordinary case — a target inside the cwd — never probes the filesystem for a repository at all.

`repositoryRootOf` finds the nearest strict ancestor carrying a `.git` entry by probing existence only. A linked worktree and a submodule carry a `gitdir:` pointer file rather than a directory, and `git rev-parse --show-toplevel` returns exactly the directory holding that entry, so existence matches Git's answer where a directory test would not. An unreadable ancestor reads as "no marker", which can only narrow the result. A cwd carrying the marker itself, or no ancestor carrying one, returns null and leaves behaviour identical to before. This is a filesystem marker probe, not `git rev-parse`: it can name a different directory than Git would under `GIT_DIR`, `GIT_WORK_TREE`, `core.worktree`, `GIT_CEILING_DIRECTORIES`, or a stale `.git`. Nearest-wins bounds the divergence — a marker planted between the cwd and the true root only narrows the allowed root, never widens it.

Comparison folds case on Windows only, mirroring `packages/fs/fs-sandbox/src/containment.ts`. The folded spelling is used for comparison alone; the returned target keeps its `realpath` spelling, because it is handed to `statSync` and `shell.showItemInFolder`.

The wire contract is unchanged: `parseControlCommand` still accepts exactly `{type, sessionId, path}`, and no renderer file changed. The allowed root is derived in main from the cwd that main already resolves from official session facts, so no caller-supplied value needs to be trusted.

## Alternatives considered

**Let the renderer send `repository.root` and have main verify it.** Rejected. The verification reduces to a boolean agreement with a root main can derive by itself, so it buys no authority. A compromised renderer can read the same root from `inspector.status` and would reach the identical file set, while an honest renderer gains a new failure mode: the first frame has `root === ''`, and a fourth field breaks the strict three-key parser, so the command would be rejected silently.

**Ask the harness over the existing loopback RPC (`workbenchInspector/status`).** Rejected. That call runs a full `git status --porcelain=v2` on the host with fsmonitor disabled — measured at 110–160 ms and multiple seconds on large repositories. Reveal accepts any path-shaped span in the conversation, so an unbounded, deliberately uncached read-only check would become a CPU and IO amplifier on the host. It also raises the trust ceiling to whatever the harness reports and would widen `HarnessApi` beyond the settings and session surface it documents.

**Test the marker with `statSync(...).isDirectory()` or read `.git/HEAD`.** Rejected. Both reject the pointer-file shape, which would leave every worktree and submodule session with the original defect.

**Exclude `.git`, `.env`, and similar paths from the widened root.** Rejected. Such a list cannot be complete, so it offers a false boundary; the action reveals a file manager selection rather than content, and the existing open-workspace button plus a few clicks already reaches the same directory. Fixed security invariants are preferred over a list that would grow into a tunable.

**Add a locale string for the refusal.** Rejected. Reveal deliberately raises no dialog and both callers swallow the rejection, so the text never reaches a user; a dictionary key would imply a surface that does not exist.

## Consequences

A session whose cwd sits in a repository subdirectory can reveal anything inside that repository, which is the disclosure range the Changes view already has — the same inspector serves full `status`, `diff`, and `text` for every changed file in the repository, and every row already offers "copy path". Newly reachable relative to before are paths the view does not list, notably `<repo>/.git/**` and root-level dotfiles, because reveal also accepts arbitrary path-shaped text from the conversation. The action's blast radius is one explorer window: directories open, files are selected, nothing is read back into the page or executed.

A workspace belonging to no repository is unchanged and stays cwd-only, as is a session already at the repository root. Failure directions remain closed: `existsSync` never throws, so permission faults read as "no marker", and a `realpath` failure yields `missing` or `outside`. POSIX comparison stays byte-exact, so case sensitivity is preserved where the filesystem provides it.

## Verification

`vitest run apps/desktop/tests/reveal-target.spec.ts apps/desktop/tests/control-model.spec.ts` — the six original cases are unchanged and now serve as the cwd-only regression anchor; added cases cover the nearest-marker walk, the pointer-file shape, nearest-wins narrowing, resolution staying cwd-based under a widened root, a subdirectory session reaching a repository-root file, refusal outside the repository, and platform-gated case behaviour on both families.
