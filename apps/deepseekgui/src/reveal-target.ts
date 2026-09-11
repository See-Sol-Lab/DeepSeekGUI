/**
 * Canonical reveal-target resolution (B6-2). Resolution always starts from the
 * session cwd: relative caller text resolves against it, absolute text stands
 * as written. Only the containment root widens — a session whose cwd sits in a
 * repository subdirectory may also reveal the repository-relative rows the
 * Changes view lists, because that view already reports the whole repository.
 * The wider root comes from a filesystem marker probe, never from `git`.
 * Lexical containment alone cannot see through symlinks and junctions, so every
 * judgement ends by comparing `realpath` identities of its root and target.
 */
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/** Windows path spelling is not authoritative for identity; POSIX spelling is. */
const CASE_SENSITIVE = process.platform !== 'win32'

/** Outcome classes for one reveal request. */
export type RevealTarget =
  | { readonly kind: 'ok'; readonly target: string }
  | { readonly kind: 'outside'; readonly target: string }
  | { readonly kind: 'missing'; readonly target: string }

/** One containment question: where relative text resolves, and which subtree it may name. */
export interface RevealRequest {
  /** Session working directory from Harness facts; every relative path resolves against it. */
  readonly cwd: string
  /** The allowed root: the cwd itself, or an ancestor of it the caller chose. */
  readonly root: string
  /** Caller text: relative to `cwd`, or absolute. */
  readonly path: string
}

/** Fold a path for comparison only; the folded spelling never leaves this module. */
function comparable(path: string): string {
  return CASE_SENSITIVE ? path : path.toLowerCase()
}

/**
 * Whether `target` is `root` itself or sits below it, by spelling alone.
 * The separator sentinel is what keeps `E:\repo-secret` out of `E:\repo`.
 */
function contains(root: string, target: string): boolean {
  const comparableRoot = comparable(root)
  const comparableTarget = comparable(target)
  if (comparableTarget === comparableRoot) return true
  const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep
  return comparableTarget.startsWith(prefix)
}

/**
 * The repository root a session in a subdirectory may reveal into: the nearest
 * strict ancestor of `cwd` carrying a `.git` entry of any kind — a directory for
 * an ordinary clone, a `gitdir:` pointer file for a linked worktree or a
 * submodule. Existence is probed, never read, so both shapes count, and an
 * unreadable ancestor reads as "no marker" and only ever narrows the result.
 * Null means there is nothing to widen: `cwd` carries the marker itself, or no
 * ancestor does. This is a filesystem marker probe, not `git rev-parse`; it can
 * name a different directory than Git would under `GIT_DIR`, `GIT_WORK_TREE`,
 * `core.worktree`, `GIT_CEILING_DIRECTORIES`, or a stale `.git`.
 * @param cwd - the session working directory.
 * @returns the wider allowed root, or null when there is nothing to widen.
 */
export function repositoryRootOf(cwd: string): string | null {
  const start = resolve(cwd)
  if (existsSync(join(start, '.git'))) return null
  let current = start
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return null
    if (existsSync(join(parent, '.git'))) return parent
    current = parent
  }
}

/**
 * Resolve and canonically contain one reveal target against one explicit root.
 * Resolution always starts from `cwd`; only `root` decides what counts as inside.
 * @param request - session cwd (the resolution base), allowed root, and caller text.
 * @returns the canonical target, or the first failing outcome class.
 */
export function containedTargetOf(request: RevealRequest): RevealTarget {
  const root = resolve(request.root)
  const target = resolve(request.cwd, request.path)
  if (!contains(root, target)) return { kind: 'outside', target }
  let realRoot: string
  try {
    realRoot = realpathSync(root)
  } catch {
    // The allowed root itself is gone: name the root, not the join.
    return { kind: 'missing', target: root }
  }
  let realTarget: string
  try {
    realTarget = realpathSync(target)
  } catch {
    return { kind: 'missing', target }
  }
  if (!contains(realRoot, realTarget)) return { kind: 'outside', target }
  return { kind: 'ok', target: realTarget }
}

/**
 * Resolve one reveal request for a session (B6-2). The target is judged against
 * the session cwd first — everything landing inside it behaves exactly as before,
 * and the marker probe never runs — and only a target outside the cwd is judged a
 * second time against the session's repository root, so a session in a repository
 * subdirectory can still reveal the repository-relative rows the Changes view
 * lists. Each judgement completes its own lexical and realpath stages, so one
 * root's spelling is never matched against another root's canonical identity.
 * A workspace in no repository stays cwd-only.
 * @param cwd - the session working directory, from official Harness facts.
 * @param path - caller text: relative to the cwd, or an absolute path.
 * @returns the canonical target, or the first failing outcome class.
 */
export function revealTargetOf(cwd: string, path: string): RevealTarget {
  const withinCwd = containedTargetOf({ cwd, root: cwd, path })
  if (withinCwd.kind !== 'outside') return withinCwd
  const repositoryRoot = repositoryRootOf(cwd)
  if (repositoryRoot === null) return withinCwd
  return containedTargetOf({ cwd, root: repositoryRoot, path })
}
