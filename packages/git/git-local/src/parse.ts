/**
 * Stable machine-format parsers for the Git read model (B4-P2): porcelain v2
 * status (`--porcelain=v2 --branch -z`), worktree porcelain, name-status -z,
 * and numstat -z. Pure functions over captured stdout; no state is guessed
 * and no stderr text is parsed.
 * @module @deepseek-ai/dsh-git-local/src/parse
 */

import type {
  CommitInfo, DiffFileSummary, RepoStatus, StatusCode, StatusEntry, WorktreeInfo,
} from '@deepseek-ai/dsh-git/types'

/**
 * Parse `git --version` output (`git version 2.39.2.windows.1`).
 * @param output - The captured stdout.
 * @returns the parsed major/minor and the raw version line.
 */
export function parseGitVersion(output: string): { major: number; minor: number; raw: string } {
  const raw = output.trim()
  const match = /git version (\d+)\.(\d+)/u.exec(raw)
  if (match == null) {
    throw new Error(`cannot parse git version from '${raw}'`)
  }
  return { major: Number(match[1]), minor: Number(match[2]), raw }
}

/**
 * Parse porcelain v2 status records (`git status --porcelain=v2 --branch -z`).
 * Headers (`# branch.*`) stay `\n`-terminated; records are NUL-terminated, and
 * a `2` (rename/copy) record carries its original path as a second NUL field.
 * @param output - The captured stdout.
 * @returns the clean/dirty state and every changed path.
 */
export function parsePorcelainV2(output: string): RepoStatus {
  const headers: Record<string, string> = {}
  let records = output
  // Header block: consecutive `# ` lines, each `# <key> <value>`. Under -z
  // the headers are NUL-terminated like every record, never newline-terminated.
  while (records.startsWith('# ')) {
    const nul = records.indexOf('\0')
    const line = nul === -1 ? records : records.slice(0, nul)
    const rest = nul === -1 ? '' : records.slice(nul + 1)
    const space = line.indexOf(' ', 2)
    if (space !== -1) headers[line.slice(2, space)] = line.slice(space + 1)
    records = rest
  }

  const head: RepoStatus['head'] = { kind: 'branch', name: headers['branch.head'] ?? '' }
  if (headers['branch.oid'] !== undefined && headers['branch.oid'] !== '') head.oid = headers['branch.oid']
  if (head.name === '') head.kind = head.oid === undefined ? 'unborn' : 'detached'

  let upstream: RepoStatus['upstream']
  if (headers['branch.upstream'] !== undefined) {
    const ab = headers['branch.ab'] ?? '+0 -0'
    const ahead = Number(/\+(\d+)/u.exec(ab)?.[1] ?? 0)
    const behind = Number(/-(\d+)/u.exec(ab)?.[1] ?? 0)
    upstream = { ref: headers['branch.upstream'], ahead, behind }
  }

  const entries: StatusEntry[] = []
  // Split into NUL-terminated fields; a rename record consumes its two fields.
  const fields = records.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string
    if (field === '') continue
    if (field.startsWith('? ')) {
      entries.push({
        kind: 'untracked',
        path: field.slice(2),
        x: '?', y: '?',
      })
      continue
    }
    if (field.startsWith('u ')) {
      const parts = field.split(' ')
      entries.push({
        kind: 'conflict',
        path: parts.slice(10).join(' '),
        x: code(parts[1]?.[0]), y: code(parts[1]?.[1]),
      })
      continue
    }
    if (field.startsWith('1 ') || field.startsWith('2 ')) {
      const parts = field.split(' ')
      const xy = parts[1] ?? '..'
      const x = code(xy[0])
      const y = code(xy[1])
      let path = parts.slice(8).join(' ')
      let origPath: string | undefined
      let score: string | undefined
      if (field.startsWith('2 ')) {
        // `<X><score>` occupies the ninth token; path is the tenth; the
        // original path follows as the next NUL field.
        score = (parts[8] ?? '').slice(1)
        path = parts.slice(9).join(' ')
        const next = fields[i + 1]
        if (next !== undefined && next !== '') {
          origPath = next
          i++
        }
      }
      entries.push({
        kind: x !== '.' ? 'staged' : 'unstaged',
        path,
        ...origPath === undefined ? {} : { origPath },
        x, y,
        ...score === undefined ? {} : { score },
      })
    }
  }

  return {
    clean: entries.length === 0,
    head,
    ...upstream === undefined ? {} : { upstream },
    entries,
  }
}

const code = (letter: string | undefined): StatusCode =>
  (letter === undefined || letter === '') ? '.' : letter as StatusCode

/**
 * Parse `git worktree list --porcelain` output. Records are blank-line
 * separated `key value` blocks; `detached`/`bare` appear without values.
 * @param output - The captured stdout.
 * @returns the work-tree list in command order.
 */
