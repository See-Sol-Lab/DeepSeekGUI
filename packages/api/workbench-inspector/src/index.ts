/** Workbench queries and desktop-authorized Session deletion. */
import type { Context } from '@deepseek-ai/cordis'
import { verify } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-git'
import type { DiffResult, DiffScope } from '@deepseek-ai/dsh-git/types'
import Schema from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { installDesktopAccountBridge } from './desktop-account.ts'
import { renderSessionMarkdown, untitledSessionTitle } from './session-markdown.ts'
import { ArchiveMemoryRunner, projectFileProblem, routeOf } from './archive-memory-runner.ts'
import { DEFAULT_LIMITS, type ArchiveMemoryLimits } from './archive-memory.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-workspace'
import { chatOnlyReason, isElevatedHost, zoneOfPath } from '@deepseek-ai/dsh-sandbox'
import { projectMemoryFileName, type ArchiveMemoryRecord, type MemoryInjection, type MemorySuggestion, type WorkbenchArchiveMemory, type WorkbenchExportLanguage, type WorkbenchExportMarkdown, type WorkbenchFileText, type WorkbenchLastReply, type WorkbenchMemory, type WorkbenchOverview, type WorkbenchRepository, type WorkbenchSandboxClean, type WorkbenchWorktree } from './types.ts'

export type * from './types.ts'
export { projectMemoryFileName } from './types.ts'
export { ACCOUNT_BRIDGE_ENV, type DesktopAccountFrame } from './desktop-account.ts'

/** Deployment bounds for inspection responses. */
export interface Config {
  /** Newest commits returned by the overview. */
  logLimit: number
  /** Inclusive UTF-8 byte limit for file text and Git patches. */
  maxTextBytes: number
  /** Inclusive UTF-8 byte limit for a rendered Markdown export. */
  maxExportBytes: number
  /** Archive notes budgets and thresholds (code points; see ArchiveMemoryLimits). */
  archiveMemory?: ArchiveMemoryLimits
}

/** Whether two git-reported paths name the same directory (git prints forward slashes; Windows is case-insensitive). */
function samePath(left: string, right: string): boolean {
  const norm = (value: string): string => {
    const slashes = value.replace(/\\/gu, '/').replace(/\/+$/u, '')
    return process.platform === 'win32' ? slashes.toLowerCase() : slashes
  }
  return norm(left) === norm(right)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Current read-only workspace and repository queries. */
    workbenchInspector: WorkbenchInspector
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * The Session's working directory is an ordinary folder, not inside a Git
     * repository. A normal state for the Changes and Git views, told apart
     * from a failed read by this code.
     */
    'workbench/not-a-repository': { readonly cwd: string }
  }
}

/** Read-only workspace inspection plus desktop-authorized Session deletion. */
export class WorkbenchInspector extends TypertRemoteService {
  static inject = ['fs', 'git', 'typert', 'sessionQuery', 'sessionController']
  static Config: Schema<Config> = Schema.object({
    logLimit: Schema.natural().min(1).default(30),
    maxTextBytes: Schema.natural().min(1).default(512 * 1024),
    maxExportBytes: Schema.natural().min(1).default(20 * 1024 * 1024),
    // 归档整理的预算与门槛：经过校验的配置，默认值是起点、不是统计校准过的数。
    archiveMemory: Schema.object({
      autoMinUserTurns: Schema.natural().min(1).default(DEFAULT_LIMITS.autoMinUserTurns),
      autoMinChars: Schema.natural().min(1).default(DEFAULT_LIMITS.autoMinChars),
      maxTranscriptChars: Schema.natural().min(1_000).default(DEFAULT_LIMITS.maxTranscriptChars),
      maxMemoryChars: Schema.natural().min(1_000).default(DEFAULT_LIMITS.maxMemoryChars),
      maxRequestChars: Schema.natural().min(4_000).default(DEFAULT_LIMITS.maxRequestChars),
      maxProjectItems: Schema.natural().min(1).max(20).default(DEFAULT_LIMITS.maxProjectItems),
      maxGlobalItems: Schema.natural().max(10).default(DEFAULT_LIMITS.maxGlobalItems),
      maxItemChars: Schema.natural().min(20).default(DEFAULT_LIMITS.maxItemChars),
      maxBatchChars: Schema.natural().min(100).default(DEFAULT_LIMITS.maxBatchChars),
      autoAreaMaxChars: Schema.natural().min(500).default(DEFAULT_LIMITS.autoAreaMaxChars),
    }).default({ ...DEFAULT_LIMITS }),
  })

