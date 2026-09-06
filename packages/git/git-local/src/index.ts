/**
 * Local Git provider (B4-P2): implements the git capability seam over the
 * subprocess seam — system git, exact executable + argv, never a shell
 * string, bounded collected output, and stable machine formats only. Every
 * query is read-only; failures classify only by verifiable facts (exit
 * codes, `git --version` output) and present raw stderr verbatim for
 * diagnosis without parsing it.
 * @module @deepseek-ai/dsh-git-local
 */

import type { SubprocessOutcome, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  GitCapability, GitCommandFailedError, GitCommitRefusedError, GitDiffTooLargeError,
  GitNoSuchRemoteError, GitNotARepositoryError, GitPushRefusedError, GitRevertRefusedError,
  GitStagedTreeDriftError, GitUnavailableError, GitUnsupportedVersionError,
} from '@deepseek-ai/dsh-git'
import type {
  AuthorIdentity, CommitInfo, DiffResult, DiffScope, GitCommitResult, HeadState, PushApproval, PushOutcome, PushPreview,
  RemoteInfo, RepoIdentity, RepoStatus, UpstreamInfo, WorktreeInfo,
} from '@deepseek-ai/dsh-git/types'
import {
  LOG_FORMAT, mergeDiffSummaries, parseGitVersion, parseLogRecords, parseNameStatusZ, parseNumstatZ,
  parsePorcelainV2, parseWorktreePorcelain,
} from './parse.ts'

/** Bound on any single captured read-model stream (status/diff listings). */
const READ_MODEL_MAX_BYTES = 4 * 1024 * 1024

/** Default bound on a requested diff patch. */
export const DEFAULT_PATCH_MAX_BYTES = 512 * 1024

/**
 * Classify a push refusal from git's own stable stderr vocabulary (B4-P6).
 * The raw stderr always rides along; this only names the failure class so a
 * UI can render an actionable message instead of an English blob. Unmatched
 * stderr falls back to a generic rejection — never a guess of success.
 * @param stderr - The raw git push stderr.
 * @returns the refusal class.
 */
export function classifyPushFailure(stderr: string): 'non-fast-forward' | 'protected' | 'auth' | 'not-found' | 'network' | 'rejected' {
  if (/non-fast-forward|fetch first|stale info|update rejected/u.test(stderr)) return 'non-fast-forward'
  if (/protected branch hook declined|pre-receive hook declined/u.test(stderr)) return 'protected'
  if (/Authentication failed|could not read Username|terminal prompts disabled|Bad credentials/u.test(stderr)
    || /authentication required|HTTP 401|HTTP 403/u.test(stderr)) {
    return 'auth'
  }
  if (/repository.*?not found|does not appear to be a git repository/u.test(stderr)) return 'not-found'
  if (/Could not resolve host|Connection refused|unable to access|Failed to connect|Timed out|Could not read from remote/u.test(stderr)) {
    return 'network'
  }
  return 'rejected'
}

/** Bound on the staged diff unstageFile re-applies in reverse. */
export const STAGED_PATCH_MAX_BYTES = 8 * 1024 * 1024

/** A hung git query must not block the harness forever. */
const GIT_QUERY_TIMEOUT_MS = 30_000

/** Grace period for terminating a hung query. */
const GIT_QUERY_GRACE_MS = 5_000

/** porcelain v2 and `-z` output need git >= 2.11. */
const MINIMUM_GIT_VERSION = '2.11.0'

/**
 * Local read-only Git capability. One instance per context; resolves the git
 * executable once and checks the version once, then serves every query
 * through `ctx.subprocess.spawn`.
 */
export class LocalGitCapability extends GitCapability {
  static inject = ['subprocess']

  readonly minimumGitVersion = MINIMUM_GIT_VERSION

  private executablePromise?: Promise<string>
  private versionChecked = false

  async resolveGit(): Promise<string> {
    this.executablePromise ??= this.resolveExecutable()
    return await this.executablePromise
  }

