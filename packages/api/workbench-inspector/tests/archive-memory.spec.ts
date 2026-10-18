/**
 * 归档整理纯逻辑（Phase 2，Sol 审查后返工）：取材料、整段与新增分开的门槛、有界材料与记忆、
 * 严格解析、保留语义差异的去重、取代旧自动条目、区外逐字节不动。
 */
import { describe, expect, it } from 'vitest'
import { eventFactory } from './archive-events.ts'
import {
  AREA_BEGIN,
  AREA_END,
  boundMemory,
  boundTranscript,
  codePoints,
  DEFAULT_LIMITS,
  eligibilityOf,
  mergeIntoProjectMemory,
  parseSummary,
  requestBudget,
  sourceTag,
  transcriptOf,
  type Transcript,
} from '../src/archive-memory.ts'

const events = (): ReturnType<typeof eventFactory> => eventFactory()

const heading = { title: '## 归档整理（自动）', note: '> 说明', toVerify: '（待核实）', superseded: '（已被后来的决定取代）', date: '**2026-10-05**' }
const transcript = (userTurns: number, chars: number, lines = 1): Transcript => ({
  lines: Array.from({ length: lines }, (_, index) => ({ role: 'user' as const, text: 'x', seq: index, time: 0 })), userTurns, chars, throughSeq: 9,
})

describe('transcriptOf', () => {
  it('只取人说的话与助手正文，不取注入消息；只到最后一个已结束的轮次', () => {
    const e = events()
    const result = transcriptOf([e.turnStart(), e.user('你好'), e.user('注入的上下文', true), e.assistant('在呢'), e.turnEnd(), e.user('还在跑的一轮'), e.assistant('半句')])
    expect(result.lines.map(line => line.text)).toEqual(['你好', '在呢'])
    expect(result.userTurns).toBe(1)
    expect(result.chars).toBe(4)
    expect(result.throughSeq).toBe(4)
  })

  it('afterSeq 之后才算新增；没有已结束轮次时 throughSeq = -1', () => {
    const e = events()
    expect(transcriptOf([e.user('一'), e.assistant('二'), e.turnEnd(), e.user('三'), e.assistant('四'), e.turnEnd()], 2).lines.map(line => line.text)).toEqual(['三', '四'])
    expect(transcriptOf([events().user('一')]).throughSeq).toBe(-1)
  })
})

describe('eligibilityOf：整段是否够长与这次有没有新增分开看', () => {
  it('门槛看整段会话；早已达标的长会话恢复后只多两轮，照样整理', () => {
    const { autoMinUserTurns, autoMinChars } = DEFAULT_LIMITS
    expect(eligibilityOf(transcript(2, 50), transcript(autoMinUserTurns - 1, autoMinChars - 1), false)).toBe('too-short')
    expect(eligibilityOf(transcript(2, 50), transcript(autoMinUserTurns, 0), false)).toBe('ok')
    expect(eligibilityOf(transcript(2, 50), transcript(0, autoMinChars), false)).toBe('ok')
    expect(eligibilityOf(transcript(1, 1), transcript(1, 1), true)).toBe('ok')
  })
  it('没有新增 / 还没有结束的轮次', () => {
    expect(eligibilityOf(transcript(0, 0, 0), transcript(30, 99_999), true)).toBe('nothing-new')
    expect(eligibilityOf(transcript(0, 0, 0), { lines: [], userTurns: 0, chars: 0, throughSeq: -1 }, true)).toBe('empty')
  })
})

describe('有界材料与记忆', () => {
  it('超出上限只留最近的整行，并标明不完整', () => {
    const big = 'a'.repeat(400)
    const lines = [0, 1, 2].map(index => ({ role: 'user' as const, text: big, seq: index, time: 0 }))
    const bounded = boundTranscript({ lines, userTurns: 3, chars: 1200, throughSeq: 3 }, 1_000)
    expect(bounded.complete).toBe(false)
    expect(bounded.fromSeq).toBe(1)
    expect(bounded.chars).toBeLessThanOrEqual(1_000)
  })
  it('单条消息本身超过上限：只留它的结尾，绝不顶破上限', () => {
    const huge = `${'头'.repeat(5_000)}结尾的关键决定`
    const bounded = boundTranscript({ lines: [{ role: 'user', text: huge, seq: 7, time: 0 }], userTurns: 1, chars: codePoints(huge), throughSeq: 8 }, 1_000)
    expect(bounded.chars).toBeLessThanOrEqual(1_000)
    expect(bounded.complete).toBe(false)
    expect(bounded.text.endsWith('结尾的关键决定')).toBe(true)
  })
  it('记忆超长：保留开头与整个自动整理区', () => {
    const memory = `${'人写'.repeat(2_000)}\n${AREA_BEGIN}\n- 自动条目\n${AREA_END}\n`
    const bounded = boundMemory(memory, 500)
    expect(bounded.complete).toBe(false)
    expect(bounded.text).toContain(`${AREA_BEGIN}\n- 自动条目\n${AREA_END}`)
    expect(codePoints(bounded.text)).toBeLessThanOrEqual(520)
  })
  it('请求预算按模型上下文收紧', () => {
    expect(requestBudget(DEFAULT_LIMITS, undefined)).toBe(DEFAULT_LIMITS.maxRequestChars)
    expect(requestBudget(DEFAULT_LIMITS, 64_000)).toBe(32_000)
  })
})

