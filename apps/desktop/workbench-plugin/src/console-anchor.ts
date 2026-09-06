/**
 * Hidden console anchor for the Harness process on Windows (D21, 2026-09-06).
 *
 * The official Windows sandbox starts tool children (pwsh) under a restricted
 * token and must let them share the host console — CREATE_NO_WINDOW is not
 * available there (the child dies with STATUS_DLL_INIT_FAILED). DeepSeekGUI
 * runs the Harness inside its Electron executable, a GUI-subsystem process
 * with no console at all, so every tool child got a fresh, visible console
 * window that stole focus (the acceptance found typed text landing in it).
 *
 * The fix is the one the desktop-only DSH hosts converged on: allocate one
 * console for this process at startup and hide its window. Children inherit
 * it and never open their own. Nothing is installed or persisted; the
 * console dies with the process. A process that already has a console (a
 * developer terminal) is left alone.
 */

/** Outcome of one anchoring attempt (diagnostic only). */
export type ConsoleAnchorOutcome = 'skipped' | 'present' | 'allocated' | 'failed'

/** The three Win32 calls the anchor needs, injectable for tests. */
export interface ConsoleApi {
  getConsoleWindow: () => unknown
  allocConsole: () => number
  showWindow: (window: unknown, command: number) => number
}

const SW_HIDE = 0

/** Whether a koffi pointer / handle is null. */
function isNull(value: unknown): boolean {
  return value === null || value === undefined || value === 0 || value === 0n
}

/** Load the Win32 bindings through koffi (the same FFI the official sandbox uses). */
async function loadConsoleApi(): Promise<ConsoleApi> {
  const { default: koffi } = await import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const user32 = koffi.load('user32.dll')
  return {
    getConsoleWindow: kernel32.func('GetConsoleWindow', 'void *', []) as () => unknown,
    allocConsole: kernel32.func('AllocConsole', 'int', []) as () => number,
    showWindow: user32.func('ShowWindow', 'int', ['void *', 'int']) as (window: unknown, command: number) => number,
  }
}

/**
 * Give this process a hidden console when it has none (Windows only).
 * @param platform - process platform (injectable for tests).
 * @param api - Win32 bindings (injectable for tests).
 * @returns what happened; never throws.
 */
export async function anchorHiddenConsole(
  platform: string = (globalThis as { process?: { platform?: string } }).process?.platform ?? '',
  api?: ConsoleApi,
): Promise<ConsoleAnchorOutcome> {
  if (platform !== 'win32') return 'skipped'
  try {
    const win32 = api ?? await loadConsoleApi()
    if (!isNull(win32.getConsoleWindow())) return 'present'
    if (win32.allocConsole() === 0) return 'failed'
    const window = win32.getConsoleWindow()
    if (!isNull(window)) win32.showWindow(window, SW_HIDE)
    return 'allocated'
  } catch {
    return 'failed'
  }
}