  async repoIdentity(cwd: string): Promise<RepoIdentity> {
    await this.ensureUsable()
    const output = await this.run(cwd, [
      'rev-parse', '--show-toplevel', '--absolute-git-dir', '--is-bare-repository',
    ], {
      notARepository: true,
    })
    const [root, gitDir, bare] = output.stdout.split('\n')
    if (root === undefined || root === '' || gitDir === undefined || gitDir === '') {
      throw new GitNotARepositoryError(cwd)
    }
    return { root: root.trim(), gitDir: gitDir.trim(), bare: bare?.trim() === 'true' }
  }

  async head(cwd: string): Promise<HeadState> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const branch = (await this.run(cwd, ['branch', '--show-current'])).stdout.trim()
    let oid: string
    try {
      oid = (await this.run(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
    } catch (error) {
      if (error instanceof GitCommandFailedError && branch !== '') {
        return { kind: 'unborn', branch }
      }
      throw error
    }
    if (oid === '') throw new GitNotARepositoryError(cwd)
    if (branch === '') return { kind: 'detached', oid }
    return { kind: 'branch', branch, oid }
  }

  async upstream(cwd: string): Promise<UpstreamInfo | undefined> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    let ref: string
    try {
      ref = (await this.run(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))
        .stdout.trim()
    } catch (error) {
      // Only a definite no-upstream rejection maps to `undefined`; every
      // other failure propagates.
      if (error instanceof GitCommandFailedError && error.exitCode === 128) return undefined
      throw error
    }
    if (ref === '') return undefined
    const counts = (await this.run(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD']))
      .stdout.trim()
    const [behindText, aheadText] = counts.split(/\s+/u)
    const ahead = Number(aheadText)
    const behind = Number(behindText)
    return {
      ref,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    }
  }

  async worktrees(cwd: string): Promise<WorktreeInfo[]> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const output = await this.run(cwd, ['worktree', 'list', '--porcelain'])
    return parseWorktreePorcelain(output.stdout)
  }

  async worktreeAdd(cwd: string, path: string, branch: string): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    await this.run(cwd, ['worktree', 'add', '-q', '-b', branch, path])
  }

