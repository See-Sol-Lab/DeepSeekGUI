/**
 * Streaming-prose display smoothing (B6-P4): the frame scheduler's bounds,
 * its convergence to the authoritative text, and its cleanup. The clock is
 * injected, so every case is deterministic.
 * @module @see-sol-lab/dsh-client-ui-primitives/tests/smooth-text
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SMOOTH_TEXT, SmoothedTextDisplay, type SmoothTextConfig,
} from '../src/markdown/smooth-text.ts'

/** One frame at 60 Hz; the scheduler's rates are expressed per second. */
const FRAME_MS = 16

/** Deterministic clock the cases advance by whole frames. */
function clock(start = 1_000) {
  let value = start
  return {
    now: (): number => value,
    frame: (count = 1): void => { value += FRAME_MS * count },
  }
}

function display(config: Partial<SmoothTextConfig> = {}) {
  const time = clock()
  const instance = new SmoothedTextDisplay({ ...DEFAULT_SMOOTH_TEXT, ...config }, time.now)
  return { instance, time }
}

/** Run frames until the display stops growing, returning every frame's text. */
function frames(
  instance: SmoothedTextDisplay,
  time: { frame: (count?: number) => void },
  input: { key: string; text: string },
  limit = 600,
): string[] {
  const seen: string[] = []
  for (let index = 0; index < limit; index++) {
    const shown = instance.display({ ...input, streaming: true })
    seen.push(shown)
    if (shown === input.text) break
    time.frame()
  }
  return seen
}

describe('SmoothedTextDisplay', () => {
  it('releases a short reply over several frames and lands exactly on the text', () => {
    const { instance, time } = display()
    const seen = frames(instance, time, { key: 'k', text: '你好，世界' })
    expect(seen.at(-1)).toBe('你好，世界')
    expect(seen.length).toBeGreaterThan(1)
    // Every frame is a prefix: no reordering, no duplication, no loss.
    for (const [index, text] of seen.entries()) {
      expect('你好，世界'.startsWith(text)).toBe(true)
      if (index > 0) expect(text.length).toBeGreaterThanOrEqual(seen[index - 1]!.length)
    }
  })

  it('absorbs a large chunk within the reading-pace budget and never exceeds the frame ceiling', () => {
    const { instance, time } = display()
    const text = 'x'.repeat(240)
    const seen = frames(instance, time, { key: 'k', text })
    expect(seen.at(-1)).toBe(text)
    // 240 chars at 220 chars/s ≈ 1.1 s ≈ 68 frames at 60 Hz.
    expect(seen.length).toBeLessThanOrEqual(Math.ceil(240 / (DEFAULT_SMOOTH_TEXT.charsPerSecond * FRAME_MS / 1_000)) + 2)
    for (let index = 1; index < seen.length; index++) {
      expect(seen[index]!.length - seen[index - 1]!.length)
        .toBeLessThanOrEqual(DEFAULT_SMOOTH_TEXT.maxCharsPerFrame + 1)
    }
  })

  it('jumps past the backlog ceiling instead of animating forever', () => {
    const { instance } = display({ maxBacklogChars: 10, maxCharsPerFrame: 1 })
    const text = 'y'.repeat(5_000)
    const first = instance.display({ key: 'k', text, streaming: true })
    // The display is at most the ceiling behind, so a following tool card
    // never waits for thousands of characters.
    expect(text.length - first.length).toBeLessThanOrEqual(10)
    expect(first.length).toBeGreaterThan(0)
  })

  it('tracks small chunks as they arrive without ever lagging more than the ceiling', () => {
    const { instance, time } = display({ maxBacklogChars: 5 })
    let text = ''
    for (const chunk of ['一', '二', '三', '四', '五', '六', '七', '八']) {
      text += chunk
      const shown = instance.display({ key: 'k', text, streaming: true })
      expect(text.startsWith(shown)).toBe(true)
      expect(text.length - shown.length).toBeLessThanOrEqual(5)
      time.frame()
    }
    expect(instance.display({ key: 'k', text, streaming: false })).toBe(text)
  })

  it('never splits a surrogate pair (emoji stay whole)', () => {
    const { instance, time } = display({ maxBacklogChars: 10_000 })
    const text = '👩‍🚀🚀🌕'
    let previous = ''
    for (let index = 0; index < 40; index++) {
      const shown = instance.display({ key: 'k', text, streaming: true })
      // No replacement characters and no lone surrogates in any frame.
      expect(shown.isWellFormed()).toBe(true)
      expect(text.startsWith(shown)).toBe(true)
      expect(shown.length).toBeGreaterThanOrEqual(previous.length)
      previous = shown
      if (shown === text) break
      time.frame()
    }
    expect(previous).toBe(text)
  })

  it('shows unsettled Markdown and code fences as plain prefixes while streaming', () => {
    const { instance, time } = display()
    const text = '# 标题\n\n```ts\nconst a = 1\n'
    const seen = frames(instance, time, { key: 'k', text })
    expect(seen.at(-1)).toBe(text)
    expect(seen.some(frame => frame.includes('```ts'))).toBe(true)
  })

  it('drains immediately when streaming ends (turn end, stop, error)', () => {
    const { instance } = display({ maxCharsPerFrame: 1 })
    const text = 'z'.repeat(400)
    instance.display({ key: 'k', text, streaming: true })
    expect(instance.display({ key: 'k', text, streaming: false })).toBe(text)
    expect(instance.size).toBe(0)
  })

  it('releases one block without touching the others (unmount, Session switch)', () => {
    const { instance } = display()
    instance.display({ key: 'a', text: 'aaaa', streaming: true })
    instance.display({ key: 'b', text: 'bbbb', streaming: true })
    expect(instance.size).toBe(2)
    instance.release('a')
    expect(instance.size).toBe(1)
    expect(instance.display({ key: 'b', text: 'bbbb', streaming: false })).toBe('bbbb')
  })

  it('resets every schedule (plugin dispose, disconnect)', () => {
    const { instance } = display()
    instance.display({ key: 'a', text: 'aaaa', streaming: true })
    instance.display({ key: 'b', text: 'bbbb', streaming: true })
    instance.reset()
    expect(instance.size).toBe(0)
  })

  it('shows a rewritten block whole instead of replaying a different history', () => {
    const { instance } = display()
    instance.display({ key: 'k', text: 'first version', streaming: true })
    expect(instance.display({ key: 'k', text: 'second version', streaming: true })).toBe('second version')
  })

  it('advances at least one character even when two frames share a timestamp', () => {
    const { instance } = display({ maxCharsPerFrame: 4 })
    const text = 'abcde'
    const first = instance.display({ key: 'k', text, streaming: true })
    const second = instance.display({ key: 'k', text, streaming: true })
    expect(second.length).toBeGreaterThan(first.length)
  })

  it('evicts the oldest schedule past the block ceiling', () => {
    const { instance } = display({ maxBlocks: 2 })
    instance.display({ key: 'a', text: 'aa', streaming: true })
    instance.display({ key: 'b', text: 'bb', streaming: true })
    instance.display({ key: 'c', text: 'cc', streaming: true })
    expect(instance.size).toBe(2)
    // 'a' was evicted: its next display restarts from the prefix.
    expect(instance.display({ key: 'a', text: 'aa', streaming: true }).length).toBeLessThanOrEqual(2)
  })

  it('uses the shipped defaults when constructed without a config', () => {
    const instance = new SmoothedTextDisplay()
    expect(instance.display({ key: 'k', text: 'hello', streaming: false })).toBe('hello')
    expect(instance.size).toBe(0)
  })
})
