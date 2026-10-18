/**
 * 归档整理的执行面（Phase 2，2026-10-05；Sol 审查后返工）。纯逻辑在 archive-memory.ts。
 *
 * 一次整理：读会话日志 → 判断 → 一次不带工具的 `ctx.llm.stream()`（模型只回文字，结束原因必须
 * 是 stop）→ 严格解析 → 项目位置过一遍现有的保护规则 → 在项目级串行下读最新文件、合并、写前
 * 再比对、原子写回 → 全局建议另存，等用户确认 → 写记录。只有 written / none 推进已处理边界，
 * 其余结果都可以原样重试。
 *
 * 记录与建议都在 `<DSH_HOME>/deepseekgui/` 下，会话日志一个字不加（莉莉丝 2026-10-05 定）：
 * - `archive-memory/<sessionId>.json`：整理到哪一 seq、结果、模型、材料范围、当时给模型的项目记忆。
 * - `archive-memory/settings.json`：自动整理开关、首次说明是否看过（没看过就不自动调用模型）。
 * - `memory-suggestions.json`：等用户确认的全局记忆建议。**只由本进程读写**（Sol P2-04）：桌面
 *   主进程不碰这个文件，用户加入建议时走既有的全局记忆保存命令写 memory.md，再经 RPC 让这里删条目。
 *
 * 不常驻、不自动重试：失败就记下，等用户在记忆页手动重试。卸载时停止在途整理并等待它收尾。
 * @module @deepseek-ai/dsh-workbench-inspector/archive-memory-runner
 */

import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import {
  boundMemory,
  boundTranscript,
  DEFAULT_LIMITS,
  eligibilityOf,
  mergeIntoProjectMemory,
  parseSummary,
  requestBudget,
  sourceTag,
  summaryRequestText,
  SUMMARY_SYSTEM,
  transcriptOf,
  codePoints,
  type ArchiveMemoryLimits,
} from './archive-memory.ts'
import { ARCHIVE_MEMORY_STATUSES, projectMemoryFileName } from './types.ts'
import type { ArchiveMemoryRecord, ArchiveMemorySettings, ArchiveMemoryStatus, MemorySuggestion } from './types.ts'

/** 整理调用的输出上限（token）。八条一句话的记忆用不了这么多，留足余量即可。 */
const SUMMARY_MAX_TOKENS = 2_000
/** 一次整理调用最长等多久。 */
const SUMMARY_TIMEOUT_MS = 120_000
/** 全局建议最多攒多少条；满了不再加，并在记录里写明丢了几条（不悄悄当成处理完）。 */
const MAX_SUGGESTIONS = 50

/** 宿主 llm 服务里这里用到的两件事：按路由查模型容量、发一次流式请求。 */
export type LlmService = Pick<Context['llm'], 'stream' | 'resolveModelInfo'>

/** 读到的一段会话：事件、工作区、这段会话最后一次请求用的模型路由。 */
export interface ObservedSession {
  readonly events: readonly SessionEvent[]
  readonly cwd: string | undefined
  /** 最后一个 `request/header` 里的 provider/model（与官方起标题的取法一致）；没有为 undefined。 */
  readonly route: { readonly provider: string; readonly model: string } | undefined
}

/**
 * 从会话事件取最后一次请求的模型路由。
 * @param events - 会话事件。
 * @returns 路由，或 undefined。
 */
export function routeOf(events: readonly SessionEvent[]): ObservedSession['route'] {
  const header = events.findLast((event): event is SessionEvent<'request/header'> => event.type === 'request/header')
  return header === undefined ? undefined : { provider: header.data.header.config.provider, model: header.data.header.config.model }
}

