/**
 * 归档整理执行面（Phase 2，Sol 审查后返工）：可控模型桩 + 真实临时目录，验证精确输入与不带工具、
 * 各种结束原因、无效输出不推进、位置保护、写入与恢复、项目级串行、取消与中断、建议的唯一写入者。
 * 真实模型的质量验收另做，不由这里代替。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionId as brandSessionId } from '@deepseek-ai/dsh-session'
import { ArchiveMemoryRunner, type ArchiveMemoryDeps, type LlmService } from '../src/archive-memory-runner.ts'
import { DEFAULT_LIMITS, SUMMARY_SYSTEM } from '../src/archive-memory.ts'
import { AREA_BEGIN, projectMemoryFileName } from '../src/types.ts'
import { eventFactory } from './archive-events.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

type Finish = 'stop' | 'tool-calls' | 'max-tokens'
interface Script { text?: string; finish?: Finish; hang?: boolean }

/** 可控模型桩：记下每次请求，按脚本回文字与结束原因；hang 时一直等到被取消。 */
function fakeLlm(scripts: Script[], seen: GenerateOptions[]): LlmService {
  return {
    stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      seen.push(options)
      const script = scripts.shift() ?? { text: 'NONE' }
      return (async function* () {
        if (script.hang === true) {
          await new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
          })
        }
        if (script.text !== undefined) yield { type: 'text-delta', index: 0, text: script.text }
        const finish = script.finish ?? 'stop'
        yield { type: 'finish', reason: finish === 'stop' ? { kind: 'stop' } : finish === 'tool-calls' ? { kind: 'tool-calls' } : { kind: 'max-tokens' } }
      })()
    },
    resolveModelInfo: async (provider: string, model: string) => ({
      provider, id: model, name: model, context: { contextWindow: 128_000 },
    }),
  }
}

/** 一段达标的长会话（整段 20 轮以上）。 */
function longSession(): SessionEvent[] {
  const e = eventFactory()
  const out: SessionEvent[] = []
  for (let index = 0; index < 21; index++) out.push(e.turnStart(), e.user(`第${String(index)}句：项目改用 pnpm`), e.assistant('好的'), e.turnEnd())
  return out
}

