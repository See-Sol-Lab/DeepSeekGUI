// @vitest-environment node
/**
 * B8-P1 会话导出渲染器：全部用例都打在这个纯函数上，输入是手写的事件
 * fixture（绝不用真实会话）。钉住的是「导出的文件用任何 Markdown 阅读器
 * 都能直接读」：说话顺序、原文不改写、围栏不破、截断数字真实、跳过的
 * 事件一类不漏。command/* 与 compaction/* 事件类型经本文件的模块增强
 * 进入测试程序——仓库里真实形状由各自的包声明。
 * @module @deepseek-ai/dsh-workbench-inspector/tests/session-markdown
 */
import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  renderSessionMarkdown,
  SESSION_EXPORT_DETAIL_LIMIT,
  untitledSessionTitle,
} from '../src/session-markdown.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'file-change': { kind: 'file-change' }
  }
}
/**
 * Fixture 按日志原样的形状手写，经 `ev` 收窄成事件联合：品牌类型（SessionSeq、
 * MessageId…）和别的包合并进来的事件（command/*、compaction/*）不在这里重新
 * 声明——Host 程序里它们有真实声明，重复声明会冲突。渲染器只按 `type` 字符串
 * 分派，这里钉的是渲染结果，不是类型推导。
 */
function ev(value: Record<string, unknown>): SessionEvent {
  return value as SessionEvent
}

/** 本机时区的固定时刻，跨 2026-09-28 与 09-29 两天。 */
function at(day: 28 | 29, hour: number, minute: number): number {
  return new Date(2026, 8, day, hour, minute).getTime()
}

const textBlock = (text: string): ContentBlock => ({ type: 'text', text })
const reasoningBlock = (text: string): ContentBlock => ({ type: 'reasoning', text })

function userText(seq: number, time: number, text: string): SessionEvent {
  return ev({
    seq, time, type: 'user/message', surfaceOp: 'append',
    data: { id: `u-${String(seq)}`, role: 'user', source: { kind: 'user' }, content: [textBlock(text)] },
  })
}

/** 合成注入（文件变更通知一类）：source 不是 'user'，导出里不是「用户」说的话。 */
function injectedText(seq: number, time: number, text: string): SessionEvent {
  return ev({
    seq, time, type: 'user/message', surfaceOp: 'append',
    data: { id: `i-${String(seq)}`, role: 'user', source: { kind: 'file-change' }, content: [textBlock(text)] },
  })
}

function userContent(seq: number, time: number, content: readonly ContentBlock[]): SessionEvent {
  return ev({
    seq, time, type: 'user/message', surfaceOp: 'append',
    data: { id: `u-${String(seq)}`, role: 'user', source: { kind: 'user' }, content: [...content] },
  })
}

function assistantContent(seq: number, time: number, content: readonly ContentBlock[]): SessionEvent {
  return ev({
    seq, time, type: 'assistant/message',
    data: {
      turn: 1, step: 1,
      message: {
        id: `a-${String(seq)}`, role: 'assistant',
        source: { kind: 'model', provider: 'deepseek', model: 'dsh-test' },
        content: [...content],
      },
      stream: [],
    },
  })
}

function assistantText(seq: number, time: number, text: string): SessionEvent {
  return assistantContent(seq, time, [textBlock(text)])
}

function toolCall(seq: number, time: number, callId: string, name: string, args: string): SessionEvent {
  return ev({ seq, time, type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: args } })
}

function toolResult(seq: number, time: number, callId: string, content: string | readonly ContentBlock[]): SessionEvent {
  return ev({
    seq, time, type: 'tool/result', surfaceOp: 'append',
    data: {
      turn: 1, step: 1,
      message: {
        id: `t-${String(seq)}`, role: 'tool',
        source: { kind: 'tool', callId: ToolCallId(callId) },
        toolCallId: ToolCallId(callId),
        content: typeof content === 'string' ? [textBlock(content)] : [...content],
      },
    },
  })
}