  /**
   * @param ctx - Composed host providers.
   * @param config - Validated response bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workbenchInspector', { namespace: 'workbenchInspector' })
    ctx.on('session/deletion-authorize', (sessionId, signature) => {
      const publicKey = process.env.DEEPSEEKGUI_SESSION_DELETE_PUBLIC_KEY
      const home = process.env.DSH_HOME
      return publicKey !== undefined && home !== undefined
        && verify(null, Buffer.from(`${home}\0${sessionId}`), publicKey, Buffer.from(signature, 'base64'))
    })
    // Official account UI inside the DeepSeekGUI window (inert outside it).
    installDesktopAccountBridge(ctx)
    // The sandbox provider is optional and read structurally: only the local
    // provider on Windows can clean ACL marks (cleanSandboxMarks).
    ctx.inject(['sandbox'], (sandboxCtx) => {
      this.sandbox = sandboxCtx.get('sandbox')
      sandboxCtx.effect(() => () => { this.sandbox = undefined })
    })
    // 归档整理（Phase 2）：llm 服务可选挂载；没有它时整理记为 no-model。
    ctx.inject(['llm'], (llmCtx) => {
      this.llm = llmCtx.llm
      llmCtx.effect(() => () => { this.llm = undefined })
    })
    this.archiveMemory = new ArchiveMemoryRunner({
      home: () => dshHome(),
      limits: () => this.config.archiveMemory ?? DEFAULT_LIMITS,
      observe: async (sessionId, signal) => {
        using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
        const events = [...observation.events]
        return { events, cwd: observation.header.cwd, route: routeOf(events) }
      },
      isGone: error => error instanceof RemoteError ? error.code === 'session/not-found' : /not found|does not exist/iu.test(String(error)),
      llm: () => this.llm,
      // 位置保护沿用现有规则：仅聊天目录（主目录、盘符根、系统/应用根）、受保护位置（系统、应用、
      // DeepSeekGUI 自己的代码）、管理员令牌运行（这些写入本来就要逐次批准），再核真实路径与可写。
      protection: (cwd, projectPath) => {
        const chatOnly = chatOnlyReason(cwd)
        if (chatOnly !== undefined) return `chat-only workspace (${chatOnly})`
        const zone = zoneOfPath(projectPath)
        if (zone !== undefined) return `protected location (${zone})`
        if (isElevatedHost()) return 'the desktop runs with an administrator token; file changes need approval'
        return projectFileProblem(cwd, projectPath)
      },
      log: (line) => { ctx.logger.warn(line) },
    })
    // 卸载：停掉在途整理并等它们收尾（不再写项目记忆）。
    ctx.effect(() => () => this.archiveMemory.dispose(), 'workbench inspector: archive memory')
    // 官方归档写入之后由工作区注册表发出（本仓库加的事件）。界面、接口的每一个归档入口都经过
    // 注册表，所以都走这同一个收尾；监听器自己不抛错。
    ctx.on('workspace/session-archived', (sessionId) => { this.archiveMemory.onArchived(sessionId) })
  }

  /** The mounted llm service, when there is one. */
  private llm: Context['llm'] | undefined

  /** 归档整理的执行面。 */
  private readonly archiveMemory: ArchiveMemoryRunner

