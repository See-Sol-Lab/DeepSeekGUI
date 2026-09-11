/**
 * GitHub CLI pull-request provider (B4-P6): implements the pull-request
 * capability seam over the subprocess seam — the user's logged-in `gh`, exact
 * executable + argv, never a shell string, bounded collected output. The
 * product never reads, displays, or stores a token: the login lives entirely
 * in gh's own configuration, and the provider only asks gh for its facts.
 * Every failure carries the raw stderr verbatim.
 * @module @deepseek-ai/dsh-pull-request-gh
 */

import PullRequestCapability, {
  PullRequestFailedError, PullRequestUnavailableError,
} from '@deepseek-ai/dsh-pull-request'
// Type-only: brings the `ctx.subprocess` Context merge into this program.
import type {} from '@deepseek-ai/dsh-subprocess'
import type {
  CreatedPullRequest, ExistingPullRequest, PullRequestAvailability,
} from '@deepseek-ai/dsh-pull-request/types'

/** Bound on any single captured gh stream (status/list/create output). */
const GH_OUTPUT_MAX_BYTES = 4 * 1024 * 1024

/** Grace before a kill escalates on terminate paths. */
const GH_GRACE_MS = 5_000

/** Every gh call is bounded: a hung provider must not hold the UI forever. */
const GH_TIMEOUT_MS = 60_000

/**
 * Classify a `gh pr create` failure from gh's own stderr vocabulary (B4-P6).
 * The raw stderr always rides along; this only names the failure class. The
 * already-exists case extracts the existing PR's URL when gh printed one.
 * @param stderr - The raw gh stderr.
 * @returns the classified failure with the extracted URL, when present.
 */
export function classifyGhCreateFailure(stderr: string): {
  reason: 'already-exists' | 'auth' | 'other'
  url?: string
} {
  if (/already exists|pull request.*exists|a pull request for branch/u.test(stderr)) {
    const url = /https?:\/\/\S+\/pull\/\d+/u.exec(stderr)?.[0]
    return { reason: 'already-exists', ...url === undefined ? {} : { url } }
  }
  if (/not logged in|Authentication failed|auth failed|gh auth login|unauthorized/iu.test(stderr)) {
    return { reason: 'auth' }
  }
  return { reason: 'other' }
}

/** GitHub CLI pull-request provider (`ctx.pullRequest`). */
export default class GhPullRequestProvider extends PullRequestCapability {
  /** Runs every gh command through the subprocess seam. */
  static inject = ['subprocess']
  /** Run one gh command with exact argv and bounded collected output. */
  private async run(
    cwd: string,
    args: readonly string[],
    stdin?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const gh = await this.ctx.subprocess.resolveExecutable('gh')
    const signal = AbortSignal.timeout(GH_TIMEOUT_MS)
    const handle = this.ctx.subprocess.spawn({
      argv: [gh, ...args],
      cwd,
      stdio: {
        stdin: stdin === undefined ? 'ignore' : { data: stdin },
        stdout: { maxBytes: GH_OUTPUT_MAX_BYTES },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: GH_GRACE_MS,
      signal,
    })
    const outcome = await handle.done
    if (signal.aborted) throw new PullRequestFailedError('The GitHub command timed out; verify the remote state before retrying.', 'other')
    if (handle.collected.stdout?.readFrom(0).lossy) throw new PullRequestFailedError('GitHub output was truncated; verify the remote state before retrying.', 'other')
    return {
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      exitCode: outcome.exitCode,
    }
  }

  async availability(cwd: string): Promise<PullRequestAvailability> {
    let output: { stdout: string; stderr: string; exitCode: number | null }
    try {
      output = await this.run(cwd, ['auth', 'status'])
    } catch (error) {
      // resolveExecutable failed: the provider executable is missing.
      if (error instanceof Error && /was not found on PATH|is not an executable file/u.test(error.message)) {
        return { available: false, reason: 'missing-gh' }
      }
      throw error
    }
    if (output.exitCode !== 0) {
      return { available: false, reason: 'not-authenticated' }
    }
    // `gh auth status` prints, per host: `Logged in to <host> account <account>`.
    // Only the host and account are read — never a token.
    const match = /Logged in to (\S+) account (\S+)/u.exec(`${output.stdout}\n${output.stderr}`)
    if (match === null) {
      return { available: true, auth: { host: '(unknown)', account: '(unknown)' } }
    }
    return { available: true, auth: { host: match[1] ?? '', account: match[2] ?? '' } }
  }

  async existing(cwd: string, head: string): Promise<ExistingPullRequest | undefined> {
    const output = await this.run(cwd, ['pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url'])
    if (output.exitCode !== 0) {
      throw new PullRequestFailedError(output.stderr, 'other')
    }
    let rows: unknown
    try {
      rows = JSON.parse(output.stdout)
    } catch {
      throw new PullRequestFailedError(`gh pr list printed non-JSON output: ${output.stdout.slice(0, 200)}`, 'other')
    }
    if (!Array.isArray(rows)) {
      throw new PullRequestFailedError(`gh pr list printed an unexpected shape: ${output.stdout.slice(0, 200)}`, 'other')
    }
    const first = rows[0] as { number?: unknown; url?: unknown } | undefined
    if (first === undefined) return undefined
    if (typeof first.number !== 'number' || typeof first.url !== 'string') {
      throw new PullRequestFailedError(`gh pr list row lacks number/url: ${JSON.stringify(first).slice(0, 200)}`, 'other')
    }
    return { number: first.number, url: first.url }
  }

  async create(
    cwd: string,
    opts: { title: string; body: string; base: string; head: string; draft: boolean },
  ): Promise<CreatedPullRequest> {
    // The title, body, base, and head ride argv verbatim — nothing is
    // shell-interpreted; a draft is a flag, never a string. gh prints the new
    // PR's URL on stdout (no --json on `gh pr create`), so the number is
    // read from the URL itself.
    const args = [
      'pr', 'create',
      '--title', opts.title,
      '--body-file', '-',
      '--base', opts.base,
      '--head', opts.head,
      ...opts.draft ? ['--draft'] : [],
    ]
    let output: { stdout: string; stderr: string; exitCode: number | null }
    try {
      output = await this.run(cwd, args, opts.body)
    } catch (error) {
      if (error instanceof Error && /was not found on PATH|is not an executable file/u.test(error.message)) {
        throw new PullRequestUnavailableError('missing-gh')
      }
      throw error
    }
    if (output.exitCode !== 0) {
      const classified = classifyGhCreateFailure(output.stderr)
      throw new PullRequestFailedError(output.stderr, classified.reason, classified.url)
    }
    const url = output.stdout.split('\n').find(line => /\/pull\/\d+/u.test(line))?.trim() ?? ''
    const number = /\/pull\/(\d+)/u.exec(url)?.[1]
    if (url === '' || number === undefined) {
      throw new PullRequestFailedError(
        `gh pr create reported no PR URL: ${output.stdout}`,
        'other',
      )
    }
    return { url, number: Number(number) }
  }
}
