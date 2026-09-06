/**
 * Index/revert operation specs (B4-P4) over REAL repositories: hunk
 * stage/unstage through `git apply --cached` fed from git-diff facts via the
 * subprocess stdin, file stage/unstage, and controlled tracked revert — with
 * the partial-stage, stale-hunk, external-concurrency, rename, binary,
 * conflict, failed-apply, and revert-refusal matrix. Every patch byte comes
 * from a real `git diff` capture, never a hand-written mock.
 * @module @deepseek-ai/dsh-git-local/tests/index-ops
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalGitCapability from '@deepseek-ai/dsh-git-local'
import { GitCommandFailedError } from '@deepseek-ai/dsh-git'
import type { RepoStatus } from '@deepseek-ai/dsh-git/types'

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const disposables: (() => void)[] = []

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: tmpdir() }

function git(dir: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env,
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

/** Stage a real repository with one seed commit (30 numbered lines). */
function stageRepo(prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `dsh-git-${prefix}-`)))
  disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
  git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
  git(dir, ['config', 'core.autocrlf', 'false'])
  const seed = Array.from({ length: 30 }, (_, i) => `line${String(i + 1).padStart(2, '0')}`).join('\n') + '\n'
  writeFileSync(join(dir, 'a.txt'), seed)
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first'])
  return dir
}

function commitAll(dir: string, message: string): void {
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
  git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', message])
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(LocalGitCapability)
  return ctx.git
}

/**
 * Split one file patch into its header (through the last line before the
 * first hunk) and one hunk per `@@` record, each newline-terminated — the
 * exact shape the GUI sends back to `applyIndexPatch`.
 */
function splitHunks(patch: string): { header: string; hunks: string[] } {
  const lines = patch.split('\n')
  const firstHunk = lines.findIndex(line => line.startsWith('@@ '))
  const starts = lines
    .map((line, index) => line.startsWith('@@ ') ? index : -1)
    .filter(index => index !== -1)
  const hunks = starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length
    return lines.slice(start, end).join('\n') + '\n'
  })
  const header = firstHunk === -1 ? patch : lines.slice(0, firstHunk).join('\n') + '\n'
  return { header, hunks }
}

/** The staged/unstaged entry of one path in the authoritative status. */
function entryOf(status: RepoStatus, path: string): RepoStatus['entries'][number] | undefined {
  return status.entries.find(entry => entry.path === path || entry.origPath === path)
}

afterEach(() => {
  while (disposables.length > 0) disposables.pop()?.()
})