describe('parseSummary', () => {
  it('认得出的行与丢弃计数；NONE 单独成立；SUPERSEDES 挂在前一条已确认条目上', () => {
    const parsed = parseSummary('PROJECT: 用 Node 24\nSUPERSEDES: 用 Node 22\nPROJECT?: 可能要迁库\nGLOBAL: 喜欢短回答\n随便一句\n')
    expect(parsed.project).toEqual([{ text: '用 Node 24', confirmed: true, supersedes: '用 Node 22' }, { text: '可能要迁库', confirmed: false }])
    expect(parsed.global).toEqual(['喜欢短回答'])
    expect(parsed.recognized).toBe(4)
    expect(parsed.rejected).toBe(1)
    expect(parseSummary('NONE').none).toBe(true)
  })
  it('空回复、纯说明文字：一行都认不出', () => {
    expect(parseSummary('').recognized).toBe(0)
    expect(parseSummary('好的，我来总结一下这段对话。').recognized).toBe(0)
  })
  it('像凭据的整条丢掉；数量超限的丢掉；孤立的 SUPERSEDES 丢掉', () => {
    const lines = Array.from({ length: DEFAULT_LIMITS.maxProjectItems + 2 }, (_, index) => `PROJECT: 第${String(index)}条`)
    const parsed = parseSummary([...lines, 'PROJECT: api_key = sk-abcdefghijklmnopqrstuv'].join('\n'))
    expect(parsed.project).toHaveLength(DEFAULT_LIMITS.maxProjectItems)
    expect(parsed.project.some(item => item.text.includes('sk-'))).toBe(false)
    expect(parseSummary('SUPERSEDES: 旧的').project).toHaveLength(0)
  })
})

describe('mergeIntoProjectMemory', () => {
  const tag = sourceTag('s1', 9)
  it('没有整理区：接在末尾，区外逐字节不变（含原来的尾部空白）', () => {
    const current = '# 我的笔记\n手写的一行   \n\n'
    const merged = mergeIntoProjectMemory(current, [{ text: '用 pnpm', confirmed: true }], tag, heading)
    expect(merged.kind).toBe('written')
    if (merged.kind !== 'written') return
    expect(merged.text.startsWith(current)).toBe(true)
    expect(merged.text).toContain(`- 用 pnpm ${tag}`)
  })

  it('去重保留大小写、标点与数字：C 与 C++、Node 22 与 Node 24 都不是重复', () => {
    const current = '- 语言是 C\n- 用 Node 22\n- 路径 D:/Repo\n'
    const merged = mergeIntoProjectMemory(current, [
      { text: '语言是 C++', confirmed: true }, { text: '用 Node 24', confirmed: true }, { text: '路径 d:/repo', confirmed: true }, { text: '语言是 C', confirmed: true },
    ], tag, heading)
    expect(merged.kind).toBe('written')
    if (merged.kind !== 'written') return
    expect(merged.added).toHaveLength(3)
    expect(merged.duplicates).toBe(1)
  })

  it('已确认的新决定取代旧自动条目：旧条目改成删除线；人写的同样文字不动', () => {
    const current = `手写：用 Node 22\n\n${AREA_BEGIN}\n## 归档整理（自动）\n- 用 Node 22 <!-- dsg:s0:1 -->\n${AREA_END}\n`
    const merged = mergeIntoProjectMemory(current, [{ text: '用 Node 24', confirmed: true, supersedes: '用 Node 22' }], tag, heading)
    expect(merged.kind).toBe('written')
    if (merged.kind !== 'written') return
    expect(merged.superseded).toEqual(['用 Node 22'])
    expect(merged.text).toContain('- ~~用 Node 22~~ （已被后来的决定取代） <!-- dsg:s0:1 -->')
    expect(merged.text.startsWith('手写：用 Node 22\n')).toBe(true)
    expect(merged.text).toContain(`- 用 Node 24 ${tag}`)
  })

  it('同一会话同一 seq 已写过：already；整理区满了、标记残缺：不写；CRLF 保持', () => {
    expect(mergeIntoProjectMemory(`${AREA_BEGIN}\n- 用 pnpm ${tag}\n${AREA_END}\n`, [{ text: '另一种说法', confirmed: true }], tag, heading).kind).toBe('already')
    const full = `${AREA_BEGIN}\n${'x'.repeat(DEFAULT_LIMITS.autoAreaMaxChars)}\n${AREA_END}\n`
    expect(mergeIntoProjectMemory(full, [{ text: '新', confirmed: true }], tag, heading).kind).toBe('full')
    expect(mergeIntoProjectMemory(`${AREA_BEGIN}\n只有开头\n`, [{ text: '新', confirmed: true }], tag, heading).kind).toBe('malformed')
    const crlf = mergeIntoProjectMemory('a\r\nb\r\n', [{ text: '新', confirmed: true }], tag, heading)
    expect(crlf.kind === 'written' && !/[^\r]\n/u.test(crlf.text)).toBe(true)
  })
})
