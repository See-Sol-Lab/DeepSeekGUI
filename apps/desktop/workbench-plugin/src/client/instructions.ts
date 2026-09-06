/** Form messages use the official Session sender without touching the composer draft. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Submit plain text to the addressed Session queue; false means admission failed. */
export type InstructionSender = (text: string) => Promise<boolean>

/**
 * Bind a form to its Session, preserving draft text and attachments.
 * @param ctx - Client services.
 * @param sessionId - Session identity supplied by the slot.
 * @returns the official queue sender with composer-owned error reporting.
 */
export function instructionSender(ctx: Context, sessionId: SessionId): InstructionSender {
  return async (text) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return false
    try {
      return (await binding.session.prompt([{ type: 'text', text }], 'queue')).ok
    } catch (error) {
      ctx.conversation.input.for(binding.ctx).notify('error', error instanceof Error ? error.message : String(error))
      return false
    }
  }
}
