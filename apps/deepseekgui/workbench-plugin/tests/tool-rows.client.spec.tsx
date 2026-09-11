// @vitest-environment jsdom

/**
 * Presentation specs for the B5-P5 tool-result rows: collapsed conclusion,
 * folded disclosure sections, failure copy, and the card-opened small forms
 * dispatching through the official input actions (never a direct tool call).
 * @module @see-sol-lab/deepseekgui-workbench/tests/tool-rows
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { zh as toolsZh } from '../src/client/locales-tools.ts'
import { BrowserToolRow, GitPrToolRow } from '../src/client/cards/tool-rows.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Locale seat stub: formats the zh dictionary like the real translate. */
function translator(dict: Record<string, string>) {
  return (key: string, params?: Record<string, string | number>): string => {
    let text = dict[key] ?? key
    if (params !== undefined) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

const tTools = translator(toolsZh as unknown as Record<string, string>)

const settled = (over: Partial<ToolResultNode> & { name: string; text?: string }): ToolCallBlock => ({
  kind: 'tool-result',
  seq: 10,
  time: 2_000,
  callId: 'c1',
  call: { name: over.name, argsRaw: over.argsRaw ?? '{}' },
  callTime: 1_000,
  content: over.text === undefined ? [] : [{ type: 'text', text: over.text }],
  isError: over.isError === true,
  meta: over.meta,
  error: over.error,
  subCalls: [],
} as unknown as ToolCallBlock)

const running = (name: string, argsRaw: string): ToolCallBlock => ({
  callId: 'c1', name, argsRaw, turn: 1, step: 1, time: 1_000, subCalls: [],
} as unknown as ToolCallBlock)

const toolsProps = (over: Record<string, unknown> = {}) => ({
  toolName: 'git_status',
  cwd: undefined,
  home: undefined,
  openFile: vi.fn(),
  inspect: undefined,
  t: tTools,
  inputActions: { setDraft: vi.fn(), submit: vi.fn() },
  submitInstruction: vi.fn(async () => true),
  ...over,
})

describe('GitPrToolRow', () => {
  it('collapses a settled status to title, conclusion and state; expanding reveals counts and folded output', () => {
    const block = settled({
      name: 'git_status',
      text: '2 changed path(s), on main:\n- staged src/a.ts\n- untracked README.md',
      meta: {
        kind: 'git-status', clean: false, head: 'on main',
        counts: { staged: 1, unstaged: 0, untracked: 1, conflict: 0, total: 2 },
        entries: [
          { state: 'staged', path: 'src/a.ts', origPath: null },
          { state: 'untracked', path: 'README.md', origPath: null },
        ],
      },
    })
    render(<GitPrToolRow {...toolsProps({ block, toolName: 'git_status' })} />)
    expect(screen.getByText('Git 状态')).toBeTruthy()
    expect(screen.getByText(/2 changed path\(s\), on main/)).toBeTruthy()
    expect(screen.queryByText(/已暂存 1/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/已暂存 1 · 未暂存 0/)).toBeTruthy()
    expect(screen.getByText(/未跟踪 1/)).toBeTruthy()
  })

  it('shows the failure line in red copy and offers no action', () => {
    const block = settled({
      name: 'git_status',
      isError: true,
      error: { name: 'Refused', code: 'read-only' },
      text: 'git_status refused: this session is read-only',
    })
    render(<GitPrToolRow {...toolsProps({ block, toolName: 'git_status' })} />)
    expect(screen.getByText('git_status refused: this session is read-only')).toBeTruthy()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText(/以新消息提交/)).toBeNull()
  })

  it('sends a form without replacing the composer draft', async () => {
    const block = settled({ name: 'git_status', text: '2 changed path(s), on main:\n- staged src/a.ts' })
    const setDraft = vi.fn()
    const submit = vi.fn()
    const submitInstruction = vi.fn(async () => true)
    render(
      <GitPrToolRow {...toolsProps({ block, toolName: 'git_status', inputActions: { setDraft, submit }, submitInstruction })} />,
    )
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText(/以新消息提交/))
    const textbox = screen.getByLabelText(/提交信息（助手将先/) as HTMLTextAreaElement
    fireEvent.change(textbox, { target: { value: 'feat: ship the card' } })
    fireEvent.click(screen.getByText('发送给助手'))
    expect(setDraft).not.toHaveBeenCalled()
    const draft = submitInstruction.mock.calls[0]?.[0] as string
    expect(draft).toContain('feat: ship the card')
    expect(submit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('发送给助手')).toBeNull())
    // Sending collapses the card again (no page, no separate flow).
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('prefills the push form from the preview result and keeps remote/ref editable', () => {
    const text = 'remote origin: https://example/repo.git\nlocal feature/x (sha123) -> feature/x\n3 candidate commit(s)'
    const block = settled({ name: 'git_push_preview', argsRaw: '{"remote":"origin"}', text,
      meta: { remote: 'origin', localBranch: 'feature/x', remoteBranch: 'feature/x' } })
    render(<GitPrToolRow {...toolsProps({ block, toolName: 'git_push_preview' })} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText(/推送分支…/))
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    const values = inputs.map(input => input.value)
    expect(values).toEqual(['origin', 'feature/x', 'feature/x'])
  })
})

describe('BrowserToolRow', () => {
  it('renders the running summary from its argument url', () => {
    render(
      <BrowserToolRow {...toolsProps({ block: running('browser_navigate', '{"url":"https://example.com/a"}'), toolName: 'browser_navigate' })} />,
    )
    expect(screen.getByText('浏览器')).toBeTruthy()
    expect(screen.getByText('https://example.com/a')).toBeTruthy()
  })
})