/** 执行面需要的宿主能力。 */
export interface ArchiveMemoryDeps {
  /** DSH_HOME；没有就整个功能不工作。 */
  readonly home: () => string | undefined
  /** 经校验的预算与门槛。 */
  readonly limits: () => ArchiveMemoryLimits
  /** 读一段会话：事件与 cwd。 */
  readonly observe: (sessionId: SessionId, signal: AbortSignal) => Promise<ObservedSession>
  /** 读会话失败时，是不是「会话已经不在了」（其余读失败按可重试的 failed 处理）。 */
  readonly isGone: (error: unknown) => boolean
  /** llm 服务；没有挂载时为 undefined。 */
  readonly llm: () => LlmService | undefined
  /**
   * 现有的位置保护规则（Sol P2-01）：仅聊天目录、系统/应用/GUI 位置、管理员令牌运行等。
   * 返回拒绝原因；undefined = 普通项目，可以自动写。
   */
  readonly protection: (cwd: string, projectPath: string) => string | undefined
  readonly log: (line: string) => void
}

/** 原子写：先写同目录临时文件再改名，崩在中间原文件不受影响。 */
function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, text, 'utf8')
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** 会话 id 只允许安全字符，免得被拼进路径里走出目录。 */
function safeId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) throw new Error(`invalid session id: ${sessionId}`)
  return sessionId
}

/** 记录文件的最低校验：形状不对就当没有，绝不拿来推进进度（Sol：不信无校验的强转）。 */
function validRecord(raw: unknown, sessionId: string): ArchiveMemoryRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Partial<ArchiveMemoryRecord>
  if (record.schemaVersion !== 1 || record.sessionId !== sessionId) return null
  if (typeof record.status !== 'string' || !ARCHIVE_MEMORY_STATUSES.includes(record.status)) return null
  if (typeof record.processedThroughSeq !== 'number' || !Number.isInteger(record.processedThroughSeq) || record.processedThroughSeq < -1) return null
  if (typeof record.manual !== 'boolean' || typeof record.startedAt !== 'string') return null
  return record as ArchiveMemoryRecord
}

function validSuggestions(raw: unknown): MemorySuggestion[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is MemorySuggestion => typeof entry === 'object' && entry !== null
    && typeof (entry as MemorySuggestion).id === 'string' && typeof (entry as MemorySuggestion).text === 'string'
    && typeof (entry as MemorySuggestion).sessionId === 'string' && typeof (entry as MemorySuggestion).at === 'string')
}

