/** Read-only Workbench response values. */
import type { CommitInfo, RemoteInfo, RepoStatus, WorktreeInfo } from '@deepseek-ai/dsh-git/types'

/**
 * The project memory file name: `<folder name>.memory.md`. The folder prefix
 * keeps it visibly distinct from the global `memory.md` under the DSH home,
 * so neither the person nor the model confuses the two; the rule is
 * deterministic so the desktop, the prompt assembly, and the Memory view
 * agree on the path without any discovery.
 * @param cwd - Session working directory.
 * @returns the file name inside that directory.
 */
export function projectMemoryFileName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/u, '')
  const folder = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
  return `${folder === '' || /^[A-Za-z]:$/u.test(trimmed) ? 'project' : folder}.memory.md`
}

/** The project memory file and the project AGENTS.md presence, read from the Session cwd. */
export interface WorkbenchMemory {
  /** Session working directory. */
  cwd: string
  /** `<folder>.memory.md`, from {@link projectMemoryFileName}. */
  fileName: string
  /** Memory text; null when the file does not exist yet. */
  text: string | null
  /** Whether `AGENTS.md` exists in the working directory. */
  agents: boolean
}

/** Complete bounded text from a workspace or repository file. */
export interface WorkbenchFileText {
  path: string
  text: string
}

/** Current Git facts, with the repository root distinguished from Session cwd. */
export interface WorkbenchRepository {
  root: string
  status: RepoStatus
}

/** One registered work tree, with what is changed there and whether the Session lives in it. */
export interface WorkbenchWorktree extends WorktreeInfo {
  /** A failed status read is unknown, not a clean work tree. */
  statusError?: string
  /** True when the Session's repository root is this work tree. */
  current: boolean
  /**
   * Repository-relative paths changed in that work tree (staged, unstaged,
   * untracked, conflict); empty when clean, unreadable, or bare.
   */
  changedPaths: string[]
}

/**
 * The newest assistant reply of a Session, read for the desktop's feedback
 * triage (2026-09-11 manual test #15): the desktop prompts a hidden session
 * and polls this until the turn has ended.
 */
export interface WorkbenchLastReply {
  /** Plain text of the newest assistant message (text blocks joined); null before the first reply. */
  readonly text: string | null
  /** Whether a `turn/end` follows that message, i.e. the reply is complete. */
  readonly complete: boolean
}

/** The interface language a Markdown export is written in (B8-P1). */
export type WorkbenchExportLanguage = 'zh' | 'en'

/**
 * The rendered human-readable Markdown export of one Session (B8-P1). The
 * document quotes the log verbatim and is never sanitized; the desktop owns
 * the save dialog and derives the default file name from `title`.
 */
export interface WorkbenchExportMarkdown {
  /** The Session's current display title, already resolved. */
  readonly title: string
  /** The complete document; the desktop writes it UTF-8 without BOM. */
  readonly markdown: string
}

/**
 * Repository-level facts for the Git and Worktree views in one read: the
 * current status, configured remotes, the newest commits, and every
 * registered work tree with its own changed paths.
 */
export interface WorkbenchOverview {
  root: string
  status: RepoStatus
  remotes: RemoteInfo[]
  commits: CommitInfo[]
  worktrees: WorkbenchWorktree[]
}

/**
 * What cleaning a folder's sandbox marks did (DeepSeekGUI 2026-09-29): the
 * Windows ACL sandbox's grant, deny, and Low label, which make programs
 * started from the folder run at Low integrity. `cleaned` — gone from `root`;
 * `clean` — no folder from the chosen one up carries any; `busy` — a confined
 * command is running there now; `unsupported` — this Harness does not confine
 * with Windows ACLs.
 */
export interface WorkbenchSandboxClean {
  readonly status: 'cleaned' | 'clean' | 'busy' | 'unsupported'
  /** The folder the marks were on: the chosen one, or the ancestor they are inherited from. */
  readonly root: string
}


/**
 * 项目记忆里自动整理区的起止标记（HTML 注释，Markdown 里看不见，整体仍是可读可改的 Markdown）。
 * 归档整理写在两者之间；记忆注入保证这一区在预算内整段带入（见 workbench 插件的 session-memory）。
 */
export const AREA_BEGIN = '<!-- deepseekgui:archive-notes:begin -->'
export const AREA_END = '<!-- deepseekgui:archive-notes:end -->'

/**
 * 归档整理（Phase 2，2026-10-05；Sol 审查后返工）一次的结果。只有 written / none 推进已处理边界：
 * running 正在整理；written 已写进项目记忆；none 模型明确说没有值得记的（或只给了全局建议、或全是已有内容）；
 * needs-consent 自动整理还没得到用户确认（首次说明没看过），等手动；too-short 整段会话太短、自动跳过；
 * nothing-new 上次整理之后没有新内容；empty 还没有结束的轮次；no-project 没有项目文件夹；
 * protected 项目位置受保护（仅聊天目录、系统/应用/GUI 位置、链接、不可写），没写；no-model 找不到用过的模型；
 * invalid 模型输出不合格式、空、截断或提出了工具调用，没写、可重试；full 自动整理区满了；
 * malformed 整理区标记残缺；conflict 写之前文件被改了；failed 读会话、调用或写入失败（可重试）；
 * cancelled 被取消；interrupted 上次进行中被中断（进程退出）；gone 会话已经不在了。
 */
