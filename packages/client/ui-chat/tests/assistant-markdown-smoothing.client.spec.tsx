// @vitest-environment jsdom
/**
 * Streaming-prose smoothing at the renderer (B6-P4): only text blocks are
 * scheduled, the settled paint equals the authoritative text, the frame tick
 * drives the smoother, and unmount releases every block schedule.
 * @module @deepseek-ai/dsh-client-ui-chat/tests/assistant-markdown-smoothing
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import type { ChatTextDisplayInput } from '../src/client/contract/slots.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

/** A smoother that releases one more character on every frame. */
function stepSmoother() {
  let released = 0
  return vi.fn((input: ChatTextDisplayInput): string => {
    released += 1
    return input.text.slice(0, Math.min(input.text.length, released))
  })
}

describe('AssistantMarkdown streaming display', () => {
  it('smooths the text block per frame and lands exactly on the authoritative text', async () => {
    vi.useFakeTimers()
    const displayText = stepSmoother()
    const releaseText = vi.fn()
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '你好世界' }]}
        streaming
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="n1:"
        displayText={displayText}
        releaseText={releaseText}
        textDisplayActive={() => true}
      />,
    )
    expect(displayText).toHaveBeenCalledWith({ key: 'n1:0', text: '你好世界', streaming: true })
    expect(view.container.textContent).toBe('你')
    // First paint released one character; two more frames release two more.
    await vi.advanceTimersByTimeAsync(16 * 2)
    expect(view.container.textContent).toBe('你好世')

    // Settled: the authoritative text paints whole and the smoother is idle.
    const calls = displayText.mock.calls.length
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '你好世界' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="n1:"
        displayText={displayText}
        releaseText={releaseText}
        textDisplayActive={() => true}
      />,
    )
    expect(view.container.textContent).toBe('你好世界')
    expect(displayText.mock.calls.length).toBe(calls)
    view.unmount()
    expect(releaseText).toHaveBeenCalledWith('n1:0')
  })

  it('leaves reasoning immediate and starts no tick without a smoother', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame')
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: '思考中' }, { kind: 'text', text: '正文' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('思考中')).toBeTruthy()
    expect(view.container.textContent).toContain('正文')
    expect(raf).not.toHaveBeenCalled()
    raf.mockRestore()
  })

  it('drives the smoother once per frame while it is still catching up', async () => {
    vi.useFakeTimers()
    // A smoother that reveals one character per call stays behind the
    // authoritative text, which is exactly when the frame loop must keep going.
    let revealed = 0
    const displayText = vi.fn((input: ChatTextDisplayInput): string => {
      revealed = Math.min(revealed + 1, input.text.length)
      return input.text.slice(0, revealed)
    })
    render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'streaming prose' }]}
        streaming
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="n2:"
        displayText={displayText}
        textDisplayActive={() => true}
      />,
    )
    const initial = displayText.mock.calls.length
    await vi.advanceTimersByTimeAsync(16 * 5)
    expect(displayText.mock.calls.length).toBeGreaterThan(initial + 3)
  })

  it('stops asking for frames once the display has caught up', async () => {
    vi.useFakeTimers()
    // A model that is thinking sends no text for seconds at a time, so the
    // smoother returns the authoritative text unchanged. Repainting identical
    // content every frame through that gap is pure cost; the next chunk arrives
    // as a prop change, which repaints on its own.
    const displayText = vi.fn((input: ChatTextDisplayInput): string => input.text)
    render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'settled prose' }]}
        streaming
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="n3:"
        displayText={displayText}
        textDisplayActive={() => true}
      />,
    )
    const initial = displayText.mock.calls.length
    await vi.advanceTimersByTimeAsync(16 * 5)
    expect(displayText.mock.calls.length).toBe(initial)
  })

  it('scopes block keys by the node prefix so two rows never share a schedule', () => {
    const displayText = vi.fn((input: ChatTextDisplayInput): string => input.text)
    const first = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'a' }]}
        streaming
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="row-a:"
        displayText={displayText}
        textDisplayActive={() => true}
      />,
    )
    expect(displayText).toHaveBeenCalledWith({ key: 'row-a:0', text: 'a', streaming: true })
    first.unmount()
    const second = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'b' }]}
        streaming
        renderMessageImages={renderMessageImages}
        displayKeyPrefix="row-b:"
        displayText={displayText}
        textDisplayActive={() => true}
      />,
    )
    expect(displayText).toHaveBeenCalledWith({ key: 'row-b:0', text: 'b', streaming: true })
    second.unmount()
  })
})