function stage(over: Partial<ArchiveMemoryDeps> & { scripts?: Script[]; events?: SessionEvent[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsg-arch-'))
  dirs.push(root)
  const home = join(root, 'home')
  const project = join(root, 'proj')
  mkdirSync(home)
  mkdirSync(project)
  const seen: GenerateOptions[] = []
  let events = over.events ?? longSession()
  const deps: ArchiveMemoryDeps = {
    home: () => home,
    limits: () => DEFAULT_LIMITS,
    observe: async () => ({ events, cwd: project, route: { provider: 'deepseek', model: 'deepseek-chat' } }),
    isGone: () => false,
    llm: () => fakeLlm(over.scripts ?? [{ text: 'PROJECT: 项目用 pnpm 管理依赖' }], seen),
    protection: () => undefined,
    log: () => {},
    ...over,
  }
  const runner = new ArchiveMemoryRunner(deps)
  const memoryPath = join(project, projectMemoryFileName(project))
  const id: SessionId = brandSessionId('session-1')
  return { root, home, project, memoryPath, seen, runner, id, setEvents: (next: SessionEvent[]) => { events = next } }
}

describe('ArchiveMemoryRunner.summarize', () => {
  it('精确输入、不带工具；写进项目记忆，记录可追溯并推进进度', async () => {
    const s = stage()
    writeFileSync(s.memoryPath, '# 手写\n')
    const record = await s.runner.summarize(s.id, false)
    expect(record.status).toBe('written')
    expect(s.seen).toHaveLength(1)
    const request = s.seen[0]!
    expect(request.tools).toBeUndefined()
    expect(request.system).toBe(SUMMARY_SYSTEM)
    expect(request.provider).toBe('deepseek')
    expect(JSON.stringify(request.messages)).toContain('第20句')
    const text = readFileSync(s.memoryPath, 'utf8')
    expect(text.startsWith('# 手写\n')).toBe(true)
    expect(text).toContain(AREA_BEGIN)
    expect(text).toContain('- 项目用 pnpm 管理依赖')
    expect(record.processedThroughSeq).toBeGreaterThan(0)
    expect(record.memoryInput?.text).toBe('# 手写\n')
    expect(record.memoryInput?.sha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('无效回复不推进：空、说明文字、全被过滤、提出工具调用、截断；之后可重试同一段材料', async () => {
    for (const script of [
      { text: '' }, { text: '好的，我来总结。' }, { text: 'PROJECT: token = sk-abcdefghijklmnopqrstuvwx' },
      { text: 'PROJECT: x', finish: 'tool-calls' as const }, { text: 'PROJECT: x', finish: 'max-tokens' as const },
    ]) {
      const s = stage({ scripts: [script] })
      const record = await s.runner.summarize(s.id, false)
      expect(record.status).toBe('invalid')
      expect(record.processedThroughSeq).toBe(-1)
      expect(existsSync(s.memoryPath)).toBe(false)
    }
    const s = stage({ scripts: [{ text: '好的' }, { text: 'PROJECT: 第二次成功' }] })
    expect((await s.runner.summarize(s.id, false)).status).toBe('invalid')
    const retry = await s.runner.summarize(s.id, false)
    expect(retry.status).toBe('written')
    expect(JSON.stringify(s.seen[1]!.messages)).toContain('第0句')
  })

  it('NONE 与只有全局建议都是有效结果：推进进度；建议进列表', async () => {
    const none = stage({ scripts: [{ text: 'NONE' }] })
    const record = await none.runner.summarize(none.id, false)
    expect(record.status).toBe('none')
    expect(record.processedThroughSeq).toBeGreaterThan(0)
    const global = stage({ scripts: [{ text: 'GLOBAL: 喜欢短回答' }] })
    expect((await global.runner.summarize(global.id, false)).status).toBe('none')
    expect(global.runner.suggestions().map(entry => entry.text)).toEqual(['喜欢短回答'])
  })

  it('位置受保护：不写，条目留给用户', async () => {
    const s = stage({ protection: () => 'chat-only workspace (home)' })
    const record = await s.runner.summarize(s.id, false)
    expect(record.status).toBe('protected')
    expect(record.pending).toEqual(['项目用 pnpm 管理依赖'])
    expect(existsSync(s.memoryPath)).toBe(false)
  })

  it('写了文件、记录没写成：重试认出来源标记，不重复写', async () => {
    const s = stage({ scripts: [{ text: 'PROJECT: 第一次' }, { text: 'PROJECT: 换了个说法' }] })
    const first = await s.runner.summarize(s.id, false)
    rmSync(join(s.home, 'deepseekgui', 'archive-memory', `${s.id}.json`))
    const second = await s.runner.summarize(s.id, false)
    expect(second.status).toBe('written')
    expect(second.added).toEqual([])
    expect(readFileSync(s.memoryPath, 'utf8')).not.toContain('换了个说法')
    expect(second.processedThroughSeq).toBe(first.processedThroughSeq)
  })

  it('长会话恢复后只多一轮：整段达标，照样整理新增部分', async () => {
    const s = stage({ scripts: [{ text: 'PROJECT: 一' }, { text: 'PROJECT: 新决定' }] })
    await s.runner.summarize(s.id, false)
    const e = eventFactory()
    const more = [...longSession(), e.turnStart(), e.user('最后决定用 Node 24'), e.assistant('好'), e.turnEnd()]
    s.setEvents(renumber(more))
    const record = await s.runner.summarize(s.id, false)
    expect(record.status).toBe('written')
    expect(JSON.stringify(s.seen[1]!.messages)).toContain('Node 24')
    expect(JSON.stringify(s.seen[1]!.messages)).not.toContain('第0句')
  })

  it('同一项目两个会话同时整理：串行写入，两边的条目都在', async () => {
    const s = stage({ scripts: [{ text: 'PROJECT: 甲' }, { text: 'PROJECT: 乙' }] })
    const [a, b] = await Promise.all([s.runner.summarize(s.id, false), s.runner.summarize(brandSessionId('session-2'), false)])
    expect([a.status, b.status]).toEqual(['written', 'written'])
    const text = readFileSync(s.memoryPath, 'utf8')
    expect(text).toContain('- 甲')
    expect(text).toContain('- 乙')
  })

  it('卸载时取消在途整理：记 cancelled，不写文件', async () => {
    const s = stage({ scripts: [{ hang: true }] })
    const pending = s.runner.summarize(s.id, false)
    await new Promise(resolve => setTimeout(resolve, 20))
    await s.runner.dispose()
    expect((await pending).status).toBe('cancelled')
    expect(existsSync(s.memoryPath)).toBe(false)
  })

  it('读会话失败：会话不在了记 gone，其余记 failed（可重试）', async () => {
    const gone = stage({ observe: async () => { throw new Error('session/not-found') }, isGone: () => true })
    expect((await gone.runner.summarize(gone.id, false)).status).toBe('gone')
    const flaky = stage({ observe: async () => { throw new Error('EBUSY') } })
    expect((await flaky.runner.summarize(flaky.id, false)).status).toBe('failed')
  })
})

describe('ArchiveMemoryRunner 其它状态', () => {
  it('首次说明没看过：归档只记 needs-consent，不调用模型；看过之后自动整理', async () => {
    const s = stage()
    s.runner.onArchived(s.id)
    expect(s.runner.record(s.id)?.status).toBe('needs-consent')
    expect(s.seen).toHaveLength(0)
    s.runner.saveSettings({ noticeSeen: true })
    s.runner.onArchived(s.id)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(s.seen).toHaveLength(1)
  })

  it('上次进行中、本进程没在跑：报告 interrupted', () => {
    const s = stage()
    const dir = join(s.home, 'deepseekgui', 'archive-memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ schemaVersion: 1, sessionId: s.id, status: 'running', manual: false, processedThroughSeq: -1, startedAt: 'x' }))
    expect(s.runner.record(s.id)?.status).toBe('interrupted')
  })

  it('坏记录不当成进度', () => {
    const s = stage()
    const dir = join(s.home, 'deepseekgui', 'archive-memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ schemaVersion: 1, sessionId: s.id, status: 'written', processedThroughSeq: 'lots' }))
    expect(s.runner.record(s.id)).toBeNull()
  })

  it('建议列表满了：不再加，记录写明丢了几条；拿掉一条后能再加', async () => {
    const s = stage({ scripts: [{ text: 'GLOBAL: 新偏好' }] })
    const path = join(s.home, 'deepseekgui', 'memory-suggestions.json')
    mkdirSync(join(s.home, 'deepseekgui'), { recursive: true })
    writeFileSync(path, JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ id: `id-${String(index)}`, text: `旧${String(index)}`, sessionId: 'x', at: 'x' }))))
    const record = await s.runner.summarize(s.id, false)
    expect(record.suggestionsDropped).toBe(1)
    expect(await s.runner.resolveSuggestion('id-0')).toBe(true)
    expect(s.runner.suggestions()).toHaveLength(49)
  })
})

/** 重新连续编号（两段事件拼起来时 seq 要单调）。 */
function renumber(events: SessionEvent[]): SessionEvent[] {
  const e = eventFactory()
  return events.map((event) => {
    if (event.type === 'user/message') return e.user(event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''))
    if (event.type === 'assistant/message') return e.assistant(event.data.message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''))
    if (event.type === 'turn/start') return e.turnStart()
    return e.turnEnd()
  })
}
