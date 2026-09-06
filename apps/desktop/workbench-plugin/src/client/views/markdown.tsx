/**
 * A small Markdown reader for the Memory view (D20, 2026-09-06): headings,
 * bullet / numbered lists, fenced code, paragraphs, and inline code / bold.
 * The file is shown as written — nothing is reordered, grouped, or
 * rewritten — only rendered so a person can read it instead of raw source.
 * Deliberately not the official chat renderer: that one needs the chat's
 * label bundle and streaming plumbing, which a static file does not have.
 */
import type { ReactNode } from 'react'

const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--ds-font-family-code)', fontSize: '0.92em',
  padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-markdown-code-inline, rgba(0,0,0,0.06))',
  overflowWrap: 'anywhere',
}
const blockStyle: React.CSSProperties = {
  fontFamily: 'var(--ds-font-family-code)', fontSize: 13, lineHeight: '20px', margin: '4px 0',
  padding: '8px 12px', borderRadius: 8, background: 'var(--dsw-alias-markdown-code-block, rgba(0,0,0,0.05))',
  whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
}
const headingSize: Record<number, number> = { 1: 18, 2: 16, 3: 15, 4: 14, 5: 14, 6: 14 }

/** Inline `code` and **bold**; everything else is plain text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/gu
  let last = 0
  let key = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const token = match[0]
    if (token.startsWith('`')) out.push(<code key={key++} style={codeStyle}>{token.slice(1, -1)}</code>)
    else out.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    last = index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'paragraph'; text: string }

/** Split Markdown source into the blocks the reader knows. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') { index += 1; continue }
    if (line.startsWith('```')) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) { code.push(lines[index] ?? ''); index += 1 }
      index += 1
      // An unterminated fence runs to the end of the file; drop the file's trailing newline.
      while (code.length > 0 && code[code.length - 1] === '') code.pop()
      blocks.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line)
    if (heading !== null) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: (heading[2] ?? '').replace(/\s+#+$/u, '') })
      index += 1
      continue
    }
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/u
    if (bullet.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/u.test(line)
      const items: string[] = []
      while (index < lines.length && bullet.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(bullet, ''))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (current.trim() === '' || current.startsWith('```') || /^#{1,6}\s/u.test(current) || bullet.test(current)) break
      paragraph.push(current.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }
  return blocks
}

/** Render Markdown source as React nodes. */
export function MarkdownReader({ source }: { source: string }) {
  const blocks = parseBlocks(source)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <div key={index} role="heading" aria-level={block.level} style={{ fontSize: headingSize[block.level] ?? 14, lineHeight: '24px', fontWeight: 600, marginTop: index === 0 ? 0 : 6 }}>
              {renderInline(block.text)}
            </div>
          )
        }
        if (block.kind === 'code') return <pre key={index} style={blockStyle}>{block.text}</pre>
        if (block.kind === 'list') {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex} style={{ margin: '2px 0' }}>{renderInline(item)}</li>)
          const listStyle: React.CSSProperties = { margin: 0, paddingLeft: 22 }
          return block.ordered ? <ol key={index} style={listStyle}>{items}</ol> : <ul key={index} style={listStyle}>{items}</ul>
        }
        return <p key={index} style={{ margin: 0, overflowWrap: 'anywhere' }}>{renderInline(block.text)}</p>
      })}
    </div>
  )
}