/** 材料里有没有中文：决定整理区标题用哪种语言。 */
function looksChinese(text: string): boolean {
  return /[㐀-鿿]/u.test(text)
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** 一个在途整理。 */
interface Job {
  readonly promise: Promise<ArchiveMemoryRecord>
  readonly controller: AbortController
}

/** 执行面。 */
export class ArchiveMemoryRunner {
  private readonly jobs = new Map<string, Job>()
  /** 项目级串行：两个会话同时整理同一个项目时，一个写完另一个再读最新文件。 */
  private readonly projectLocks = new Map<string, Promise<unknown>>()
  /** 建议文件的串行：本进程是它唯一的写入者，读改写在这条链上排队。 */
  private suggestionChain: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(private readonly deps: ArchiveMemoryDeps) {}

  private dir(): string | undefined {
    const home = this.deps.home()
    return home === undefined ? undefined : join(home, 'deepseekgui', 'archive-memory')
  }

  /** 开关与首次说明。默认开，但首次说明没看过之前不会自动调用模型。 */
  settings(): ArchiveMemorySettings {
    const dir = this.dir()
    const saved = dir === undefined ? null : readJson(join(dir, 'settings.json'))
    const record = typeof saved === 'object' && saved !== null ? saved as Partial<ArchiveMemorySettings> : {}
    return { auto: record.auto !== false, noticeSeen: record.noticeSeen === true }
  }

  saveSettings(next: Partial<ArchiveMemorySettings>): ArchiveMemorySettings {
    const dir = this.dir()
    if (dir === undefined) throw new Error('DSH_HOME is not set')
    const merged = { ...this.settings(), ...next }
    atomicWrite(join(dir, 'settings.json'), `${JSON.stringify(merged, null, 2)}\n`)
    return merged
  }

  /**
   * 一段会话的整理记录；没有就是 null。上次进行中、但本进程里没有在跑的 → 进程中断过，
   * 记成 interrupted（进度不动，可手动重试）。
   */
  record(sessionId: string): ArchiveMemoryRecord | null {
    const dir = this.dir()
    if (dir === undefined) return null
    const record = validRecord(readJson(join(dir, `${safeId(sessionId)}.json`)), sessionId)
    if (record?.status === 'running' && !this.jobs.has(sessionId)) {
      const interrupted: ArchiveMemoryRecord = { ...record, status: 'interrupted', finishedAt: new Date().toISOString() }
      this.writeRecord(interrupted)
      return interrupted
    }
    return record
  }

  private writeRecord(record: ArchiveMemoryRecord): void {
    const dir = this.dir()
    if (dir === undefined) return
    atomicWrite(join(dir, `${safeId(record.sessionId)}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }

  private suggestionsPath(): string | undefined {
    const home = this.deps.home()
    return home === undefined ? undefined : join(home, 'deepseekgui', 'memory-suggestions.json')
  }

  /** 等用户确认的全局建议。 */
  suggestions(): MemorySuggestion[] {
    const path = this.suggestionsPath()
    return path === undefined ? [] : validSuggestions(readJson(path))
  }

  private onSuggestions<T>(work: () => T): Promise<T> {
    const next = this.suggestionChain.catch(() => undefined).then(work)
    this.suggestionChain = next
    return next
  }

  /** 追加建议；返回没放进去的条数（列表满了）。 */
  private addSuggestions(sessionId: string, texts: readonly string[]): Promise<number> {
    return this.onSuggestions(() => {
      const path = this.suggestionsPath()
      if (path === undefined || texts.length === 0) return 0
      const list = this.suggestions()
      const known = new Set(list.map(entry => entry.text))
      let dropped = 0
      for (const text of texts) {
        if (known.has(text)) continue
        if (list.length >= MAX_SUGGESTIONS) { dropped++; continue }
        known.add(text)
        list.push({ id: randomUUID(), text, sessionId, at: new Date().toISOString() })
      }
      atomicWrite(path, `${JSON.stringify(list, null, 2)}\n`)
      return dropped
    })
  }

  /**
   * 处理一条建议：用户加入（桌面已经写好 memory.md）或忽略，都从列表里拿掉。
   * @param id - 建议 id。
   * @returns 是否找到并拿掉了。
   */
  resolveSuggestion(id: string): Promise<boolean> {
    return this.onSuggestions(() => {
      const path = this.suggestionsPath()
      if (path === undefined) return false
      const list = this.suggestions()
      const next = list.filter(entry => entry.id !== id)
      if (next.length === list.length) return false
      atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`)
      return true
    })
  }

  /**
   * 归档后的自动入口：开关关着就不做；首次说明还没看过就只记 needs-consent，不调用模型。
   * 监听器里绝不抛错（归档已经落盘，不能因为这里让归档看起来失败）。
   */
  onArchived(sessionId: string): void {
    try {
      const settings = this.settings()
      if (!settings.auto || this.disposed) return
      if (!settings.noticeSeen) {
        const previous = this.record(sessionId)
        this.writeRecord({
          schemaVersion: 1, sessionId, status: 'needs-consent', manual: false,
          processedThroughSeq: previous?.processedThroughSeq ?? -1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        })
        return
      }
      void this.summarize(sessionId as SessionId, false).catch((error: unknown) => {
        this.deps.log(`archive memory for ${sessionId} failed: ${String(error instanceof Error ? error.message : error)}`)
      })
    } catch (error) {
      this.deps.log(`archive memory for ${sessionId} was not started: ${String(error instanceof Error ? error.message : error)}`)
    }
  }

  /**
   * 整理一段会话。同一段会话同时只跑一次（双击、重复归档都合到这一次）。
   * @param sessionId - 会话 id。
   * @param manual - 用户手动发起：不看长度门槛。
   * @param signal - 调用方的取消（手动 RPC 的取消会停掉这一次）。
   * @returns 本次的记录。
   */
  summarize(sessionId: SessionId, manual: boolean, signal?: AbortSignal): Promise<ArchiveMemoryRecord> {
    safeId(sessionId)
    if (this.disposed) return Promise.reject(new Error('archive memory is shutting down'))
    const existing = this.jobs.get(sessionId)
    if (existing !== undefined) return existing.promise
    const controller = new AbortController()
    const signals = [controller.signal, AbortSignal.timeout(SUMMARY_TIMEOUT_MS), ...signal === undefined ? [] : [signal]]
    const promise = this.perform(sessionId, manual, AbortSignal.any(signals))
      .finally(() => { this.jobs.delete(sessionId) })
    this.jobs.set(sessionId, { promise, controller })
    return promise
  }

  isRunning(sessionId: string): boolean {
    return this.jobs.has(sessionId)
  }

  /** 卸载：停掉在途整理并等它们收尾（收尾会把结果记成 cancelled，且不再写项目记忆）。 */
  async dispose(): Promise<void> {
    this.disposed = true
    const pending = [...this.jobs.values()]
    for (const job of pending) job.controller.abort(new Error('archive memory is shutting down'))
    await Promise.allSettled(pending.map(job => job.promise))
    await this.suggestionChain.catch(() => undefined)
  }

  private async withProjectLock<T>(path: string, work: () => Promise<T> | T): Promise<T> {
    const key = path.toLowerCase()
    const previous = this.projectLocks.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.projectLocks.set(key, next)
    try {
      return await next
    } finally {
      if (this.projectLocks.get(key) === next) this.projectLocks.delete(key)
    }
  }

  private async perform(sessionId: SessionId, manual: boolean, signal: AbortSignal): Promise<ArchiveMemoryRecord> {
    const previous = this.record(sessionId)
    const processed = previous?.processedThroughSeq ?? -1
    const startedAt = new Date().toISOString()
    const base = { schemaVersion: 1 as const, sessionId, manual, startedAt, processedThroughSeq: processed }
    const finish = (status: ArchiveMemoryStatus, extra: Partial<ArchiveMemoryRecord> = {}): ArchiveMemoryRecord => {
      const record: ArchiveMemoryRecord = { ...base, ...extra, status, finishedAt: new Date().toISOString() }
      this.writeRecord(record)
      return record
    }
    const cancelledOr = (status: ArchiveMemoryStatus): ArchiveMemoryStatus => (signal.aborted ? 'cancelled' : status)
    if (this.deps.home() === undefined) throw new Error('DSH_HOME is not set')
    const limits = this.deps.limits()

    let observed: ObservedSession
    try {
      observed = await this.deps.observe(sessionId, signal)
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      return finish(this.deps.isGone(error) ? 'gone' : cancelledOr('failed'), { error: message })
    }
    const fresh = transcriptOf(observed.events, processed)
    const whole = transcriptOf(observed.events)
    const input = {
      userTurns: fresh.userTurns, chars: fresh.chars, throughSeq: fresh.throughSeq,
      wholeUserTurns: whole.userTurns, wholeChars: whole.chars,
    }
    const eligibility = eligibilityOf(fresh, whole, manual, limits)
    if (eligibility !== 'ok') return finish(eligibility, { input })

    const cwd = observed.cwd
    if (cwd === undefined || !existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return finish('no-project', { input, ...cwd === undefined ? {} : { cwd } })
    }
    const projectPath = join(cwd, projectMemoryFileName(cwd))
    const llm = this.deps.llm()
    const route = observed.route
    if (route === undefined || llm === undefined) return finish('no-model', { input, cwd, projectPath })

    this.writeRecord({ ...base, status: 'running', input, cwd, projectPath, route })
    const readProject = (): string | null => {
      try {
        return existsSync(projectPath) ? readFileSync(projectPath, 'utf8') : ''
      } catch {
        return null
      }
    }
    const before = readProject()
    if (before === null) return finish('failed', { input, cwd, projectPath, route, error: 'project memory file could not be read' })

    // 预算：配置上限按模型上下文再收紧；记忆与材料各自有界，系统提示先扣掉。
    let contextWindow: number | undefined
    try {
      contextWindow = (await llm.resolveModelInfo(route.provider, route.model, signal)).context?.contextWindow
    } catch {
      contextWindow = undefined
    }
    const budget = requestBudget(limits, contextWindow)
    const memory = boundMemory(before, Math.min(limits.maxMemoryChars, Math.floor(budget / 3)))
    const room = budget - codePoints(SUMMARY_SYSTEM) - codePoints(memory.text) - 200
    const transcriptRoom = Math.max(1_000, Math.min(limits.maxTranscriptChars, room))
    const zh = looksChinese(fresh.lines.map(line => line.text).join(''))
    const bounded = boundTranscript(fresh, transcriptRoom, zh
      ? { user: '用户', assistant: '助手', clipped: '（前面部分太长，已省略）' }
      : { user: 'User', assistant: 'Assistant', clipped: '(the beginning was too long and is omitted)' })
    const coverage = { fromSeq: bounded.fromSeq, throughSeq: fresh.throughSeq, complete: bounded.complete, chars: bounded.chars }
    const memoryInput = { sha256: sha256(before), chars: codePoints(before), complete: memory.complete, text: memory.text }
    const common = { input, coverage, memoryInput, budgetChars: budget, cwd, projectPath, route }

    // 一次不带工具的请求：tools 字段根本不传，也不进 agent 循环。结束原因必须是 stop：
    // 提出工具调用、截断、出错、取消都不算完成。
    let output = ''
    let finishKind = 'none'
    try {
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        system: SUMMARY_SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: summaryRequestText(bounded, memory, processed >= 0) }] }],
        maxTokens: SUMMARY_MAX_TOKENS,
        sessionId,
        signal,
      })) {
        if (chunk.type === 'text-delta') output += chunk.text
        else if (chunk.type === 'finish') finishKind = chunk.reason.kind
      }
    } catch (error) {
      return finish(cancelledOr('failed'), { ...common, output, error: String(error instanceof Error ? error.message : error) })
    }
    if (signal.aborted) return finish('cancelled', { ...common, output, finish: finishKind })
    if (finishKind !== 'stop') return finish('invalid', { ...common, output, finish: finishKind, error: `the model finished with ${finishKind}` })

    const parsed = parseSummary(output, limits)
    // 一行都认不出、又没说 NONE：空回复、一段说明文字、全是乱格式——无效，不推进进度。
    if (parsed.recognized === 0 && !parsed.none) {
      return finish('invalid', { ...common, output, finish: finishKind, rejected: parsed.rejected, error: 'the model output had no recognizable line' })
    }
    const dropped = await this.addSuggestions(sessionId, parsed.global)
    const withOutput = {
      ...common, output, finish: finishKind, rejected: parsed.rejected, suggestions: parsed.global,
      ...dropped > 0 ? { suggestionsDropped: dropped } : {},
    }
    if (parsed.project.length === 0) {
      // 认出了行但项目条目一条不剩：要么模型说 NONE / 只给了全局建议（有效），要么全被过滤掉（无效）。
      const valid = parsed.none || parsed.global.length > 0
      return valid
        ? finish('none', { ...withOutput, processedThroughSeq: fresh.throughSeq })
        : finish('invalid', { ...withOutput, error: 'every line was rejected' })
    }
    const pending = parsed.project.map(item => item.text)

    // 位置保护（Sol P2-01）：沿用现有的仅聊天 / 受保护位置规则，再核真实路径、链接与可写。
    const blocked = this.deps.protection(cwd, projectPath)
    if (blocked !== undefined) return finish('protected', { ...withOutput, pending, error: blocked })

    const tag = sourceTag(sessionId, fresh.throughSeq)
    const date = new Date().toISOString().slice(0, 10)
    const heading = zh
      ? { title: '## 归档整理（自动）', note: '> 由 DeepSeekGUI 在会话归档时整理。可以直接修改或删除；标「待核实」的是对话里没明确确认的。', toVerify: '（待核实）', superseded: '（已被后来的决定取代）', date: `**${date}**` }
      : { title: '## Archive notes (automatic)', note: '> Collected by DeepSeekGUI when a session was archived. Edit or delete freely; items marked "(to verify)" were not explicitly confirmed.', toVerify: '(to verify) ', superseded: '(superseded by a later decision)', date: `**${date}**` }
    return await this.withProjectLock(projectPath, () => {
      if (signal.aborted) return finish('cancelled', { ...withOutput, pending })
      // 写之前读最新文件：会话开头缓存的旧文本绝不拿来覆盖。
      const latest = readProject()
      if (latest === null) return finish('failed', { ...withOutput, pending, error: 'project memory file could not be read' })
      const merged = mergeIntoProjectMemory(latest, parsed.project, tag, heading, limits)
      if (merged.kind === 'already') return finish('written', { ...withOutput, processedThroughSeq: fresh.throughSeq, added: [] })
      if (merged.kind === 'nothing-new') return finish('none', { ...withOutput, processedThroughSeq: fresh.throughSeq })
      if (merged.kind === 'full') return finish('full', { ...withOutput, pending })
      if (merged.kind === 'malformed') return finish('malformed', { ...withOutput, pending })
      // 写前再比一次原文：读完到写之前文件被别处改了（编辑框保存、外部编辑器），就不写，记冲突。
      // 这只缩小了窗口、不是跨进程的原子比较；外部改动落在这之后的极短间隙仍可能被覆盖，记录里如实说。
      if (readProject() !== latest) return finish('conflict', { ...withOutput, pending })
      try {
        atomicWrite(projectPath, merged.text)
      } catch (error) {
        return finish('failed', { ...withOutput, pending, error: String(error instanceof Error ? error.message : error) })
      }
      return finish('written', {
        ...withOutput,
        processedThroughSeq: fresh.throughSeq,
        added: merged.added.map(line => line.replace(/\s*<!--.*?-->\s*$/u, '').replace(/^-\s*/u, '')),
        ...merged.superseded.length > 0 ? { superseded: merged.superseded } : {},
      })
    })
  }
}

/**
 * 项目记忆文件的真实位置检查（protection 的一部分，与位置分类规则一起用）：
 * 工作区真实路径必须是目录且可写；记忆文件若已存在不能是链接，也不能经链接落到工作区之外。
 * @param cwd - 会话工作区。
 * @param projectPath - 项目记忆文件。
 * @returns 拒绝原因，或 undefined。
 */
export function projectFileProblem(cwd: string, projectPath: string): string | undefined {
  try {
    const realCwd = realpathSync(cwd)
    if (existsSync(projectPath)) {
      if (lstatSync(projectPath).isSymbolicLink()) return `the project memory file is a link: ${projectPath}`
      const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value)
      if (fold(dirname(realpathSync(projectPath))) !== fold(realCwd)) return `the project memory file resolves outside the workspace: ${projectPath}`
    }
    accessSync(realCwd, constants.W_OK)
    return undefined
  } catch (error) {
    return `the workspace is not writable: ${String(error instanceof Error ? error.message : error)}`
  }
}

export { DEFAULT_LIMITS }
