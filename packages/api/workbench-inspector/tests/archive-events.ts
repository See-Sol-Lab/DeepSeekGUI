/**
 * 归档整理测试共用的会话事件构造：用 dsh-llm 的消息构造函数生成真实形状的事件，不靠类型强转。
 */
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** 一组按顺序编号的事件构造器。 */
export function eventFactory() {
  let seq = 0
  return {
    user: (text: string, injected = false): SessionEvent<'user/message'> => ({
      type: 'user/message', seq: SessionSeq(seq++), time: 0, surfaceOp: 'append',
      data: createUserMessage({ content: [{ type: 'text', text }], source: injected ? { kind: 'system-prompt' } : { kind: 'user' } }),
    }),
    assistant: (text: string): SessionEvent<'assistant/message'> => ({
      type: 'assistant/message', seq: SessionSeq(seq++), time: 0, surfaceOp: 'append',
      data: { turn: 0, step: 0, message: createAssistantMessage({ content: [{ type: 'text', text }], source: { provider: 'p', model: 'm' } }), stream: [] },
    }),
    turnStart: (): SessionEvent<'turn/start'> => ({ type: 'turn/start', seq: SessionSeq(seq++), time: 0, data: { turn: 0 } }),
    turnEnd: (): SessionEvent<'turn/end'> => ({ type: 'turn/end', seq: SessionSeq(seq++), time: 0, data: { turn: 0, reason: { kind: 'completed' } } }),
  }
}