  /**
   * 记忆视图读的归档整理事实：开关、这段会话的整理记录、是否正在整理。
   * @param sessionId - 会话。
   * @param signal - Request cancellation.
   * @returns 归档整理事实。
   */
  @Remote
  archiveMemoryState(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchArchiveMemory> {
    // A then-callback keeps an aborted signal a rejection, never a synchronous throw.
    return Promise.resolve().then(() => {
      signal.throwIfAborted()
      return {
        settings: this.archiveMemory.settings(),
        record: this.archiveMemory.record(sessionId),
        running: this.archiveMemory.isRunning(sessionId),
      }
    })
  }

  /**
   * 手动整理一段会话（不看长度门槛）：短会话、上次失败、整理区清理之后都从这里再来一次。
   * 对仍在使用的会话也可以：只读、不带工具，不改会话本身。请求被取消（页面关闭）就停掉这一次。
   * @param sessionId - 会话。
   * @param signal - Request cancellation.
   * @returns 本次的记录。
   */
  @Remote
  async summarizeSession(sessionId: SessionId, signal: AbortSignal): Promise<ArchiveMemoryRecord> {
    signal.throwIfAborted()
    return await this.archiveMemory.summarize(sessionId, true, signal)
  }

  /**
   * 改归档整理的开关或标记首次说明已读。
   * @param auto - 归档时自动整理；null = 不改。
   * @param noticeSeen - 首次说明已读；null = 不改。
   * @param signal - Request cancellation.
   * @returns 改后的设置。
   */
  @Remote
  setArchiveMemorySettings(auto: boolean | null, noticeSeen: boolean | null, signal: AbortSignal): Promise<WorkbenchArchiveMemory['settings']> {
    return Promise.resolve().then(() => {
      signal.throwIfAborted()
      return this.archiveMemory.saveSettings({ ...auto === null ? {} : { auto }, ...noticeSeen === null ? {} : { noticeSeen } })
    })
  }

  /**
   * 等用户确认的全局记忆建议（来自归档整理）。
   * @param signal - Request cancellation.
   * @returns 建议列表。
   */
  @Remote
  memorySuggestions(signal: AbortSignal): Promise<MemorySuggestion[]> {
    return Promise.resolve().then(() => {
      signal.throwIfAborted()
      return this.archiveMemory.suggestions()
    })
  }

  /**
   * 从列表里拿掉一条建议：用户已经把它加进全局记忆（由桌面的全局记忆保存命令写入），或者忽略了它。
   * 建议文件只由本进程读写。
   * @param id - 建议 id。
   * @param signal - Request cancellation.
   * @returns 是否找到并拿掉了。
   */
  @Remote
  async resolveMemorySuggestion(id: string, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    return await this.archiveMemory.resolveSuggestion(id)
  }

  /**
   * 这段会话每次加载时带入了哪些记忆（见 MemoryInjection；最后一条是当前这次加载在用的）。
   * 没有记录就是 null：会话还没发过第一条，或是本功能之前的老会话。
   * @param sessionId - 会话。
   * @param signal - Request cancellation.
   * @returns 带入事实，或 null。
   */
  @Remote
  memoryInjection(sessionId: SessionId, signal: AbortSignal): Promise<MemoryInjection | null> {
    return Promise.resolve().then(() => {
      signal.throwIfAborted()
      return this.readMemoryInjection(sessionId)
    })
  }

  /** The recorded memory injection for one Session, read synchronously; see {@link memoryInjection}. */
  private readMemoryInjection(sessionId: SessionId): MemoryInjection | null {
    const home = dshHome()
    if (home === undefined || !/^[A-Za-z0-9_-]{1,128}$/u.test(sessionId)) return null
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(join(home, 'deepseekgui', 'memory-injections', `${sessionId}.json`), 'utf8'))
    } catch {
      return null
    }
    if (typeof raw !== 'object' || raw === null || !('entries' in raw) || !Array.isArray(raw.entries)) return null
    return { sessionId, entries: raw.entries }
  }

  /** The mounted sandbox provider, when there is one. */
  private sandbox: unknown

  /**
   * Remove the Windows ACL sandbox's marks from a folder the desktop user
   * chose (DeepSeekGUI 2026-09-29): its grant, the delete deny, and the Low
   * label that make programs started there run at Low integrity. The sandbox
   * provider picks the folder that actually carries them (the chosen one or
   * the ancestor they are inherited from) and refuses while a confined
   * command runs there.
   * @param path - Absolute folder path from the desktop's folder dialog.
   * @param signal - Request cancellation.
   * @returns what was done, and on which folder.
   */
  @Remote
  async cleanSandboxMarks(path: string, signal: AbortSignal): Promise<WorkbenchSandboxClean> {
    signal.throwIfAborted()
    const sandbox = this.sandbox
    if (typeof sandbox !== 'object' || sandbox === null || !('cleanWorkspaceMarks' in sandbox) || typeof sandbox.cleanWorkspaceMarks !== 'function') {
      return { status: 'unsupported', root: path }
    }
    const result: unknown = await Promise.resolve(Reflect.apply(sandbox.cleanWorkspaceMarks, sandbox, [path]))
    if (typeof result !== 'object' || result === null || !('status' in result) || !('root' in result) || typeof result.root !== 'string') {
      throw new Error('cleanSandboxMarks: the sandbox provider answered an unexpected shape')
    }
    const { status, root } = result
    if (status !== 'cleaned' && status !== 'clean' && status !== 'busy' && status !== 'unsupported') {
      throw new Error('cleanSandboxMarks: the sandbox provider answered an unexpected status')
    }
    return { status, root }
  }

  private async cwd(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    const cwd = observation.header.cwd
    if (cwd === undefined) throw new Error('inspection requires a Session working directory')
    // B6-3: a deleted workspace must read as "the folder is gone", never as
    // a Git failure or a confusing downstream "not found" on some subpath.
    const root = await this.ctx.fs.resolve(cwd, { signal })
    if (await this.ctx.fs.stat(root, signal) === undefined) {
      throw new Error(`workspace directory does not exist: ${cwd}`)
    }
    return cwd
  }

  /**
   * The Git identity of a Session folder. Only the confirmed "not inside a
   * repository" answer becomes the `workbench/not-a-repository` failure;
   * a missing git, a broken repository, or a permission error keep their own
   * message. Matched by error name because the class crosses package copies.
   * @param cwd - The Session working directory.
   * @returns the repository identity.
   */
  private async repoIdentity(cwd: string): ReturnType<Context['git']['repoIdentity']> {
    try {
      return await this.ctx.git.repoIdentity(cwd)
    } catch (error) {
      if (error instanceof Error && error.name === 'GitNotARepositoryError') {
        throw new RemoteError('workbench/not-a-repository', error.message, { cwd })
      }
      throw error
    }
  }

  private async target(rootPath: string, path: string, signal: AbortSignal): Promise<FsTarget> {
    const root = await this.ctx.fs.resolve(rootPath, { signal })
    const target = await this.ctx.fs.resolve(path, { cwd: rootPath, signal })
    if (!this.ctx.fs.contains(root, target)) throw new Error('inspection path is outside the selected root')
    return target
  }

  /**
   * Read complete bounded text using provider-owned decoding and binary rejection.
   * @param sessionId - Session whose recorded cwd anchors the read.
   * @param path - File relative to the selected root.
   * @param repository - Select the Session's Git root instead of cwd.
   * @param signal - Request cancellation.
   * @returns the file text; oversized or binary files fail explicitly.
   */
  @Remote
  async text(sessionId: SessionId, path: string, repository: boolean, signal: AbortSignal): Promise<WorkbenchFileText> {
    const cwd = await this.cwd(sessionId, signal)
    const root = repository ? (await this.repoIdentity(cwd)).root : cwd
    return { path, text: await this.readText(await this.target(root, path, signal), signal) }
  }

  private async readText(target: FsTarget, signal: AbortSignal): Promise<string> {
    let text = ''
    let bytes = 0
    for await (const chunk of await this.ctx.fs.streamText(target, signal)) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > this.config.maxTextBytes) throw new Error('file exceeds the configured text inspection limit')
      text += chunk
    }
    return text
  }

  /**
   * Read the project memory file (`<folder>.memory.md` in the Session cwd)
   * and whether the project has an AGENTS.md. A missing memory file is a
   * normal state ("no memory yet"), not a failure.
   * @param sessionId - Session whose recorded cwd anchors the read.
   * @param signal - Request cancellation.
   * @returns the cwd, the memory file name, its text or null, and the AGENTS.md presence.
   */
  @Remote
  async memory(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchMemory> {
    const cwd = await this.cwd(sessionId, signal)
    const fileName = projectMemoryFileName(cwd)
    const memoryTarget = await this.target(cwd, fileName, signal)
    const text = await this.ctx.fs.stat(memoryTarget, signal) === undefined ? null : await this.readText(memoryTarget, signal)
    const agents = await this.ctx.fs.stat(await this.target(cwd, 'AGENTS.md', signal), signal) !== undefined
    return { cwd, fileName, text, agents }
  }

  /**
   * Read current repository status without running a model or tool.
   * @param sessionId - Session whose recorded cwd anchors the read.
   * @param signal - Request cancellation.
   * @returns canonical Git status and root.
   */
  @Remote
  async status(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchRepository> {
    signal.throwIfAborted()
    const identity = await this.repoIdentity(await this.cwd(sessionId, signal))
    const status = await this.ctx.git.status(identity.root)
    signal.throwIfAborted()
    return { root: identity.root, status }
  }

  /**
   * Read the current patch for one path or the complete selected scope.
   * @param sessionId - Session whose recorded cwd anchors the read.
   * @param scope - Index or unstaged changes.
   * @param path - Repository-relative file; empty selects all changes.
   * @param signal - Request cancellation.
   * @returns the bounded provider diff; truncation is never silent.
   */
  @Remote
  async diff(sessionId: SessionId, scope: DiffScope, path: string, signal: AbortSignal): Promise<DiffResult> {
    signal.throwIfAborted()
    const root = (await this.repoIdentity(await this.cwd(sessionId, signal))).root
    if (path !== '') await this.target(root, path, signal)
    const value = await this.ctx.git.diff(root, scope, path === '' ? undefined : path, true, this.config.maxTextBytes)
    signal.throwIfAborted()
    return value
  }

  /**
   * The newest assistant reply of a Session and whether its turn has ended.
   * The desktop's feedback triage (#15) prompts a hidden session and polls
   * this; reading the log through the query service keeps it off the
   * streaming follow channel the desktop has no client for.
   * @param sessionId - the session to read.
   * @param signal - Request cancellation.
   * @returns the reply text (text blocks joined) and its completeness.
   */
  @Remote
  async lastReply(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchLastReply> {
    signal.throwIfAborted()
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    const events = observation.events
    const reply = events.findLast((event): event is SessionEvent<'assistant/message'> => event.type === 'assistant/message')
    if (reply === undefined) return { text: null, complete: false }
    const ended = events.findLast(event => event.type === 'turn/end')
    const complete = ended !== undefined && ended.seq > reply.seq
    const text = reply.data.message.content
      .flatMap(block => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    return { text: text === '' ? null : text, complete }
  }

  /**
   * Render one Session as a human-readable Markdown document (B8-P1). The
   * log is read through the query service — a running turn's newest events
   * may not be on disk yet — and folded by the pure renderer; no model is
   * called and nothing is sanitized. Compaction markers ride the raw log,
   * so pre-compaction messages are quoted as they happened.
   * @param sessionId - Session selected by the desktop user.
   * @param includeDetails - Whether tool calls and reasoning blocks ride along.
   * @param language - The desktop UI language for headings and labels.
   * @param signal - Request cancellation.
   * @returns the display title and the rendered document.
   * @throws when the rendered document exceeds `maxExportBytes`; the message
   * is the product's fixed user-facing sentence.
   */
  @Remote
  async exportMarkdown(
    sessionId: SessionId,
    includeDetails: boolean,
    language: WorkbenchExportLanguage,
    signal: AbortSignal,
  ): Promise<WorkbenchExportMarkdown> {
    signal.throwIfAborted()
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    const snapshot = await this.ctx.sessionQuery.readTitle(sessionId, signal)
    const title = snapshot?.title ?? untitledSessionTitle(language)
    const markdown = renderSessionMarkdown({
      title,
      ...observation.header.cwd === undefined ? {} : { cwd: observation.header.cwd },
      sessionId,
      events: observation.events,
      includeDetails,
      language,
      exportedAt: Date.now(),
    })
    if (Buffer.byteLength(markdown, 'utf8') > this.config.maxExportBytes) {
      // The desktop shows this message verbatim, in the export's language.
      throw new Error(language === 'zh'
        ? '会话过大，暂不支持导出为 Markdown，可改用官方的会话日志导出'
        : 'This session is too large to export as Markdown; use the official session log download instead')
    }
    return { title, markdown }
  }

  /**
   * Delegate authorized deletion to the Session owner, waiting for active work.
   * @param sessionId - Session selected by the desktop user.
   * @param signature - Desktop authorization bound to Home and Session ID.
   * @returns Completion of content deletion and its client announcement.
   */
  @Remote
  async deleteSession(sessionId: SessionId, signature: string): Promise<void> {
    await this.ctx.sessionController.deleteSession(sessionId, signature)
  }

  /**
   * Repository-level facts for the Git and Worktree views in one read:
   * status, configured remotes, the newest commits, and every registered
   * work tree with its own changed paths. Nothing is written; a work tree
   * whose status cannot be read reports no changed paths.
   * @param sessionId - Session whose recorded cwd anchors the read.
   * @param signal - Request cancellation.
   * @returns the read-only repository overview.
   */
  @Remote
  async overview(sessionId: SessionId, signal: AbortSignal): Promise<WorkbenchOverview> {
    signal.throwIfAborted()
    const identity = await this.repoIdentity(await this.cwd(sessionId, signal))
    const [status, remotes, commits, trees] = await Promise.all([
      this.ctx.git.status(identity.root),
      this.ctx.git.remotes(identity.root),
      this.ctx.git.log(identity.root, this.config.logLimit),
      this.ctx.git.worktrees(identity.root),
    ])
    signal.throwIfAborted()
    const worktrees: WorkbenchWorktree[] = []
    for (const tree of trees) {
      const current = samePath(tree.path, identity.root)
      let changedPaths: string[] = []
      let statusError: string | undefined
      if (current) {
        changedPaths = status.entries.map(entry => entry.path)
      } else if (!tree.bare) {
        const other = await this.ctx.git.status(tree.path).catch((error: unknown) => {
          statusError = error instanceof Error ? error.message : String(error)
          return undefined
        })
        changedPaths = other?.entries.map(entry => entry.path) ?? []
      }
      signal.throwIfAborted()
      worktrees.push({ ...tree, current, changedPaths, ...(statusError === undefined ? {} : { statusError }) })
    }
    return { root: identity.root, status, remotes, commits, worktrees }
  }
}

/** DSH_HOME（宿主进程的环境变量）。 */
function dshHome(): string | undefined {
  const home = process.env.DSH_HOME
  return home === undefined || home === '' ? undefined : home
}

export default WorkbenchInspector
