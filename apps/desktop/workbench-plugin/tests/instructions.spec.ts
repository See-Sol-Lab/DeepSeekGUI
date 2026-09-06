import { expect, it, vi } from 'vitest'
import { instructionSender } from '../src/client/instructions.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

it('queues form text without draft or attachment mutations', async () => {
  const prompt = vi.fn(async () => ({ ok: true }))
  const setDraft = vi.fn()
  const notify = vi.fn()
  const ctx = {
    sessions: { binding: vi.fn(() => ({ ctx: {}, session: { prompt } })) },
    conversation: { input: { for: () => ({ setDraft, notify }) } },
  }
  expect(await instructionSender(ctx as never, 's1' as SessionId)('form text')).toBe(true)
  expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'form text' }], 'queue')
  expect(setDraft).not.toHaveBeenCalled()
  expect(notify).not.toHaveBeenCalled()
})
