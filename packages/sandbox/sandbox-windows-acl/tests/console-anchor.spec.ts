/** Runner console anchoring: present → untouched; parent attach first; else allocate and hide. */
import { describe, expect, it, vi } from 'vitest'
import { ATTACH_PARENT_PROCESS, SW_HIDE, anchorConsole, type ConsoleAnchorApi } from '../src/console-anchor.ts'

function api(over: Partial<ConsoleAnchorApi> = {}): ConsoleAnchorApi {
  return {
    getConsoleWindow: vi.fn(() => null),
    attachConsole: vi.fn(() => 0),
    allocConsole: vi.fn(() => 1),
    showWindow: vi.fn(() => 1),
    ...over,
  }
}

describe('anchorConsole', () => {
  it('leaves an existing console alone', () => {
    const win32 = api({ getConsoleWindow: vi.fn(() => 42 as never) })
    expect(anchorConsole(win32)).toBe('present')
    expect(win32.attachConsole).not.toHaveBeenCalled()
    expect(win32.allocConsole).not.toHaveBeenCalled()
  })

  it('attaches to the parent console before allocating one', () => {
    const win32 = api({ attachConsole: vi.fn(() => 1) })
    expect(anchorConsole(win32)).toBe('attached')
    expect(win32.attachConsole).toHaveBeenCalledWith(ATTACH_PARENT_PROCESS)
    expect(win32.allocConsole).not.toHaveBeenCalled()
  })

  it('allocates and hides when the parent has no console', () => {
    const handles = [null, 7 as never]
    const win32 = api({ getConsoleWindow: vi.fn(() => handles.shift() ?? null) })
    expect(anchorConsole(win32)).toBe('allocated')
    expect(win32.showWindow).toHaveBeenCalledWith(7, SW_HIDE)
  })

  it('reports failure without throwing', () => {
    expect(anchorConsole(api({ allocConsole: vi.fn(() => 0) }))).toBe('failed')
    expect(anchorConsole(api({ getConsoleWindow: vi.fn(() => { throw new Error('boom') }) }))).toBe('failed')
  })
})
