/** On-demand, read-only Workbench queries over the composed filesystem and Git providers. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-git'
import type { DiffResult, DiffScope } from '@deepseek-ai/dsh-git/types'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { projectMemoryFileName, type WorkbenchFileText, type WorkbenchMemory, type WorkbenchOverview, type WorkbenchRepository, type WorkbenchWorktree } from './types.ts'

export type * from './types.ts'
export { projectMemoryFileName } from './types.ts'

/** Deployment bounds for inspection responses. */
export interface Config {
  /** Newest commits returned by the overview. */
  logLimit: number
  /** Inclusive UTF-8 byte limit for file text and Git patches. */
  maxTextBytes: number
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

/** Read-only Remote namespace; no Session events, model requests, or writes. */
export class WorkbenchInspector extends TypertRemoteService {
  static inject = ['fs', 'git', 'typert', 'sessionQuery']
  static Config: Schema<Config> = Schema.object({
    logLimit: Schema.natural().min(1).default(30),
    maxTextBytes: Schema.natural().min(1).default(512 * 1024),
  })

  /**
   * @param ctx - Composed host providers.
   * @param config - Validated response bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workbenchInspector', { namespace: 'workbenchInspector' })
  }

  private async cwd(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    const cwd = observation.header.cwd
    if (cwd === undefined) throw new Error('inspection requires a Session working directory')
    return cwd
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
    const root = repository ? (await this.ctx.git.repoIdentity(cwd)).root : cwd
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
    const identity = await this.ctx.git.repoIdentity(await this.cwd(sessionId, signal))
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
    const root = (await this.ctx.git.repoIdentity(await this.cwd(sessionId, signal))).root
    if (path !== '') await this.target(root, path, signal)
    const value = await this.ctx.git.diff(root, scope, path === '' ? undefined : path, true, this.config.maxTextBytes)
    signal.throwIfAborted()
    return value
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
    const identity = await this.ctx.git.repoIdentity(await this.cwd(sessionId, signal))
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
      if (current) {
        changedPaths = status.entries.map(entry => entry.path)
      } else if (!tree.bare) {
        const other = await this.ctx.git.status(tree.path).catch(() => undefined)
        changedPaths = other?.entries.map(entry => entry.path) ?? []
      }
      signal.throwIfAborted()
      worktrees.push({ ...tree, current, changedPaths })
    }
    return { root: identity.root, status, remotes, commits, worktrees }
  }
}

export default WorkbenchInspector