export type ArchiveMemoryStatus =
  | 'running' | 'written' | 'none' | 'needs-consent' | 'too-short' | 'nothing-new' | 'empty' | 'no-project'
  | 'protected' | 'no-model' | 'invalid' | 'full' | 'malformed' | 'conflict' | 'failed' | 'cancelled'
  | 'interrupted' | 'gone'

export const ARCHIVE_MEMORY_STATUSES: readonly ArchiveMemoryStatus[] = [
  'running', 'written', 'none', 'needs-consent', 'too-short', 'nothing-new', 'empty', 'no-project',
  'protected', 'no-model', 'invalid', 'full', 'malformed', 'conflict', 'failed', 'cancelled', 'interrupted', 'gone',
]

/** 一段会话的整理记录（`<DSH_HOME>/deepseekgui/archive-memory/<sessionId>.json`）。 */
export interface ArchiveMemoryRecord {
  readonly schemaVersion: 1
  readonly sessionId: string
  readonly status: ArchiveMemoryStatus
  /** 用户手动发起（不看长度门槛）。 */
  readonly manual: boolean
  /** 已经处理过的来源边界：这一 seq 及之前的轮次不会再被整理。只在 written / none 时前进。 */
  readonly processedThroughSeq: number
  readonly startedAt: string
  readonly finishedAt?: string
  /** 本次新增材料与整段会话的规模（只数人说的话与助手正文）。 */
  readonly input?: {
    readonly userTurns: number
    readonly chars: number
    readonly throughSeq: number
    readonly wholeUserTurns: number
    readonly wholeChars: number
  }
  /** 实际交给模型的对话范围：太长时只给最近的部分（complete = false）。 */
  readonly coverage?: { readonly fromSeq: number | null; readonly throughSeq: number; readonly complete: boolean; readonly chars: number }
  /**
   * 当时交给模型的项目记忆（Sol P2-08：整理可追溯）：读到的全文摘要与字数，以及实际给模型的那段文本
   * （有界；超长时只含开头与整个自动整理区）。
   */
  readonly memoryInput?: { readonly sha256: string; readonly chars: number; readonly complete: boolean; readonly text: string }
  /** 本次请求的字符预算（按配置与模型上下文收紧后的值）。 */
  readonly budgetChars?: number
  readonly cwd?: string
  readonly projectPath?: string
  readonly route?: { readonly provider: string; readonly model: string }
  /** 模型的结束原因（stop / tool-calls / max-tokens …）。 */
  readonly finish?: string
  /** 模型原样输出（便于复验）。 */
  readonly output?: string
  /** 写进项目记忆的条目。 */
  readonly added?: readonly string[]
  /** 被本次条目取代、改成删除线的旧自动条目。 */
  readonly superseded?: readonly string[]
  /** 没写成（满了、冲突、标记残缺、受保护、写失败）时这次本来要写的条目。 */
  readonly pending?: readonly string[]
  /** 给全局记忆的建议（另存，等用户确认）。 */
  readonly suggestions?: readonly string[]
  /** 建议列表已满、没能放进去的条数（不悄悄当成处理完）。 */
  readonly suggestionsDropped?: number
  /** 不合格式、超限或像凭据而被丢掉的行数。 */
  readonly rejected?: number
  readonly error?: string
}

/** 归档整理的开关。 */
export interface ArchiveMemorySettings {
  /** 归档时自动整理（会调用一次当前模型服务，可能计费）。只有 noticeSeen 之后才真的自动跑。 */
  readonly auto: boolean
  /** 首次说明是否已经看过：没看过之前，归档只记 needs-consent，不调用模型。 */
  readonly noticeSeen: boolean
}

/** 一条等用户确认的全局记忆建议。 */
export interface MemorySuggestion {
  readonly id: string
  readonly text: string
  readonly sessionId: string
  readonly at: string
}

/** 记忆视图读到的归档整理事实。 */
export interface WorkbenchArchiveMemory {
  readonly settings: ArchiveMemorySettings
  readonly record: ArchiveMemoryRecord | null
  readonly running: boolean
}

/** 一个记忆文件在一次组装中被带入时的事实。 */
export interface MemoryInjectionFile {
  readonly path: string
  readonly status: 'present' | 'absent' | 'empty' | 'truncated' | 'unreadable'
  /** 实际带入的 UTF-8 字节数与字符数（code points）。 */
  readonly bytes: number
  readonly chars: number
  /** 实际带入文本的 SHA-256：同样长度、不同内容也分得开。 */
  readonly sha256: string
  /** 自动整理区是否整段带入（项目记忆超出上限时，它优先于人写内容的尾部）。 */
  readonly autoArea?: 'included' | 'absent'
}

/** 一次加载时带入的记忆（会话第一次组装请求，或重启后重新加载时各记一条）。 */
export interface MemoryInjectionEntry {
  readonly at: string
  /** 每个文件的读取上限（字节）。 */
  readonly capBytes: number
  readonly global: MemoryInjectionFile
  readonly project: MemoryInjectionFile
}

/**
 * 一段会话每次加载时带入了什么（`<DSH_HOME>/deepseekgui/memory-injections/<sessionId>.json`）。
 * 每次加载追加一条（保留最近 20 条），不覆盖历史；最后一条就是当前这次加载在用的那一份。
 */
export interface MemoryInjection {
  readonly sessionId: string
  readonly entries: readonly MemoryInjectionEntry[]
}
