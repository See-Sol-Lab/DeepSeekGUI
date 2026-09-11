import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatTextDisplayInput, ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import { useSearchableHidden } from './searchable-hidden.ts'
import css from './AssistantMarkdown.module.css'

/**
 * Map one authored media destination to the same-origin workspace-file URL.
 * @param protocol - `window.location.protocol` at render time.
 * @param origin - `window.location.origin` at render time.
 * @param value - The authored markdown destination, exactly as written.
 * @returns The API URL for an absolute POSIX path on an HTTP(S) page, or
 * undefined when the destination cannot be a Host-served local file
 * (non-HTTP transport such as Electron `file://`, protocol-relative or
 * relative destinations).
 */
export function localPathMediaUrl(protocol: string, origin: string, value: string): string | undefined {
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  if (value.length === 0 || !value.startsWith('/') || value.startsWith('//')) return undefined
  return `${origin}/api/file?path=${encodeURIComponent(value)}`
}

export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Hide reasoning that belongs to the Turn-level process disclosure. */
  reasoningHidden?: boolean | undefined
  /** Reveal the owning Turn-level process disclosure. */
  revealProcess?: (() => void) | undefined
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** Stable identity prefix for one block's smoothing schedule (B6-P4). */
  displayKeyPrefix?: string | undefined
  /** Optional prose display smoother; absent paints the authoritative text. */
  displayText?: ((input: ChatTextDisplayInput) => string) | undefined
  /** Drop one block's smoothing schedule on unmount. */
  releaseText?: ((key: string) => void) | undefined
  /** Whether a smoother is composed; drives the per-frame tick. */
  textDisplayActive?: (() => boolean) | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Re-render once per animation frame while a smoother has text left to reveal.
 *
 * The tick is component-local: it subscribes to nothing external, it only
 * advances the smoother's clock by asking React to paint again. It keeps the
 * frame loop running for as long as the block streams, but only asks for a
 * paint while `behind` says the displayed prefix is still short of the
 * authoritative text. A model that is thinking sends no text for seconds at a
 * time, and repainting identical content through that gap is pure cost; new
 * text arrives as a prop change, which repaints on its own and sets `behind`
 * again.
 * @param active - true while a streaming block is being smoothed.
 * @param behind - reads whether the last paint was still catching up.
 */
function useFrameTick(active: boolean, behind: { readonly current: boolean }): void {
  const [, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    let handle = 0
    const tick = (): void => {
      if (behind.current) setFrame(frame => frame + 1)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(handle) }
  }, [active, behind])
}

/** Reasoning block as the Think variant summary row (figma 39:28304). */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages,
  reasoningHidden = false, revealProcess, mentions, t,
  displayKeyPrefix = '', displayText, releaseText, textDisplayActive,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  // Local media paths in the closing prose rewrite to the same-origin file
  // API (policy re-validation lives host-side). The vocabulary identity is
  // stable per page load because MarkdownText memoizes on it.
  const pathImages = useMemo<MarkdownPathImages>(() => {
    const { protocol, origin } = window.location
    return { resolve: value => localPathMediaUrl(protocol, origin, value) }
  }, [])
  // B6-P4: only assistant prose is scheduled. Reasoning, images, tool rows,
  // approvals, errors, and user messages keep their exact arrival order, and
  // settled text (turn end, stop, error, reconnect) is authoritative at once.
  const smoothing = streaming && displayText !== undefined && textDisplayActive?.() === true
  // Written during the paint below, read by the next frame's tick: true while
  // any block's displayed prefix is still short of its authoritative text.
  const behind = useRef(false)
  useFrameTick(smoothing, behind)
  const displayKeys = useRef<readonly string[]>([])
  const releaseAll = useMemo(() => (): void => {
    for (const key of displayKeys.current) releaseText?.(key)
  }, [releaseText])
  useEffect(() => releaseAll, [releaseAll])
  const last = blocks.length - 1
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  const keys: string[] = []
  let catchingUp = false
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text': {
        const key = `${displayKeyPrefix}${String(i)}`
        keys.push(key)
        // Every frame is a prefix of the authoritative text; once the block
        // settles the smoother returns it whole, so the final paint is exact.
        const shown = smoothing ? displayText({ key, text: block.text, streaming }) : block.text
        if (shown !== block.text) catchingUp = true
        rendered.push(
          <MarkdownText
            key={i}
            text={shown}
            streaming={streaming}
            labels={labels}
            fileMentions={mentions}
            pathImages={pathImages}
          />,
        )
        break
      }
      case 'reasoning':
        rendered.push(
          <ProcessReasoning
            key={i}
            hidden={reasoningHidden}
            reveal={revealProcess}
          >
            <ReasoningRow text={block.text} running={streaming && i === last} t={t} />
          </ProcessReasoning>,
        )
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  displayKeys.current = keys
  behind.current = catchingUp
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})

function ProcessReasoning({ hidden, reveal, children }: {
  hidden: boolean
  reveal?: (() => void) | undefined
  children: ReactNode
}) {
  const ref = useSearchableHidden(hidden, reveal ?? NOOP)
  return <div ref={ref} data-turn-process-inline={hidden || undefined}>{children}</div>
}

const NOOP = (): void => {}
