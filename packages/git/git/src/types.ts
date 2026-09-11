/**
 * Read-only Git fact vocabulary (B4-P2). Git owns the repository; these are
 * the stable machine-format projections the capability serves, with no
 * second Git database and no guessed state.
 * @module @deepseek-ai/dsh-git/src/types
 */

/** The repository a working directory belongs to. */
export interface RepoIdentity {
  /** Canonical work-tree root (`git rev-parse --show-toplevel`). */
  root: string
  /** Repository metadata directory (`git rev-parse --git-dir`), absolute. */
  gitDir: string
  /** True for a bare repository (no work tree). */
  bare: boolean
}

/** Where HEAD points. */
export type HeadState =
  | { kind: 'branch'; branch: string; oid: string }
  /** HEAD exists but no branch is checked out (`git branch --show-current` empty). */
  | { kind: 'detached'; oid: string }
  /** The branch exists but has no commit yet (`git rev-parse HEAD` fails). */
  | { kind: 'unborn'; branch: string }

/** The configured upstream of the current branch, when one exists. */
export interface UpstreamInfo {
  /** Full upstream ref as configured (`origin/main`). */
  ref: string
  /** Commits ahead of the upstream. */
  ahead: number
  /** Commits behind the upstream. */
  behind: number
}

/** One work tree registered with the repository (`git worktree list --porcelain`). */
export interface WorktreeInfo {
  /** Absolute work-tree path. */
  path: string
  /** HEAD oid of that work tree. */
  head: string
  /** Branch checked out there, when not detached. */
  branch?: string
  /** True when the work tree is detached or unborn. */
  detached: boolean
  /** True for the bare repository itself. */
  bare: boolean
}

/** Index/worktree status letter vocabulary of porcelain v2 (`X`/`Y` of each record). */
export type StatusCode =
  | '.' | 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | 'T' | '?'
  | 'AM' | 'AD' | 'AU' | 'AA' | 'DD' | 'DU' | 'UA' | 'UD' | 'UU'

/** One changed path in the work tree (`git status --porcelain=v2 -z`). */
export interface StatusEntry {
  /**
   * Which surface reports the change: `conflict` for unmerged records (`u`),
   * `untracked` for `?` records, `staged` when the index column differs from
   * `.`, `unstaged` when only the work-tree column differs.
   */
  kind: 'staged' | 'unstaged' | 'untracked' | 'conflict'
  /** Path relative to the repo root. */
  path: string
  /** Original path for a rename/copy (the `2` record's second path). */
  origPath?: string
  /** Index status column (`X` of `XY`). */
  x: StatusCode
  /** Work-tree status column (`Y` of `XY`). */
  y: StatusCode
  /** Rename/copy similarity score (`R100` / `C75`), when present. */
  score?: string
}

/** The complete read-only work-tree state (`git status --porcelain=v2 --branch -z`). */
export interface RepoStatus {
  /** True when the work tree matches HEAD and the index (no entries at all). */
  clean: boolean
  /** HEAD fact from the `# branch.*` headers. */
  head: { kind: 'branch' | 'detached' | 'unborn'; name: string; oid?: string }
  /** Upstream ref plus ahead/behind from `# branch.upstream` / `# branch.ab`. */
  upstream?: { ref: string; ahead: number; behind: number }
  /** Every changed path, in porcelain v2 record order. */
  entries: StatusEntry[]
}

/** One commit of the current branch history (`git log`), newest first. */
export interface CommitInfo {
  /** Full commit SHA. */
  sha: string
  /** First line of the commit message. */
  subject: string
  /** Author name as recorded. */
  author: string
  /** Committer timestamp in Unix milliseconds. */
  time: number
}

/** One file's diff summary (`git diff --numstat -z`). */
export interface DiffFileSummary {
  /** Path relative to the repo root. */
  path: string
  /** Original path for a rename/copy. */
  origPath?: string
  /** Letter status from the name-status vocabulary (A/M/D/R/C/T). */
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'
  /** True when Git reports a binary file (`-` numstat columns). */
  binary: boolean
  /** Added lines; absent for binary files. */
  addedLines?: number
  /** Deleted lines; absent for binary files. */
  deletedLines?: number
  /** Rename/copy similarity score (`100`), when present. */
  score?: number
}

/** The read-only diff of one scope (`git diff [--cached] --numstat -z`). */
export interface DiffResult {
  /** Every changed file in record order. */
  files: DiffFileSummary[]
  /** The requested unified patch, when `wantPatch` was set and the bound held. */
  patch?: string
}

/** Which side of the index a diff reads. */
export type DiffScope = 'staged' | 'unstaged'

/** The configured commit author (`git var GIT_AUTHOR_IDENT`). */
export interface AuthorIdentity {
  /** The author name git would use. */
  name: string
  /** The author email git would use. */
  email: string
}

/** The result of one guarded GUI commit (B4-P5). */
export interface GitCommitResult {
  /** The new commit's full SHA. */
  sha: string
  /**
   * Whether the committed tree equals the tree the user reviewed. The
   * pre-commit drift check closes the review window; this post-commit
   * comparison reports the millisecond window between that check and the
   * commit itself — a mismatch still happened and must be told loudly.
   */
  treeMatchesExpected: boolean
}

/** One configured remote (`git remote -v`). */
export interface RemoteInfo {
  /** Remote name as configured (`origin`). */
  name: string
  /** The URL git fetches from. */
  fetchUrl: string
  /** The URL git pushes to, when it differs from the fetch URL. */
  pushUrl?: string
}

/**
 * The push preview (B4-P6): every fact the user confirms before a push —
 * the remote URL, the local and target remote refs, the ahead commits, and
 * whether the remote ref exists. Facts only; nothing is written.
 */
export interface PushPreview {
  /** Opaque destination proof, bound to this provider instance; contains no reusable credential. */
  destinationToken: string
  /** Exact local commit presented for approval. */
  sourceOid: string
  /** The remote that would receive the push. */
  remote: RemoteInfo
  /** The local branch that would be pushed. */
  localBranch: string
  /** The remote branch the local branch maps to (same name by default). */
  remoteBranch: string
  /** The configured upstream ref (`origin/main`), when one exists. */
  upstream?: string
  /**
   * Candidate commits: target..source when the remote target object exists
   * locally, otherwise the full source history. An unreachable target does
   * not establish an exact ahead count.
   */
  aheadCommits: string[]
  /**
   * True when the remote has `refs/heads/<remoteBranch>`.
   * `undefined` when the remote could not be queried —
   * the preview then carries local facts only.
   */
  remoteRefExists: boolean | undefined
  /** The repository's default branch as reported by the remote HEAD, when queryable. */
  defaultBranch?: string
  /** The configured `credential.helper` (the authentication source), when one is set. */
  credentialHelper?: string
}

/** The source commit and destination approved by a caller. */
export interface PushApproval {
  /** Commit shown before approval. */
  sourceOid: string
  /** Destination proof returned with the approved preview. */
  destinationToken: string
}

/** The result of one explicit push (B4-P6). */
export interface PushOutcome {
  /** The remote that received the push. */
  remote: string
  /** The remote branch ref that was updated. */
  remoteBranch: string
  /** The SHA the remote branch now points at. */
  pushedSha: string
}
