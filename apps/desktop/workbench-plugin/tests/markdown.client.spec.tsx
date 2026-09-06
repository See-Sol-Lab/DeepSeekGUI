// @vitest-environment jsdom
/** The Memory view's Markdown reader (D20): blocks and inline marks, nothing rewritten. */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarkdownReader, parseBlocks } from '../src/client/views/markdown.tsx'

describe('parseBlocks', () => {
  it('splits headings, lists, fenced code, and paragraphs; keeps text as written', () => {
    const source = '# 项目记忆（DS 维护）\n\n- 一条\n- 两条 `src/a.ts`\n\n1. first\n2) second\n\n```\nraw  code\n```\n\n一段\n继续\n'
    expect(parseBlocks(source)).toEqual([
      { kind: 'heading', level: 1, text: '项目记忆（DS 维护）' },
      { kind: 'list', ordered: false, items: ['一条', '两条 `src/a.ts`'] },
      { kind: 'list', ordered: true, items: ['first', 'second'] },
      { kind: 'code', text: 'raw  code' },
      { kind: 'paragraph', text: '一段 继续' },
    ])
  })

  it('handles CRLF and an unterminated fence', () => {
    expect(parseBlocks('## t\r\n```\r\nx\r\n')).toEqual([{ kind: 'heading', level: 2, text: 't' }, { kind: 'code', text: 'x' }])
  })
})

describe('MarkdownReader', () => {
  it('renders headings, list items, inline code, and bold', () => {
    render(<MarkdownReader source={'## Title\n- **bold** and `code`\n'} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Title')
    const item = screen.getByRole('listitem')
    expect(item.querySelector('strong')?.textContent).toBe('bold')
    expect(item.querySelector('code')?.textContent).toBe('code')
  })
})
