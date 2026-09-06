// @vitest-environment jsdom
/**
 * Clickable paths (D6): which code spans qualify, and that a click sends the
 * reveal command for the session being viewed while the desktop keeps the
 * containment decision.
 * @module @see-sol-lab/deepseekgui-workbench/tests/paths
 */
import { describe, expect, it, vi } from 'vitest'
import { installPathClicks, looksLikePath } from '../src/client/paths.ts'
import type { ControlBridgeClient } from '../src/client/bridge.ts'

describe('looksLikePath', () => {
  it.each([
    'src/a.ts', 'apps\\desktop\\main.ts', 'README.md', './notes.txt', 'E:\\验收练手 仓库\\README.md', 'memory.md',
  ])('accepts %s', (text) => { expect(looksLikePath(text)).toBe(true) })

  it.each([
    'https://example.com/a', 'git status', 'npm run build --watch', '--profile web', '$env:PATH', 'x', 'a | b', 'not a path', 'a\nb',
  ])('rejects %s', (text) => { expect(looksLikePath(text)).toBe(false) })
})

describe('installPathClicks', () => {
  it('reveals a path-like code span for the current session and ignores code blocks and prose', () => {
    document.body.innerHTML = '<p>see <code>src/a.ts</code> and <code>git status</code></p><pre><code>src/b.ts</code></pre>'
    const bridge: ControlBridgeClient = { model: vi.fn(), run: vi.fn(async () => ({} as never)) }
    const dispose = installPathClicks(bridge, () => 's1', '定位')
    const [path, command, block] = [...document.querySelectorAll('code')]
    path?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(path?.title).toBe('定位')
    expect(path?.style.cursor).toBe('pointer')
    path?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    command?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    block?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(bridge.run).toHaveBeenCalledTimes(1)
    expect(bridge.run).toHaveBeenCalledWith({ type: 'reveal-path', sessionId: 's1', path: 'src/a.ts' })
    dispose()
    path?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(bridge.run).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a current session', () => {
    document.body.innerHTML = '<code>src/a.ts</code>'
    const bridge: ControlBridgeClient = { model: vi.fn(), run: vi.fn(async () => ({} as never)) }
    const dispose = installPathClicks(bridge, () => undefined, '定位')
    document.querySelector('code')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(bridge.run).not.toHaveBeenCalled()
    dispose()
  })
})