function turnEnd(seq: number, time: number, reason: SessionEvent<'turn/end'>['data']['reason']): SessionEvent {
  return ev({ seq, time, type: 'turn/end', data: { turn: 1, reason } })
}

function compactionStart(seq: number, time: number): SessionEvent {
  return ev({ seq, time, type: 'compaction/start', data: { compactionId: 'c-1', turn: null } })
}

function commandRun(seq: number, name: string): SessionEvent {
  return ev({ seq, time: at(28, 9, 0), type: 'command/run', data: { commandId: `c-${String(seq)}`, name, source: { kind: 'user' } } })
}

function commandDone(seq: number): SessionEvent {
  return ev({ seq, time: at(28, 9, 0), type: 'command/done', data: { commandId: `c-${String(seq)}` } })
}

/** 默认输入；`withCwd: false` 表示会话头没有 cwd。 */
function render(events: readonly SessionEvent[], overrides: {
  includeDetails?: boolean
  language?: 'zh' | 'en'
  title?: string
  withCwd?: boolean
} = {}): string {
  return renderSessionMarkdown({
    title: overrides.title ?? '调试导出',
    ...overrides.withCwd === false ? {} : { cwd: 'E:\\example\\project' },
    sessionId: 's-1',
    events,
    includeDetails: overrides.includeDetails ?? false,
    language: overrides.language ?? 'zh',
    exportedAt: at(28, 15, 2),
  })
}

