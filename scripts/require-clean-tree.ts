/**
 * Dirty-tree gate for the distribution build (莉莉丝 2026-09-06, B5 release).
 *
 * A packaged DeepSeekGUI carries its source commit; a `+dirty` identifier
 * means the package holds changes no commit describes, so nobody can ever
 * rebuild it. The public `build:desktop-dist` therefore refuses a dirty
 * checkout up front, before the ten-minute rebuild, and the assemble step
 * refuses again so the internal entry cannot bypass it. Acceptance builds
 * of uncommitted work opt out explicitly:
 *
 *   pnpm run build:desktop-dist --allow-dirty          (argv, reaches the assemble stage)
 *   DEEPSEEKGUI_ALLOW_DIRTY=1 pnpm run build:desktop-dist (env, covers the whole chain)
 *
 * The override is printed loud so the log of an accidental dirty build says so.
 * @module @see-sol-lab/deepseekgui/scripts/require-clean-tree
 */

import { readDevSourceCommit } from '../apps/deepseekgui/src/version-info.ts'

/** Override sources: the assemble-stage flag and the chain-wide variable. */
export const ALLOW_DIRTY_FLAG = '--allow-dirty'
export const ALLOW_DIRTY_ENV = 'DEEPSEEKGUI_ALLOW_DIRTY'

/** What the gate decided for one source-commit identifier. */
export type CleanTreeVerdict =
  | { kind: 'clean'; commit: string }
  | { kind: 'dirty-allowed'; commit: string }
  | { kind: 'dirty-refused'; commit: string }
  | { kind: 'no-git' }

/**
 * Decide whether a build may proceed.
 * @param sourceCommit - `readDevSourceCommit` output (`<sha>` or `<sha>+dirty`, null without git).
 * @param argv - process arguments (checked for {@link ALLOW_DIRTY_FLAG}).
 * @param env - process environment (checked for {@link ALLOW_DIRTY_ENV}).
 * @returns the verdict; the caller turns `dirty-refused` into a failure.
 */
export function cleanTreeVerdict(
  sourceCommit: string | null,
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CleanTreeVerdict {
  if (sourceCommit === null) return { kind: 'no-git' }
  if (!sourceCommit.endsWith('+dirty')) return { kind: 'clean', commit: sourceCommit }
  const allowed = argv.includes(ALLOW_DIRTY_FLAG) || (env[ALLOW_DIRTY_ENV] ?? '') !== ''
  return { kind: allowed ? 'dirty-allowed' : 'dirty-refused', commit: sourceCommit }
}

/**
 * Apply the gate to the checkout at `root`: log the verdict, throw on refusal.
 * @param root - repository root.
 * @param argv - process arguments.
 * @param env - process environment.
 */
export function requireCleanTree(
  root: string,
  argv: readonly string[] = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const verdict = cleanTreeVerdict(readDevSourceCommit(root), argv, env)
  switch (verdict.kind) {
    case 'clean':
      console.log(`require-clean-tree: clean checkout at ${verdict.commit}`)
      return
    case 'dirty-allowed':
      console.warn(`require-clean-tree: WARNING — building an uncommitted tree (${verdict.commit}); override in effect, this package cannot be reproduced from any commit`)
      return
    case 'no-git':
      // The assemble step already fails without git; nothing to gate here.
      console.log('require-clean-tree: git HEAD unavailable; the assemble step decides')
      return
    case 'dirty-refused':
      throw new Error(
        `require-clean-tree: the checkout has uncommitted changes (${verdict.commit}). `
        + `Commit them, or pass ${ALLOW_DIRTY_FLAG} / set ${ALLOW_DIRTY_ENV}=1 for an acceptance build.`,
      )
    default:
      return verdict satisfies never
  }
}

if (import.meta.main) {
  requireCleanTree(process.cwd())
}