  async worktreeRemove(cwd: string, path: string): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    await this.run(cwd, ['worktree', 'remove', path])
  }

  async status(cwd: string): Promise<RepoStatus> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const output = await this.run(cwd, ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v2', '--branch', '-z'])
    return parsePorcelainV2(output.stdout)
  }

  async log(cwd: string, max: number): Promise<CommitInfo[]> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const head = await this.head(cwd)
    // An unborn branch has no history; `git log` would exit 128 there.
    if (head.kind === 'unborn') return []
    const count = Math.max(1, Math.floor(max))
    const output = await this.run(cwd, ['log', '-n', String(count), `--format=${LOG_FORMAT}`])
    return parseLogRecords(output.stdout)
  }

  async diff(
    cwd: string,
    scope: DiffScope,
    path?: string,
    wantPatch?: boolean,
    patchMaxBytes = DEFAULT_PATCH_MAX_BYTES,
  ): Promise<DiffResult> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const cached = scope === 'staged' ? ['--cached'] : []
    const pathspec = path === undefined ? [] : ['--', path]
    // Inspection must not refresh the index or execute repository-configured converters.
    const command = ['-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', ...cached]
    const names = await this.run(cwd, [...command, '--name-status', '-z', ...pathspec])
    const numstats = await this.run(cwd, [...command, '--numstat', '-z', ...pathspec])
    const files = mergeDiffSummaries(parseNameStatusZ(names.stdout), parseNumstatZ(numstats.stdout))
    if (wantPatch !== true) return { files }
    // `--binary` keeps the patch consumable by `git apply`: binary files
    // carry a literal patch, and text patches are byte-identical to plain
    // `git diff` output. The index operations re-apply these exact bytes.
    const patch = await this.run(cwd, [...command, '--binary', ...pathspec], { maxBytes: patchMaxBytes })
    return { files, patch: patch.stdout }
  }

  async applyIndexPatch(cwd: string, patch: string, reverse: boolean): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const args = ['apply', '--cached', ...(reverse ? ['--reverse'] : []), '-']
    await this.run(cwd, args, { stdin: patch })
  }

  async stageFile(cwd: string, path: string): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    await this.run(cwd, ['add', '--', ...await this.renamePaths(cwd, path)])
  }

  async unstageFile(cwd: string, path: string): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const paths = await this.renamePaths(cwd, path)
    // The staged diff (index against HEAD) applied in reverse moves the
    // index back toward HEAD without touching the work tree. Generating the
    // patch from git itself keeps the unstage mechanism identical for text,
    // binary, rename, and unborn-HEAD entries.
    const staged = await this.run(
      cwd,
      ['diff', '--cached', '--binary', '--', ...paths],
      { maxBytes: STAGED_PATCH_MAX_BYTES },
    )
    if (staged.stdout === '') return
    await this.run(cwd, ['apply', '--cached', '--reverse', '-'], { stdin: staged.stdout })
  }

  /**
   * Both sides of a rename entry addressed by either path, the path alone
   * otherwise. A rename spans two paths (the original deleted, the new one
   * added); a pathspec limited to one side would stage or unstage only half.
   */
  private async renamePaths(cwd: string, path: string): Promise<string[]> {
    const entry = (await this.status(cwd)).entries.find(candidate =>
      candidate.path === path || candidate.origPath === path)
    return entry?.origPath !== undefined && entry.origPath !== entry.path
      ? [entry.origPath, entry.path]
      : [path]
  }

  async revertFile(cwd: string, path: string): Promise<void> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    // Precondition check against the authoritative status: B4 never restores
    // or deletes untracked files and never auto-resolves conflicts. Git's own
    // refusal remains the backstop for anything the check missed.
    const status = await this.status(cwd)
    const entry = status.entries.find(candidate =>
      candidate.path === path || candidate.origPath === path)
    if (entry?.kind === 'untracked') throw new GitRevertRefusedError(path, 'untracked')
    if (entry?.kind === 'conflict') throw new GitRevertRefusedError(path, 'conflict')
    await this.run(cwd, ['checkout', '--', path])
  }

  async authorIdentity(cwd: string): Promise<AuthorIdentity | undefined> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    let output: string
    try {
      output = (await this.run(cwd, ['var', 'GIT_AUTHOR_IDENT'])).stdout.trim()
    } catch (error) {
      // A failed ident lookup (unconfigured user.name/user.email) is the
      // definite "no identity" fact; spawn-level failures still propagate.
      if (error instanceof GitCommandFailedError) return undefined
      throw error
    }
    // `Name <email> 1234567890 +0800` — the name is everything before the
    // first " <", the email the part between "<" and ">".
    const open = output.lastIndexOf(' <')
    const close = open === -1 ? -1 : output.indexOf('>', open)
    if (open === -1 || close === -1) return undefined
    const name = output.slice(0, open)
    const email = output.slice(open + 2, close)
    if (name === '' || email === '') return undefined
    return { name, email }
  }

  async stagedTree(cwd: string): Promise<string> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const oid = (await this.run(cwd, ['write-tree'])).stdout.trim()
    if (oid === '') throw new GitCommandFailedError(['git', 'write-tree'], cwd, null, 'write-tree reported no tree')
    return oid
  }

  async commit(cwd: string, message: string, expectedTree: string): Promise<GitCommitResult> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    // Preconditions, in order; nothing is written on refusal.
    const status = await this.status(cwd)
    if (status.entries.some(entry => entry.kind === 'conflict')) {
      throw new GitCommitRefusedError('conflict')
    }
    const staged = await this.run(cwd, ['diff', '--cached', '--name-only', '-z'])
    if (staged.stdout === '') {
      throw new GitCommitRefusedError('empty-index')
    }
    if ((await this.authorIdentity(cwd)) === undefined) {
      throw new GitCommitRefusedError('identity')
    }
    const actualTree = await this.stagedTree(cwd)
    if (actualTree !== expectedTree) {
      throw new GitStagedTreeDriftError(expectedTree, actualTree)
    }
    // The message rides stdin (`git commit -F -`): any characters are safe
    // and nothing is ever shell-interpreted.
    await this.run(cwd, ['commit', '-F', '-'], { stdin: message })
    const sha = (await this.run(cwd, ['rev-parse', 'HEAD'])).stdout.trim()
    if (sha === '') throw new GitCommandFailedError(['git', 'rev-parse', 'HEAD'], cwd, null, 'commit reported no HEAD')
    // Post-commit tree comparison: the drift check above closed the review
    // window; this reports the millisecond window between that check and the
    // commit itself, loudly.
    const headTree = (await this.run(cwd, ['rev-parse', 'HEAD^{tree}'])).stdout.trim()
    return { sha, treeMatchesExpected: headTree === expectedTree }
  }

  async remotes(cwd: string): Promise<RemoteInfo[]> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const output = await this.run(cwd, ['remote', '-v'])
    const entries = new Map<string, { fetchUrl?: string; pushUrl?: string }>()
    for (const line of output.stdout.split('\n')) {
      // `git remote -v` rows: `<name>\t<url> (fetch|push)` — tab-separated so
      // URLs containing spaces stay intact.
      const [name, rest] = line.split('\t')
      if (name === undefined || rest === undefined) continue
      const match = /^(.*?)\s+\((fetch|push)\)$/u.exec(rest)
      if (match === null) continue
      const existing = entries.get(name)
      const entry: { fetchUrl?: string; pushUrl?: string } = existing === undefined
        ? {}
        : { ...existing }
      const url = match[1]
      if (url !== undefined) {
        if (match[2] === 'fetch') entry.fetchUrl = url
        else entry.pushUrl = url
      }
      entries.set(name, entry)
    }
    return [...entries].map(([name, urls]): RemoteInfo => ({
      name,
      fetchUrl: urls.fetchUrl ?? '',
      ...urls.pushUrl === undefined || urls.pushUrl === urls.fetchUrl ? {} : { pushUrl: urls.pushUrl },
    }))
  }

  /** Resolve one destination; multiple push URLs require a caller to choose explicitly. */
  private async pushUrl(cwd: string, remote: string): Promise<string> {
    const urls = (await this.run(cwd, ['remote', 'get-url', '--push', '--all', remote])).stdout.trim().split('\n')
    const url = urls[0]
    if (urls.length !== 1 || url === undefined || url === '') throw new Error('push requires exactly one configured push URL')
    return url
  }

  /** Validate a branch name without accepting refspec operations. */
  private async branchRef(cwd: string, branch: string): Promise<string> {
    if (branch === '' || /^[+-]/u.test(branch)) throw new Error('push requires a branch name, not a refspec')
    const ref = `refs/heads/${branch}`
    await this.run(cwd, ['check-ref-format', ref])
    return ref
  }

  async pushPreview(cwd: string, remote: string, localBranch?: string, remoteBranch?: string): Promise<PushPreview> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const all = await this.remotes(cwd)
    const info = all.find(candidate => candidate.name === remote)
    if (info === undefined) throw new GitNoSuchRemoteError(remote)
    const head = await this.head(cwd)
    if (localBranch === undefined && head.kind !== 'branch') {
      throw new GitCommandFailedError(
        ['git', 'branch', '--show-current'], cwd, null,
        'a push preview needs a checked-out branch (detached or unborn HEAD)',
      )
    }
    localBranch ??= head.kind === 'branch' ? head.branch : ''
    remoteBranch ??= localBranch
    const source = await this.branchRef(cwd, localBranch)
    const target = await this.branchRef(cwd, remoteBranch)
    const sourceOid = (await this.run(cwd, ['rev-parse', '--verify', `${source}^{commit}`])).stdout.trim()
    const pushUrl = await this.pushUrl(cwd, remote)
    const upstream = await this.upstream(cwd)
    // Remote facts are queried best-effort: an unreachable remote (offline,
    // unknown host) degrades the preview to local facts instead of failing it.
    let remoteRefExists: boolean | undefined
    let defaultBranch: string | undefined
    let remoteOid: string | undefined
    try {
      const ls = await this.run(
        cwd,
        ['ls-remote', '--symref', '--', pushUrl, target, 'HEAD'],
        { maxBytes: 64 * 1024 },
      )
      for (const line of ls.stdout.split('\n')) {
        const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/u.exec(line)
        if (symref !== null) defaultBranch = symref[1]
      }
      // Exact ref match on the `<sha><TAB><ref>` column: a substring test also
      // hits the `ref: refs/heads/<default> HEAD` symref line, so a branch
      // that is a prefix of the default branch read as "already exists".
      remoteRefExists = ls.stdout.split('\n').some((line) => {
        if (line.startsWith('ref:')) return false
        const ref = line.split(String.fromCharCode(9))[1]
        if (ref !== target) return false
        remoteOid = line.split(String.fromCharCode(9))[0]
        return true
      })
    } catch {
      remoteRefExists = undefined
    }
    // Compare the exact destination, not a different branch's upstream.
    let range = sourceOid
    if (remoteOid !== undefined) {
      try {
        await this.run(cwd, ['cat-file', '-e', `${remoteOid}^{commit}`])
        range = `${remoteOid}..${sourceOid}`
      } catch {
        // A remote commit absent locally leaves the full candidate history.
      }
    }
    const log = await this.run(cwd, ['log', '--oneline', range])
    const aheadCommits = log.stdout.split('\n').filter(line => line !== '')
    // The authentication source: the effective credential helper, when one
    // is configured (the product never reads or displays a token itself).
    let credentialHelper: string | undefined
    try {
      const helper = (await this.run(cwd, ['config', '--get', 'credential.helper'])).stdout.trim()
      if (helper !== '') credentialHelper = helper
    } catch {
      // No helper configured: git will fall back to its prompts (which fail
      // without a TTY) or platform defaults — a fact, not an error here.
    }
    return {
      remote: { ...info, pushUrl },
      sourceOid,
      localBranch,
      remoteBranch,
      ...upstream === undefined ? {} : { upstream: upstream.ref },
      aheadCommits,
      remoteRefExists,
      ...defaultBranch === undefined ? {} : { defaultBranch },
      ...credentialHelper === undefined ? {} : { credentialHelper },
    }
  }

  async push(
    cwd: string,
    remote: string,
    localBranch: string,
    remoteBranch: string,
    expected?: PushApproval,
  ): Promise<PushOutcome> {
    await this.ensureUsable()
    await this.repoIdentity(cwd)
    const all = await this.remotes(cwd)
    if (!all.some(candidate => candidate.name === remote)) throw new GitNoSuchRemoteError(remote)
    const source = await this.branchRef(cwd, localBranch)
    const target = await this.branchRef(cwd, remoteBranch)
    const sourceOid = (await this.run(cwd, ['rev-parse', '--verify', `${source}^{commit}`])).stdout.trim()
    const pushUrl = await this.pushUrl(cwd, remote)
    if (expected !== undefined && (expected.sourceOid !== sourceOid || expected.pushUrl !== pushUrl)) {
      throw new Error('push source or destination changed after approval; request a new preview')
    }
    try {
      await this.run(cwd, ['push', '--', pushUrl, `${sourceOid}:${target}`])
    } catch (error) {
      if (error instanceof GitCommandFailedError) {
        throw new GitPushRefusedError(classifyPushFailure(error.stderr), error.stderr)
      }
      throw error
    }
    // The remote ref's new SHA: the push succeeded, so the remote is
    // reachable; ls-remote reads the authoritative remote fact.
    const ls = await this.run(cwd, ['ls-remote', '--', pushUrl, target])
    const pushedSha = ls.stdout.split('\n').find(line => line !== '')?.split('\t')[0] ?? ''
    if (pushedSha === '') {
      throw new GitCommandFailedError(
        ['git', 'ls-remote', remote], cwd, null,
        'push succeeded but the remote ref was not reported',
      )
    }
    // Pushing to the exact URL (the approved destination) bypasses git's
    // own bookkeeping: only a push through the remote NAME advances the
    // remote-tracking ref. Without this, `status` keeps reporting the branch
    // ahead until someone fetches (pre-release review 2026-09-06). Best
    // effort: the push already happened, so a bookkeeping failure must not
    // turn the outcome into an error.
    try {
      await this.run(cwd, ['update-ref', `refs/remotes/${remote}/${remoteBranch}`, pushedSha])
    } catch {
      // The tracking ref catches up at the next fetch.
    }
    return { remote, remoteBranch, pushedSha }
  }

  private async resolveExecutable(): Promise<string> {
    try {
      return await this.ctx.subprocess.resolveExecutable('git')
    } catch (error) {
      throw new GitUnavailableError(
        `'git' is not resolvable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Check the installed version once; every later query trusts the result. */
  private async ensureUsable(): Promise<void> {
    if (this.versionChecked) return
    const git = await this.resolveGit()
    let output: string
    let stderr = ''
    let exitCode: number | null
    try {
      const handle = this.spawn(process.cwd(), git, ['--version'], undefined)
      const outcome = await handle.done
      exitCode = outcome.exitCode
      output = handle.collected.stdout?.readFrom(0).text ?? ''
      stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    } catch (error) {
      throw new GitUnavailableError(
        `'git --version' could not run: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (exitCode !== 0) {
      throw new GitCommandFailedError([git, '--version'], process.cwd(), exitCode, stderr)
    }
    const version = parseGitVersion(output)
    const [minimumMajor, minimumMinor] = MINIMUM_GIT_VERSION.split('.').map(Number) as [number, number]
    if (version.major < minimumMajor || (version.major === minimumMajor && version.minor < minimumMinor)) {
      throw new GitUnsupportedVersionError(version.raw, MINIMUM_GIT_VERSION)
    }
    this.versionChecked = true
  }

  /** Run one git command with exact argv and bounded collected output. */
  private async run(
    cwd: string,
    args: readonly string[],
    options: { maxBytes?: number; notARepository?: boolean; stdin?: string } = {},
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const git = await this.resolveGit()
    let outcome: SubprocessOutcome
    let stdout = ''
    let stderr = ''
    let lossy = false
    try {
      const handle = this.spawn(cwd, git, args, options.maxBytes, options.stdin)
      outcome = await handle.done
      const read = handle.collected.stdout?.readFrom(0)
      stdout = read?.text ?? ''
      lossy = read?.lossy === true
      stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    } catch (error) {
      throw new GitUnavailableError(
        `git ${args.join(' ')} could not run: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (lossy) {
      throw new GitDiffTooLargeError(args.join(' '), options.maxBytes ?? READ_MODEL_MAX_BYTES)
    }
    if (outcome.exitCode !== 0) {
      if (options.notARepository === true && outcome.exitCode === 128) {
        throw new GitNotARepositoryError(cwd)
      }
      throw new GitCommandFailedError([git, ...args], cwd, outcome.exitCode, stderr)
    }
    return { stdout, stderr, exitCode: outcome.exitCode }
  }

  private spawn(
    cwd: string,
    git: string,
    args: readonly string[],
    maxBytes: number | undefined,
    stdin?: string,
  ): ReturnType<SubprocessRuntime['spawn']> {
    return this.ctx.subprocess.spawn({
      argv: [git, ...args],
      cwd,
      env: { GIT_OPTIONAL_LOCKS: '0' },
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: maxBytes ?? READ_MODEL_MAX_BYTES },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: GIT_QUERY_GRACE_MS,
      signal: AbortSignal.timeout(GIT_QUERY_TIMEOUT_MS),
    })
  }
}

export default LocalGitCapability