describe('默认模式', () => {
  it('只有一问一答：文件头、两段正文、首轮带日期', () => {
    const markdown = render([userText(3, at(28, 14, 31), '你好'), assistantText(5, at(28, 14, 31), '你好！有什么可以帮你？')])
    expect(markdown).toBe(`# 调试导出

- 导出时间：2026-09-28 15:02
- 工作目录：E:\\example\\project
- 会话 ID：s-1

> 本文件由 DeepSeekGUI 直接从会话记录生成，未经模型改写。内容未做脱敏，分享前请自行检查。

---

## 用户 · 2026-09-28 14:31

你好

## 助手 · 14:31

你好！有什么可以帮你？
`)
  })

  it('多轮：每条用户消息起新标题，连续助手文本合并到同一个标题下', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '第一问'),
      assistantText(2, at(28, 9, 1), '第一答的前半'),
      assistantText(3, at(28, 9, 2), '第一答的后半'),
      userText(4, at(28, 9, 3), '第二问'),
      assistantText(5, at(28, 9, 4), '第二答'),
    ])
    expect(markdown).toContain('## 用户 · 2026-09-28 09:00\n\n第一问')
    expect(markdown).toContain('## 助手 · 09:01\n\n第一答的前半\n\n第一答的后半')
    // 两轮各一个助手标题；第一轮的两条连续消息合并在其中之一里。
    expect(markdown.match(/## 助手/gu)).toHaveLength(2)
    expect(markdown).toContain('## 用户 · 09:03\n\n第二问')
    expect(markdown).toContain('## 助手 · 09:04\n\n第二答')
  })

  it('命令、系统、边界与合成注入事件一律不输出', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '人说的'),
      injectedText(2, at(28, 9, 0), '文件变更通知（合成的，不是人说的）'),
      commandRun(3, 'compact'),
      commandDone(4),
      ev({
        seq: 5, time: at(28, 9, 0), type: 'system/message', surfaceOp: 'append',
        data: { turn: 1, step: 1, message: { id: 's-1', role: 'system', source: { kind: 'system-prompt' }, content: [textBlock('系统提示词')] } },
      }),
      ev({ seq: 6, time: at(28, 9, 0), type: 'step/start', data: { turn: 1, step: 1 } }),
      ev({ seq: 8, time: at(28, 9, 0), type: 'assistant/attempt', data: { turn: 1, step: 1, stream: [] } }),
      assistantText(9, at(28, 9, 1), '助手说的'),
    ])
    expect(markdown).toContain('人说的')
    expect(markdown).toContain('助手说的')
    expect(markdown).not.toContain('文件变更通知')
    expect(markdown).not.toContain('compact')
    expect(markdown).not.toContain('系统提示词')
  })

  it('压缩标记：发生位置一行引语，压缩前的原文照样导出', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '压缩前的话'),
      assistantText(2, at(28, 9, 1), '压缩前的回答'),
      compactionStart(3, at(28, 9, 2)),
      userText(4, at(28, 9, 3), '压缩后的话'),
      assistantText(5, at(28, 9, 4), '压缩后的回答'),
    ])
    expect(markdown).toContain('压缩前的话')
    expect(markdown).toContain('压缩前的回答')
    expect(markdown).toContain('> —— 此处进行过一次上下文压缩 ——')
    expect(markdown).toContain('压缩后的话')
  })

  it('回合未正常结束：原因取事件里已有的文字，没有就只写一行', () => {
    const hookAborted = render([
      userText(1, at(28, 9, 0), '问'),
      assistantText(2, at(28, 9, 1), '答'),
      turnEnd(3, at(28, 9, 2), { kind: 'aborted', reason: { kind: 'hook', reason: 'hook 打断了这一轮' } }),
    ])
    expect(hookAborted).toContain('> 本轮未正常结束：hook 打断了这一轮')
    const userAborted = render([
      userText(1, at(28, 9, 0), '问'),
      turnEnd(3, at(28, 9, 2), { kind: 'aborted', reason: { kind: 'user' } }),
    ])
    expect(userAborted).toContain('> 本轮未正常结束\n')
    expect(userAborted).not.toContain('本轮未正常结束：')
    const failed = render([
      userText(1, at(28, 9, 0), '问'),
      turnEnd(3, at(28, 9, 2), { kind: 'error', error: { message: '上游 502', code: 'PROVIDER' } }),
    ])
    expect(failed).toContain('> 本轮未正常结束：上游 502')
    const completed = render([
      userText(1, at(28, 9, 0), '问'),
      assistantText(2, at(28, 9, 1), '答'),
      turnEnd(3, at(28, 9, 2), { kind: 'completed' }),
    ])
    expect(completed).not.toContain('本轮未正常结束')
  })

  it('空会话：只有文件头和一句占位', () => {
    const markdown = render([])
    expect(markdown).toBe(`# 调试导出

- 导出时间：2026-09-28 15:02
- 工作目录：E:\\example\\project
- 会话 ID：s-1

> 本文件由 DeepSeekGUI 直接从会话记录生成，未经模型改写。内容未做脱敏，分享前请自行检查。

---

（此会话没有消息）
`)
  })

  it('会话头没有 cwd 时省略工作目录行', () => {
    const markdown = render([userText(1, at(28, 9, 0), '问')], { withCwd: false })
    expect(markdown).not.toContain('工作目录')
    expect(markdown).toContain('- 导出时间：2026-09-28 15:02')
    expect(markdown).toContain('- 会话 ID：s-1')
  })

  it('事件乱序传入时按 seq 排好', () => {
    const markdown = render([
      assistantText(5, at(28, 9, 1), '答'),
      userText(3, at(28, 9, 0), '问'),
    ])
    expect(markdown.indexOf('问')).toBeGreaterThan(-1)
    expect(markdown.indexOf('问')).toBeLessThan(markdown.indexOf('答'))
    expect(markdown).toContain('## 用户 · 2026-09-28 09:00')
    expect(markdown).toContain('## 助手 · 09:01')
  })

  it('跨天的第一条带日期', () => {
    const markdown = render([
      userText(1, at(28, 23, 0), '第一天的'),
      assistantText(2, at(29, 8, 30), '第二天的'),
      userText(3, at(29, 8, 31), '还是第二天的'),
    ])
    expect(markdown).toContain('## 用户 · 2026-09-28 23:00')
    expect(markdown).toContain('## 助手 · 2026-09-29 08:30')
    expect(markdown).toContain('## 用户 · 08:31')
  })

  it('附件占位：原文位置一行引语，不内嵌、不转 base64', () => {
    const markdown = render([
      userContent(1, at(28, 9, 0), [
        textBlock('看这两个文件'),
        {
          type: 'image',
          attachment: { attachmentId: AttachmentId('sha256:abcd1234'), mediaType: 'image/png', bytes: 8, width: 1, height: 1 },
        },
        { type: 'file', attachment: { attachmentId: AttachmentId('sha256:ef567890'), name: '季度报告.pdf', bytes: 8 } },
      ]),
    ])
    expect(markdown).toContain('看这两个文件')
    expect(markdown).toContain('> [附件：sha256:abcd1234]（附件未随本文件导出）')
    expect(markdown).toContain('> [附件：季度报告.pdf]（附件未随本文件导出）')
  })

  it('只有工具调用没有文字的助手消息不产生空标题', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      assistantContent(2, at(28, 9, 1), [{ type: 'tool-call', id: ToolCallId('c1'), name: 'bash', arguments: '{"command":"ls"}' }]),
      turnEnd(4, at(28, 9, 2), { kind: 'completed' }),
    ])
    expect(markdown).not.toContain('## 助手')
    expect(markdown).toContain('## 用户 · 2026-09-28 09:00')
  })
})

