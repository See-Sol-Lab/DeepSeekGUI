/**
 * DeepSeekGUI: the desktop ships its own pnpm and names its entry in
 * `DSH_PNPM_ENTRY`. The official desktop passes the same fact to
 * `runProfile` as `packageManager`; the CLI path has no such parameter, so
 * without this translation plugin installs look for `pnpm` on PATH, which a
 * user machine usually does not have.
 * @module @deepseek-ai/dsh/bundled-package-manager
 */

import type { ProfilePnpmInvocation } from '@deepseek-ai/dsh-app-boot'

/**
 * The application-owned pnpm invocation, when the desktop supplied one.
 * @param env - process environment.
 * @param execPath - the running Node (or Electron-as-Node) executable.
 * @returns the invocation, or undefined to keep the PATH `pnpm`.
 */
export function bundledPackageManager(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): ProfilePnpmInvocation | undefined {
  const entry = env.DSH_PNPM_ENTRY
  if (entry === undefined || entry === '') return undefined
  // Same shape as the official desktop host: the packaged Electron runs as
  // Node, and pnpm needs --expose-internals under it.
  return { command: execPath, args: ['--expose-internals', entry], env: { ELECTRON_RUN_AS_NODE: '1' } }
}
