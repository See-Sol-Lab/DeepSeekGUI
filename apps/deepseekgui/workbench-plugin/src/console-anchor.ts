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
 *
 * Since dsh 0.1.5 the sandbox runner is no longer this process's child: an
 * ordinary spawn goes through the Win32 Job runner first, and that runner —
 * the same GUI-subsystem executable — has no console for the sandbox runner
 * to attach to. So the runner fell back to allocating its own console on
 * every sandboxed call, and on Windows 11 (Windows Terminal as the default
 * host) that allocation shows a window for a moment before the hide lands
 * (2026-09-11 manual test #23). This process therefore publishes its own pid
 * as {@link CONSOLE_ANCHOR_PID_ENV}; the sandbox runner attaches to that
 * console by pid instead of guessing the parent.
 */

/**
 * Environment name carrying the pid of the process whose hidden console the
 * sandbox runner should attach to. Read by `dsh-sandbox-windows-acl/runner`.
 */
export const CONSOLE_ANCHOR_PID_ENV = 'DEEPSEEKGUI_CONSOLE_PID'

/** Outcome of one anchoring attempt (diagnostic only). */
export type ConsoleAnchorOutcome = 'skipped' | 'present' | 'allocated' | 'failed'

/** The three Win32 calls the anchor needs, injectable for tests. */
export interface ConsoleApi {
  getConsoleWindow: () => unknown
  allocConsole: () => number
  showWindow: (window: unknown, command: number) => number
}

const SW_HIDE = 0

/** Publish the console holder's pid for the sandbox runner (a pid of 0 means "unknown": publish nothing). */
function publish(env: Record<string, string | undefined>, pid: number): void {
  if (pid > 0) env[CONSOLE_ANCHOR_PID_ENV] = String(pid)
}

/** The Node process record through the untyped global (client env ambient types narrow `process`). */
function nodeProcess(): { platform?: string; env?: Record<string, string | undefined>; pid?: number } {
  return (globalThis as { process?: { platform?: string; env?: Record<string, string | undefined>; pid?: number } }).process ?? {}
}

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
 * Give this process a hidden console when it has none (Windows only), and
 * publish its pid for the sandbox runner whenever a console exists.
 * @param platform - process platform (injectable for tests).
 * @param api - Win32 bindings (injectable for tests).
 * @param env - environment to publish the pid into (injectable for tests).
 * @param pid - this process's id (injectable for tests).
 * @returns what happened; never throws.
 */
export async function anchorHiddenConsole(
  platform: string = nodeProcess().platform ?? '',
  api?: ConsoleApi,
  env: Record<string, string | undefined> = nodeProcess().env ?? {},
  pid: number = nodeProcess().pid ?? 0,
): Promise<ConsoleAnchorOutcome> {
  if (platform !== 'win32') return 'skipped'
  try {
    const win32 = api ?? await loadConsoleApi()
    if (!isNull(win32.getConsoleWindow())) {
      publish(env, pid)
      return 'present'
    }
    if (win32.allocConsole() === 0) return 'failed'
    const window = win32.getConsoleWindow()
    if (!isNull(window)) win32.showWindow(window, SW_HIDE)
    publish(env, pid)
    return 'allocated'
  } catch {
    return 'failed'
  }
}
