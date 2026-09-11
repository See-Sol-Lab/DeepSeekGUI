/**
 * Console anchoring for the runner (DeepSeekGUI adaptation, D21 2026-09-06).
 *
 * The confined child must share the runner's console (CREATE_NO_WINDOW and
 * CREATE_NEW_CONSOLE children die under the restriction). When the runner is
 * hosted by a GUI-subsystem executable — the desktop's Electron binary
 * running as Node — it starts with NO console, so the child would open a
 * fresh, visible window and steal focus. The anchor gives the runner one
 * the child can inherit silently: the console of the process named by
 * {@link CONSOLE_ANCHOR_PID_ENV} when the host published one (the desktop
 * Harness keeps a hidden one), else the parent's console when it has one,
 * else a fresh console hidden at once. A runner that already has a console
 * (a terminal) is left alone. The runner treats the outcome as diagnostic
 * only: anchoring never blocks confinement.
 *
 * The pid step exists because since dsh 0.1.5 the runner's parent is the
 * Win32 Job runner, not the Harness: a GUI-subsystem process with no console,
 * so the parent attach always failed and every sandboxed call allocated a
 * console of its own — which, with Windows Terminal as the default host,
 * shows a window for a moment before the hide lands (2026-09-11 manual test
 * #23). Attaching by pid reaches past the Job runner to the Harness.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/console-anchor
 */

import type { NativePtr } from '@deepseek-ai/dsh-win32-process'

/** `AttachConsole` sentinel: the parent process's console. */
export const ATTACH_PARENT_PROCESS = 0xFFFF_FFFF
/** Environment name carrying the pid whose console the runner attaches to first (published by the DeepSeekGUI Harness). */
export const CONSOLE_ANCHOR_PID_ENV = 'DEEPSEEKGUI_CONSOLE_PID'

/**
 * Read the published anchor pid, if any.
 * @param env - process environment.
 * @returns a positive integer pid, or undefined when absent or malformed.
 */
export function consoleAnchorPid(env: Record<string, string | undefined>): number | undefined {
  const raw = env[CONSOLE_ANCHOR_PID_ENV]
  if (raw === undefined || !/^\d{1,10}$/u.test(raw)) return undefined
  const pid = Number(raw)
  return pid > 0 ? pid : undefined
}
/** `ShowWindow` command that hides the window. */
export const SW_HIDE = 0

/** The four Win32 calls the anchor needs. */
export interface ConsoleAnchorApi {
  getConsoleWindow: () => NativePtr | null
  attachConsole: (processId: number) => number
  allocConsole: () => number
  showWindow: (window: NativePtr, command: number) => number
}

/** What one anchoring attempt did. */
export type ConsoleAnchorOutcome = 'present' | 'attached' | 'allocated' | 'failed'

/**
 * Whether a koffi pointer / handle is null.
 * @param value - pointer value from a binding.
 * @returns true for null/zero.
 */
function isNull(value: unknown): boolean {
  return value === null || value === undefined || value === 0 || value === 0n
}

/**
 * Give this process a console the confined child can share without opening
 * a visible window.
 * @param api - active binding table.
 * @param anchorPid - pid of a process holding a hidden console to attach to first.
 * @returns what happened (diagnostic only); never throws.
 */
export function anchorConsole(api: ConsoleAnchorApi, anchorPid?: number): ConsoleAnchorOutcome {
  try {
    if (!isNull(api.getConsoleWindow())) return 'present'
    if (anchorPid !== undefined && api.attachConsole(anchorPid) !== 0) return 'attached'
    if (api.attachConsole(ATTACH_PARENT_PROCESS) !== 0) return 'attached'
    if (api.allocConsole() === 0) return 'failed'
    const window = api.getConsoleWindow()
    if (!isNull(window) && window !== null) api.showWindow(window, SW_HIDE)
    return 'allocated'
  } catch {
    return 'failed'
  }
}