describe.skipIf(!gitAvailable)('Git index operations over real repositories (B4-P4)', () => {
  it('stages one hunk of a two-hunk change: partial stage, then unstages it', async () => {
    const dir = stageRepo('partial')
    writeFileSync(join(dir, 'a.txt'),
      'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nLINE27\nline28\nline29\nline30\n')
    const gitCap = await harness()
    const unstaged = await gitCap.diff(dir, 'unstaged', 'a.txt', true)
    const { header, hunks } = splitHunks(unstaged.patch ?? '')
    expect(hunks.length).toBe(2)

    // Stage only the first hunk: the index moves half-way, the work tree is
    // untouched, and the authoritative status shows the same path as one `MM`
    // record — staged (index column) and unstaged (work-tree column) at once.
    await gitCap.applyIndexPatch(dir, header + (hunks[0] ?? ''), false)
    let status = await gitCap.status(dir)
    const entry = entryOf(status, 'a.txt')
    expect(entry?.kind).toBe('staged')
    expect(entry?.x).toBe('M')
    expect(entry?.y).toBe('M')
    expect(status.entries.filter(candidate => candidate.path === 'a.txt')).toHaveLength(1)
    const stagedPatch = (await gitCap.diff(dir, 'staged', 'a.txt', true)).patch ?? ''
    expect(stagedPatch).toContain('LINE03')
    expect(stagedPatch).not.toContain('LINE27')
    const remaining = (await gitCap.diff(dir, 'unstaged', 'a.txt', true)).patch ?? ''
    expect(remaining).toContain('LINE27')
    expect(remaining).not.toContain('LINE03')

    // Unstage the staged hunk by reverse-applying the staged patch fact.
    await gitCap.applyIndexPatch(dir, stagedPatch, true)
    status = await gitCap.status(dir)
    expect(entryOf(status, 'a.txt')?.kind).toBe('unstaged')
    expect(entryOf(status, 'a.txt')?.x).toBe('.')
    expect(entryOf(status, 'a.txt')?.y).toBe('M')
    expect(status.entries.filter(candidate => candidate.path === 'a.txt')).toHaveLength(1)
  })

  it('refuses a stale hunk after external modification (git validates the context)', async () => {
    const dir = stageRepo('stale')
    writeFileSync(join(dir, 'a.txt'),
      'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\n')
    const gitCap = await harness()
    const patch = (await gitCap.diff(dir, 'unstaged', 'a.txt', true)).patch ?? ''
    // The index advances externally (the whole file gets staged) while the
    // hunk patch was computed against the older index snapshot: the context
    // no longer matches the current index, and git refuses with the raw
    // stderr. A stale hunk is an index-context mismatch, never a guess.
    await gitCap.stageFile(dir, 'a.txt')
    await expect(gitCap.applyIndexPatch(dir, patch, false))
      .rejects.toBeInstanceOf(GitCommandFailedError)
    // Nothing was half-applied: the index still holds the staged whole file.
    const status = await gitCap.status(dir)
    expect(status.entries.some(entry => entry.path === 'a.txt' && entry.kind === 'staged')).toBe(true)
  })

  it('re-reads authoritative state after external concurrency during unstage', async () => {
    const dir = stageRepo('concurrent')
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\nEXTERNAL\n')
    const gitCap = await harness()
    await gitCap.stageFile(dir, 'a.txt')
    // External edit lands in the work tree while the file is staged; the
    // staged patch reverse-apply only touches the index, so it succeeds and
    // the re-read status reflects the external edit as unstaged.
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\nEXTERNAL2\n')
    await gitCap.unstageFile(dir, 'a.txt')
    const status = await gitCap.status(dir)
    const entry = entryOf(status, 'a.txt')
    expect(entry?.kind).toBe('unstaged')
    expect(entry?.x).toBe('.')
    expect(entry?.y).toBe('M')
  })

  it('stages and unstages a rename', async () => {
    const dir = stageRepo('rename')
    // A work-tree move (NOT `git mv`, which stages by itself): porcelain v2
    // honestly reports it as a deleted path plus an untracked path — the
    // rename is Git's detection fact AFTER the delete side is staged.
    renameSync(join(dir, 'a.txt'), join(dir, 'b.txt'))
    const gitCap = await harness()
    let status = await gitCap.status(dir)
    expect(entryOf(status, 'a.txt')?.kind).toBe('unstaged')
    expect(entryOf(status, 'a.txt')?.y).toBe('D')
    expect(entryOf(status, 'b.txt')?.kind).toBe('untracked')

    // Staging the untracked side first, then the deleted side, lets Git
    // detect the staged rename.
    await gitCap.stageFile(dir, 'b.txt')
    status = await gitCap.status(dir)
    expect(entryOf(status, 'b.txt')?.kind).toBe('staged')
    await gitCap.stageFile(dir, 'a.txt')
    status = await gitCap.status(dir)
    const renamed = entryOf(status, 'b.txt')
    expect(renamed?.kind).toBe('staged')
    expect(renamed?.x).toBe('R')
    expect(renamed?.origPath).toBe('a.txt')

    // Unstage reverts both index sides: the index holds a.txt again, the
    // work tree still only has b.txt.
    await gitCap.unstageFile(dir, 'b.txt')
    status = await gitCap.status(dir)
    expect(entryOf(status, 'b.txt')?.kind).toBe('untracked')
    expect(entryOf(status, 'a.txt')?.kind).toBe('unstaged')
    expect(git(dir, ['ls-files'])).toContain('a.txt')
    expect(git(dir, ['ls-files'])).not.toContain('b.txt')
  })

  it('stages and unstages a binary file', async () => {
    const dir = stageRepo('binary')
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xfe, 0xff]))
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'add', '-A'])
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed-binary'])
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]))
    const gitCap = await harness()
    await gitCap.stageFile(dir, 'blob.bin')
    let status = await gitCap.status(dir)
    expect(entryOf(status, 'blob.bin')?.kind).toBe('staged')
    await gitCap.unstageFile(dir, 'blob.bin')
    status = await gitCap.status(dir)
    expect(entryOf(status, 'blob.bin')?.kind).toBe('unstaged')
  })

  it('stages an untracked file and unstages it back on an unborn HEAD', async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-git-unborn-')))
    disposables.push(() => { rmSync(dir, { recursive: true, force: true }) })
    git(dir, ['-c', 'init.defaultBranch=main', 'init', '-q'])
    git(dir, ['config', 'core.autocrlf', 'false'])
    writeFileSync(join(dir, 'new.txt'), 'fresh\n')
    const gitCap = await harness()
    await gitCap.stageFile(dir, 'new.txt')
    let status = await gitCap.status(dir)
    expect(entryOf(status, 'new.txt')?.kind).toBe('staged')
    expect(entryOf(status, 'new.txt')?.x).toBe('A')
    // No HEAD exists, yet the reverse apply moves the staged file out of the
    // index and it reads as untracked again.
    await gitCap.unstageFile(dir, 'new.txt')
    status = await gitCap.status(dir)
    expect(entryOf(status, 'new.txt')?.kind).toBe('untracked')
    expect(git(dir, ['ls-files'])).toBe('')
  })

  it('refuses to apply garbage and refuses a patch with stale context', async () => {
    const dir = stageRepo('garbage')
    const gitCap = await harness()
    await expect(gitCap.applyIndexPatch(dir, 'this is not a patch\n', false))
      .rejects.toBeInstanceOf(GitCommandFailedError)
    // A well-formed patch whose context does not match the file at all.
    const fake = 'diff --git a/a.txt b/a.txt\nindex 0000000..1111111 100644\n'
      + '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-no such line\n+replacement\n'
    await expect(gitCap.applyIndexPatch(dir, fake, false))
      .rejects.toBeInstanceOf(GitCommandFailedError)
    const status = await gitCap.status(dir)
    expect(status.clean).toBe(true)
  })

  it('reverts a tracked file: discards unstaged, keeps staged', async () => {
    const dir = stageRepo('revert')
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\n')
    const gitCap = await harness()
    await gitCap.stageFile(dir, 'a.txt')
    // An unstaged edit lands on top of the staged one.
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\nSTAGED-AND-UNSTAGED\n')
    await gitCap.revertFile(dir, 'a.txt')
    const status = await gitCap.status(dir)
    const entry = entryOf(status, 'a.txt')
    // The unstaged tail is gone; the staged edit remains staged.
    expect(entry?.kind).toBe('staged')
    expect(entry?.x).toBe('M')
    expect(entry?.y).toBe('.')
    expect(git(dir, ['show', ':a.txt'])).toContain('LINE03')
    expect(git(dir, ['show', ':a.txt'])).not.toContain('STAGED-AND-UNSTAGED')
  })

  it('refuses revert of an untracked file and of a conflict entry', async () => {
    const dir = stageRepo('revert-refuse')
    writeFileSync(join(dir, 'new.txt'), 'fresh\n')
    const gitCap = await harness()
    await expect(gitCap.revertFile(dir, 'new.txt'))
      .rejects.toMatchObject({ name: 'GitRevertRefusedError', reason: 'untracked' })
    expect(git(dir, ['ls-files'])).not.toContain('new.txt')

    // A real conflict: two branches edit the same line, then merge.
    git(dir, ['checkout', '-q', '-b', 'side'])
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nSIDE\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\n')
    commitAll(dir, 'side edit')
    git(dir, ['checkout', '-q', 'main'])
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nMAIN\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\n')
    commitAll(dir, 'main edit')
    try {
      // The merge needs a committer identity even when it only conflicts.
      git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@t', 'merge', 'side'])
    } catch {
      // Expected: the merge conflicts.
    }
    let status = await gitCap.status(dir)
    expect(entryOf(status, 'a.txt')?.kind).toBe('conflict')
    await expect(gitCap.revertFile(dir, 'a.txt'))
      .rejects.toMatchObject({ name: 'GitRevertRefusedError', reason: 'conflict' })
    // The conflict markers live in the WORK TREE file; `git show` reads the
    // HEAD blob and would never show them. Nothing auto-resolved.
    expect(git(dir, ['show', 'HEAD:a.txt'])).not.toContain('<<<<<<<')
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('<<<<<<<')
    // A staged hunk application onto a conflicted path is refused by git.
    const unstaged = await gitCap.diff(dir, 'unstaged', 'a.txt', true)
    const { header, hunks } = splitHunks(unstaged.patch ?? '')
    await expect(gitCap.applyIndexPatch(dir, header + (hunks[0] ?? ''), false))
      .rejects.toBeInstanceOf(GitCommandFailedError)
    status = await gitCap.status(dir)
    expect(entryOf(status, 'a.txt')?.kind).toBe('conflict')
  })

  it('unstage of a path with no staged changes is a no-op', async () => {
    const dir = stageRepo('noop')
    writeFileSync(join(dir, 'a.txt'), 'line01\nline02\nLINE03\nline04\nline05\nline06\nline07\nline08\nline09\nline10\n'
      + 'line11\nline12\nline13\nline14\nline15\nline16\nline17\nline18\nline19\nline20\n'
      + 'line21\nline22\nline23\nline24\nline25\nline26\nline27\nline28\nline29\nline30\n')
    const gitCap = await harness()
    // The unstaged edit stays put: unstage touches only the index.
    await gitCap.unstageFile(dir, 'a.txt')
    const status = await gitCap.status(dir)
    const entry = entryOf(status, 'a.txt')
    expect(entry?.kind).toBe('unstaged')
    expect(entry?.x).toBe('.')
    expect(entry?.y).toBe('M')
    // The work-tree file keeps the edit; only the index was untouched.
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('LINE03')
  })
})
