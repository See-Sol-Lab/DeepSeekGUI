/**
 * Hidden console anchor (D21): allocates and hides a console only on
 * Windows and only when the process has none; never throws.
 * @module @see-sol-lab/deepseekgui-workbench/tests/console-anchor
 */
import { describe, expect, it, vi } from 'vitest'
import { anchorHiddenConsole, CONSOLE_ANCHOR_PID_ENV, type ConsoleApi } from '../src/console-anchor.ts'

function api(over: Partial<ConsoleApi> = {}): ConsoleApi {
  return {
    getConsoleWindow: vi.fn(() => null),
    allocConsole: vi.fn(() => 1),
    showWindow: vi.fn(() => 1),
    ...over,
  }
}

describe('anchorHiddenConsole', () => {
  it('does nothing off Windows', async () => {
    const win32 = api()
    const env: Record<string, string | undefined> = {}
    expect(await anchorHiddenConsole('linux', win32, env, 7)).toBe('skipped')
    expect(win32.allocConsole).not.toHaveBeenCalled()
    expect(env).toEqual({})
  })

  it('leaves an existing console alone (developer terminal) but still publishes its pid', async () => {
    const win32 = api({ getConsoleWindow: vi.fn(() => 0x1234) })
    const env: Record<string, string | undefined> = {}
    expect(await anchorHiddenConsole('win32', win32, env, 7)).toBe('present')
    expect(win32.allocConsole).not.toHaveBeenCalled()
    expect(env[CONSOLE_ANCHOR_PID_ENV]).toBe('7')
  })

  it('allocates a console, hides its window, and publishes the pid for the sandbox runner (#23)', async () => {
    const handles = [null, 0x5678]
    const win32 = api({ getConsoleWindow: vi.fn(() => handles.shift() ?? null) })
    const env: Record<string, string | undefined> = {}
    expect(await anchorHiddenConsole('win32', win32, env, 4242)).toBe('allocated')
    expect(win32.allocConsole).toHaveBeenCalledOnce()
    expect(win32.showWindow).toHaveBeenCalledWith(0x5678, 0)
    expect(env[CONSOLE_ANCHOR_PID_ENV]).toBe('4242')
  })

  it('reports failure instead of throwing, and publishes nothing then', async () => {
    const env: Record<string, string | undefined> = {}
    expect(await anchorHiddenConsole('win32', api({ allocConsole: vi.fn(() => 0) }), env, 7)).toBe('failed')
    expect(await anchorHiddenConsole('win32', api({ getConsoleWindow: vi.fn(() => { throw new Error('boom') }) }), env, 7)).toBe('failed')
    expect(env).toEqual({})
  })
})