describe('勾选「包含工具调用与思考过程」', () => {
  it('思考块放在对应助手文本之前，正文原样', () => {
    const markdown = render(
      [userText(1, at(28, 9, 0), '问'), assistantContent(2, at(28, 9, 1), [reasoningBlock('先想一下'), textBlock('答')])],
      { includeDetails: true },
    )
    expect(markdown).toContain('## 助手 · 09:01\n\n<details><summary>思考过程</summary>\n\n先想一下\n\n</details>\n\n答')
    // 默认模式下同一条消息不出现思考。
    expect(render([assistantContent(2, at(28, 9, 1), [reasoningBlock('先想一下'), textBlock('答')])])).not.toContain('思考过程')
  })

  it('工具调用放在它出现的位置：文本—工具—文本共用一个助手标题', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '看看目录'),
      assistantText(2, at(28, 9, 1), '先看看'),
      toolCall(3, at(28, 9, 2), 'c1', 'bash', '{"command":"ls"}'),
      toolResult(4, at(28, 9, 3), 'c1', 'a.txt\nb.txt'),
      assistantText(5, at(28, 9, 4), '好了，目录里有 a.txt 和 b.txt'),
    ], { includeDetails: true })
    expect(markdown.match(/## 助手/gu)).toHaveLength(1)
    expect(markdown).toContain([
      '## 助手 · 09:01',
      '',
      '先看看',
      '',
      '<details><summary>工具：bash</summary>',
      '',
      '参数：',
      '',
      '```json',
      '{',
      '  "command": "ls"',
      '}',
      '```',
      '',
      '结果：',
      '',
      '```',
      'a.txt\nb.txt',
      '```',
      '',
      '</details>',
      '',
      '好了，目录里有 a.txt 和 b.txt',
    ].join('\n'))
  })

  it('子代理按一个普通工具调用处理，结果写返回给主会话的内容', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '查一下'),
      toolCall(2, at(28, 9, 1), 'c1', 'agent', '{"task":"查"}'),
      toolResult(3, at(28, 9, 2), 'c1', '子代理返回给主会话的结论'),
    ], { includeDetails: true })
    expect(markdown).toContain('<details><summary>工具：agent</summary>')
    expect(markdown).toContain('子代理返回给主会话的结论')
  })

  it('没有结果的工具调用（被打断）只写参数段', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'bash', '{"command":"ls"}'),
      turnEnd(3, at(28, 9, 2), { kind: 'aborted', reason: { kind: 'user' } }),
    ], { includeDetails: true })
    expect(markdown).toContain('参数：')
    expect(markdown).not.toContain('结果：')
    expect(markdown).toContain('> 本轮未正常结束')
  })

  it('代码围栏防破裂：原文里已有 ``` 时外层用更长的反引号串', () => {
    const nested = '看这段：\n```python\nprint(1)\n```'
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'bash', '{}'),
      toolResult(3, at(28, 9, 2), 'c1', nested),
    ], { includeDetails: true })
    expect(markdown).toContain('````\n看这段：\n```python\nprint(1)\n```\n````')
  })

  it('参数原文里已有反引号时 json 围栏同样加长', () => {
    const args = JSON.stringify({ code: '```js\nx()' })
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'bash', args),
    ], { includeDetails: true })
    expect(markdown).toContain('````json\n{\n  "code": "```js\\nx()"\n}\n````')
  })

  it('超长工具结果截断，末尾写真实原长', () => {
    const long = '字'.repeat(5_000)
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'bash', '{}'),
      toolResult(3, at(28, 9, 2), 'c1', long),
    ], { includeDetails: true })
    expect(markdown).toContain(`${'字'.repeat(SESSION_EXPORT_DETAIL_LIMIT)}\n\n（已截断，原文共 5000 字符）`)
    expect(markdown).not.toContain('字'.repeat(4_001))
  })

  it('超长参数同样截断，数字是格式化后的真实长度', () => {
    const raw = JSON.stringify({ text: '参'.repeat(4_200) })
    const formatted = JSON.stringify(JSON.parse(raw), null, 2)
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'bash', raw),
    ], { includeDetails: true })
    expect(markdown).toContain(`（已截断，原文共 ${String(formatted.length)} 字符）`)
  })

  it('图片或二进制结果写占位说明', () => {
    const markdown = render([
      userText(1, at(28, 9, 0), '问'),
      toolCall(2, at(28, 9, 1), 'c1', 'browser_screenshot', '{}'),
      toolResult(3, at(28, 9, 2), 'c1', [{
        type: 'image',
        attachment: { attachmentId: AttachmentId('sha256:abcd1234'), mediaType: 'image/png', bytes: 8, width: 1, height: 1 },
      }]),
    ], { includeDetails: true })
    expect(markdown).toContain('（非文本结果，未导出）')
  })
})

