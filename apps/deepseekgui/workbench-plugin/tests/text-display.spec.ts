/**
 * DeepSeekGUI prose-display service (B6-P4): the Workbench composes the
 * smoother the official chat view resolves per frame, and disposing it drops
 * every schedule.
 * @module @see-sol-lab/deepseekgui-workbench/tests/text-display
 */
import { describe, expect, it, vi } from 'vitest'
import { CHAT_TEXT_DISPLAY_SERVICE, installTextDisplay } from '../src/client/text-display.ts'
import type { ChatTextDisplay } from '@deepseek-ai/dsh-client-ui-chat/client'

describe('installTextDisplay', () => {
  it('provides the smoother under the chat view service name', () => {
    const provide = vi.fn()
    const dispose = installTextDisplay({ provide })
    expect(provide).toHaveBeenCalledTimes(1)
    const [name, service] = provide.mock.calls[0] as [string, ChatTextDisplay]
    expect(name).toBe(CHAT_TEXT_DISPLAY_SERVICE)
    expect(typeof service.display).toBe('function')
    expect(typeof service.release).toBe('function')
    dispose()
  })

  it('smooths a streaming block and drains it when streaming ends', () => {
    const provide = vi.fn()
    const dispose = installTextDisplay({ provide })
    const service = (provide.mock.calls[0] as [string, ChatTextDisplay])[1]
    const text = 'x'.repeat(500)
    const first = service.display({ key: 'k', text, streaming: true })
    // The backlog ceiling keeps a following tool card from waiting.
    expect(text.length - first.length).toBeLessThanOrEqual(600)
    expect(first.length).toBeGreaterThan(0)
    expect(service.display({ key: 'k', text, streaming: false })).toBe(text)
    service.release('k')
    dispose()
  })
})