export function parseWorktreePorcelain(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = []
  for (const block of output.split('\n\n')) {
    const lines = block.split('\n').filter(line => line !== '')
    if (lines.length === 0) continue
    const fields: Record<string, string> = {}
    let detached = false
    let bare = false
    for (const line of lines) {
      const space = line.indexOf(' ')
      if (space === -1) {
        if (line === 'detached') detached = true
        if (line === 'bare') bare = true
        continue
      }
      fields[line.slice(0, space)] = line.slice(space + 1)
    }
    if (fields['worktree'] === undefined) continue
    worktrees.push({
      path: fields['worktree'],
      head: fields['HEAD'] ?? '',
      ...fields['branch'] === undefined ? {} : { branch: fields['branch'].replace(/^refs\/heads\//u, '') },
      detached,
      bare,
    })
  }
  return worktrees
}

/** One `git diff --name-status -z` record (`<status><score?>\0<path>\0<origPath?>`) → summary. */
interface NameStatusRecord {
  status: DiffFileSummary['status']
  path: string
  origPath?: string
  score?: number
}

/** The `--format` string {@link parseLogRecords} expects: unit-separated fields, one commit per line. */
export const LOG_FORMAT = '%H%x1f%s%x1f%an%x1f%ct'

/**
 * Parse `git log --format=<LOG_FORMAT>` output: each line is
 * `<sha> US <subject> US <author> US <committer-unix-seconds>` with US the
 * unit separator (0x1f). Subjects never contain a newline, so the line is
 * the record; a malformed line is skipped rather than guessed.
 * @param output - The captured stdout.
 * @returns commits in command order (newest first).
 */
export function parseLogRecords(output: string): CommitInfo[] {
  const commits: CommitInfo[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [sha, subject, author, seconds] = line.split('\x1f')
    if (sha === undefined || subject === undefined || author === undefined || seconds === undefined) continue
    const time = Number(seconds) * 1_000
    if (!Number.isFinite(time)) continue
    commits.push({ sha, subject, author, time })
  }
  return commits
}

/**
 * Parse `git diff --name-status -z` output.
 * @param output - The captured stdout.
 * @returns one record per changed path (status letter, path, and for
 * renames/copies the original path and similarity score).
 */
export function parseNameStatusZ(output: string): NameStatusRecord[] {
  const records: NameStatusRecord[] = []
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string
    if (field === '') continue
    const status = field[0]
    const scoreText = field.slice(1)
    const first = fields[i + 1]
    if (first === undefined || first === '') continue
    i++
    let path = first
    let origPath: string | undefined
    if (status === 'R' || status === 'C') {
      // -z rename/copy field order is source first, destination second
      // ("R100 NUL old NUL new NUL", verified against real git output).
      const second = fields[i + 1]
      if (second !== undefined && second !== '') {
        origPath = first
        path = second
        i++
      }
    }
    records.push({
      status: statusOf(status),
      path,
      ...origPath === undefined ? {} : { origPath },
      ...scoreText === '' ? {} : { score: Number(scoreText) },
    })
  }
  return records
}

const statusOf = (letter: string | undefined): DiffFileSummary['status'] => {
  switch (letter) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    default: return 'modified'
  }
}

/** One `git diff --numstat -z` record (`<added>\t<deleted>\t<path>`; rename carries a second path field). */
interface NumstatRecord {
  path: string
  origPath?: string
  binary: boolean
  addedLines?: number
  deletedLines?: number
}

/**
 * Parse `git diff --numstat -z` output (rename records NUL-split their two paths).
 * @param output - The captured stdout.
 * @returns one record per changed path (path, binary fact, and line counts
 * for text files; renames carry the original path).
 */
export function parseNumstatZ(output: string): NumstatRecord[] {
  const records: NumstatRecord[] = []
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] as string
    if (field === '') continue
    const tab1 = field.indexOf('\t')
    const tab2 = tab1 === -1 ? -1 : field.indexOf('\t', tab1 + 1)
    if (tab1 === -1 || tab2 === -1) continue
    const added = field.slice(0, tab1)
    const deleted = field.slice(tab1 + 1, tab2)
    let path = field.slice(tab2 + 1)
    const binary = added === '-' || deleted === '-'
    let origPath: string | undefined
    // A rename numstat row leaves the in-record path empty and appends BOTH
    // paths as NUL fields, source first ("1 TAB 0 TAB NUL old NUL new NUL",
    // verified against real git output).
    if (path === '') {
      const pre = fields[i + 1]
      const post = fields[i + 2]
      if (pre === undefined || pre === '' || post === undefined || post === '') continue
      origPath = pre
      path = post
      i += 2
    }
    records.push({
      path,
      ...origPath === undefined ? {} : { origPath },
      binary,
      ...binary ? {} : { addedLines: Number(added), deletedLines: Number(deleted) },
    })
  }
  return records
}

/**
 * Merge name-status and numstat records into one file-summary list (keyed by new path).
 * @param names - The name-status records.
 * @param numstats - The numstat records.
 * @returns one file summary per name-status record, enriched with the
 * numstat line counts or binary fact where a numstat row matches.
 */
export function mergeDiffSummaries(
  names: NameStatusRecord[],
  numstats: NumstatRecord[],
): DiffFileSummary[] {
  const byPath = new Map<string, NumstatRecord>()
  for (const numstat of numstats) byPath.set(numstat.path, numstat)
  return names.map((name) => {
    const numstat = byPath.get(name.path)
    return {
      path: name.path,
      ...name.origPath === undefined ? {} : { origPath: name.origPath },
      status: name.status,
      binary: numstat?.binary ?? false,
      ...numstat?.binary === true || numstat === undefined
        ? {}
        : { addedLines: numstat.addedLines, deletedLines: numstat.deletedLines },
      ...name.score === undefined ? {} : { score: name.score },
    }
  })
}
