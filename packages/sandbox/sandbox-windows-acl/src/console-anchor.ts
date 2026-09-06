/**
 * Console anchoring for the runner (DeepSeekGUI adaptation, D21 2026-09-06).
 *
 * The confined child must share the runner's console (CREATE_NO_WINDOW and
 * CREATE_NEW_CONSOLE children die under the restriction). When the runner is
 * hosted by a GUI-subsystem executable — the desktop's Electron binary
 * running as Node — it starts with NO console, so the child would open a
 * fresh, visible window and steal focus. The anchor gives the runner one
 * the child can inherit silently: the parent's console when it has one (the
 * desktop Harness keeps a hidden one), else a fresh console hidden at once.
 * A runner that already has a console (a terminal) is left alone. The
 * runner treats the outcome as diagnostic only: anchoring never blocks
 * confinement.
 * @module @deepseek-ai/dsh-sandbox-windows-acl/console-anchor
 */

import type { NativePtr } from '@deepseek-ai/dsh-win32-process'

/** `AttachConsole` sentinel: the parent process's console. */
export const ATTACH_PARENT_PROCESS = 0xFFFF_FFFF
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
 * @returns what happened (diagnostic only); never throws.
 */
export function anchorConsole(api: ConsoleAnchorApi): ConsoleAnchorOutcome {
  try {
    if (!isNull(api.getConsoleWindow())) return 'present'
    if (api.attachConsole(ATTACH_PARENT_PROCESS) !== 0) return 'attached'
    if (api.allocConsole() === 0) return 'failed'
    const window = api.getConsoleWindow()
    if (!isNull(window) && window !== null) api.showWindow(window, SW_HIDE)
    return 'allocated'
  } catch {
    return 'failed'
  }
}
