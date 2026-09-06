/**
 * Hidden console anchor (D21): allocates and hides a console only on
 * Windows and only when the process has none; never throws.
 * @module @see-sol-lab/deepseekgui-workbench/tests/console-anchor
 */
import { describe, expect, it, vi } from 'vitest'
import { anchorHiddenConsole, type ConsoleApi } from '../src/console-anchor.ts'

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
    expect(await anchorHiddenConsole('linux', win32)).toBe('skipped')
    expect(win32.allocConsole).not.toHaveBeenCalled()
  })

  it('leaves an existing console alone (developer terminal)', async () => {
    const win32 = api({ getConsoleWindow: vi.fn(() => 0x1234) })
    expect(await anchorHiddenConsole('win32', win32)).toBe('present')
    expect(win32.allocConsole).not.toHaveBeenCalled()
  })

  it('allocates a console and hides its window when there is none', async () => {
    const handles = [null, 0x5678]
    const win32 = api({ getConsoleWindow: vi.fn(() => handles.shift() ?? null) })
    expect(await anchorHiddenConsole('win32', win32)).toBe('allocated')
    expect(win32.allocConsole).toHaveBeenCalledOnce()
    expect(win32.showWindow).toHaveBeenCalledWith(0x5678, 0)
  })

  it('reports failure instead of throwing', async () => {
    expect(await anchorHiddenConsole('win32', api({ allocConsole: vi.fn(() => 0) }))).toBe('failed')
    expect(await anchorHiddenConsole('win32', api({ getConsoleWindow: vi.fn(() => { throw new Error('boom') }) }))).toBe('failed')
  })
})