describe('双语', () => {
  it('英文界面的标题、文件头与标签', () => {
    const markdown = render(
      [userText(1, at(28, 9, 0), 'hello'), assistantText(2, at(28, 9, 1), 'hi there'), turnEnd(3, at(28, 9, 2), { kind: 'aborted', reason: { kind: 'user' } })],
      { language: 'en', withCwd: false },
    )
    expect(markdown).toBe(`# 调试导出

- Exported at: 2026-09-28 15:02
- Session ID: s-1

> Generated by DeepSeekGUI directly from the session log; the model did not rewrite anything. The content is not sanitized — review it before sharing.

---

## User · 2026-09-28 09:00

hello

## Assistant · 09:01

hi there

> This turn did not end normally
`)
  })

  it('英文的思考与工具标签', () => {
    const markdown = render(
      [userText(1, at(28, 9, 0), 'q'), assistantContent(2, at(28, 9, 1), [reasoningBlock('think'), textBlock('a')])],
      { language: 'en', includeDetails: true },
    )
    expect(markdown).toContain('<details><summary>Reasoning</summary>')
    const tool = render(
      [toolCall(2, at(28, 9, 1), 'c1', 'bash', '{}'), toolResult(3, at(28, 9, 2), 'c1', 'out')],
      { language: 'en', includeDetails: true },
    )
    expect(tool).toContain('<details><summary>Tool: bash</summary>')
    expect(tool).toContain('Arguments:')
    expect(tool).toContain('Result:')
  })

  it('没有标题的会话按语言给「未命名会话」', () => {
    expect(untitledSessionTitle('zh')).toBe('未命名会话')
    expect(untitledSessionTitle('en')).toBe('Untitled session')
  })
})
