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
 * Repository-level facts for the Git and Worktree views in one read: the
 * current status, configured remotes, the newest commits, and every
 * registered work tree with its own changed paths.
 */
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

export interface WorkbenchOverview {
  root: string
  status: RepoStatus
  remotes: RemoteInfo[]
  commits: CommitInfo[]
  worktrees: WorkbenchWorktree[]
}
