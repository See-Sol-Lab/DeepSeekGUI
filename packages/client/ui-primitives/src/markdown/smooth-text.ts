/**
 * Frame-driven display smoothing for streaming assistant prose (B6-P4).
 *
 * The session log, the projection, and every non-text event keep their exact
 * arrival order; this class only decides how much of an already-received text
 * block the browser paints on the current frame. Each block's display is
 * always a prefix of the authoritative text, so the settled projection is
 * byte-identical to what the model produced.
 *
 * Streaming display follows the configured character pace and backlog cap.
 * Settled text is authoritative immediately.
 */

/** Display budget for streaming assistant prose; pure presentation constants. */
export interface SmoothTextConfig {
  /** Characters released per second at the comfortable reading pace. */
  readonly charsPerSecond: number
  /** Hard per-frame ceiling (high-refresh displays). */
  readonly maxCharsPerFrame: number
  /** Backlog beyond which the display jumps forward instead of catching up. */
  readonly maxBacklogChars: number
  /** Blocks tracked at once; the oldest schedule is dropped first. */
  readonly maxBlocks: number
}

/** Default budget: ~220 chars/s, at most 24 chars per frame, 600-char ceiling. */
export const DEFAULT_SMOOTH_TEXT: SmoothTextConfig = {
  charsPerSecond: 220,
  maxCharsPerFrame: 24,
  maxBacklogChars: 600,
  maxBlocks: 8,
}

/** One text block's authoritative state for this frame. */
export interface SmoothTextInput {
  /** Stable identity of the block (session + turn + step + block index). */
  readonly key: string
  /** The authoritative text received so far. */
  readonly text: string
  /** False once the turn settled, stopped, errored, or lost its connection. */
  readonly streaming: boolean
}

interface BlockSchedule {
  /** Characters currently displayable (always a prefix of `target`). */
  shown: number
  /** The authoritative text this schedule was last advanced against. */
  target: string
  /** Timestamp of the previous advance. */
  lastMs: number
  /** Unspent release budget carried across frames, so the pace stays exact. */
  credit: number
}

/** UTF-16 high surrogate (first half of a non-BMP character). */
function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

/** UTF-16 low surrogate (second half of a non-BMP character). */
function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF
}

/**
 * Page-level smoother: one instance serves every streaming assistant text
 * block. Call {@link display} once per frame per block; the returned string is
 * the prefix to paint.
 */
export class SmoothedTextDisplay {
  private readonly schedules = new Map<string, BlockSchedule>()

  /**
   * @param config - display budget; defaults to {@link DEFAULT_SMOOTH_TEXT}.
   * @param now - clock injection for deterministic tests; defaults to `performance.now`.
   */
  constructor(
    private readonly config: SmoothTextConfig = DEFAULT_SMOOTH_TEXT,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Blocks currently tracked (bounded by `config.maxBlocks`). */
  get size(): number {
    return this.schedules.size
  }

  /**
   * Advance one block's schedule and return the text to display now.
   * @param input - block identity, authoritative text, and streaming state.
   * @returns the prefix of `input.text` the browser should paint this frame.
   */
  display(input: SmoothTextInput): string {
    const { key, text, streaming } = input
    // Settled text is authoritative at once: no animation may outlive the
    // turn it belongs to (turn end, stop, error, reconnect).
    if (!streaming) {
      this.schedules.delete(key)
      return text
    }
    const nowMs = this.now()
    let schedule = this.schedules.get(key)
    if (schedule !== undefined && !text.startsWith(schedule.target)) {
      // The authority replaced this block's text (edit or regeneration):
      // show the new text whole rather than replaying a different history.
      this.schedules.set(key, { shown: text.length, target: text, lastMs: nowMs, credit: 0 })
      return text
    }
    if (schedule === undefined) {
      schedule = { shown: 0, target: text, lastMs: nowMs, credit: 0 }
      this.track(key, schedule)
    }
    schedule.target = text
    const elapsed = Math.max(0, nowMs - schedule.lastMs)
    schedule.lastMs = nowMs
    const backlog = text.length - schedule.shown
    if (backlog <= 0) return text
    const { charsPerSecond, maxCharsPerFrame, maxBacklogChars } = this.config
    // Reading pace, capped per frame so a high-refresh display cannot outrun
    // it; at least one character per call keeps progress monotone. Unspent
    // budget carries over, so the average rate does not lose a fraction each
    // frame and a long reply still lands on a predictable schedule.
    schedule.credit = Math.min(maxBacklogChars, schedule.credit + (charsPerSecond / 1_000) * elapsed)
    const released = Math.max(1, Math.min(maxCharsPerFrame, Math.floor(schedule.credit)))
    schedule.credit = Math.max(0, schedule.credit - released)
    schedule.shown = Math.min(text.length, schedule.shown + released)
    // Jump forward past the ceiling: the following tool card must not wait.
    if (text.length - schedule.shown > maxBacklogChars) {
      schedule.shown = text.length - maxBacklogChars
    }
    // Never split a surrogate pair: reveal the whole character this frame
    // (stepping back would stall the schedule forever on emoji-led text).
    if (schedule.shown > 0 && schedule.shown < text.length
      && isHighSurrogate(text.charCodeAt(schedule.shown - 1))
      && isLowSurrogate(text.charCodeAt(schedule.shown))) {
      schedule.shown += 1
    }
    return text.slice(0, schedule.shown)
  }

  /**
   * Drop one block's schedule (component unmount, Session switch).
   * @param key - the block identity passed to {@link display}.
   */
  release(key: string): void {
    this.schedules.delete(key)
  }

  /** Drop every schedule (plugin dispose, disconnect). */
  reset(): void {
    this.schedules.clear()
  }

  /** Insert with oldest-first eviction so a leak cannot grow without bound. */
  private track(key: string, schedule: BlockSchedule): void {
    this.schedules.set(key, schedule)
    while (this.schedules.size > this.config.maxBlocks) {
      const oldest = this.schedules.keys().next()
      if (oldest.done === true) return
      this.schedules.delete(oldest.value)
    }
  }
}
