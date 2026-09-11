/**
 * B6-2: canonical reveal-target resolution — relative and absolute paths,
 * traversal and symlink escape rejection, missing targets, and non-ASCII
 * path segments, then the repository widening a subdirectory session needs.
 * The first six cases pin the cwd-only behaviour that must not change.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { containedTargetOf, repositoryRootOf, revealTargetOf } from '../src/reveal-target.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function stage() {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-reveal-')); roots.push(temporary)
  const root = join(temporary, 'repo 中文'); mkdirSync(root)
  const file = join(root, 'src', '新 文件.txt')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(file, 'x')
  const outside = join(temporary, 'outside'); mkdirSync(outside)
  writeFileSync(join(outside, 'secret.txt'), 'x')
  return { temporary, root, file, outside }
}

describe('revealTargetOf', () => {
  it('resolves a cwd-relative path inside the workspace', () => {
    const { root, file } = stage()
    expect(revealTargetOf(root, join('src', '新 文件.txt'))).toEqual({ kind: 'ok', target: realpathSync(file) })
  })

  it('resolves an absolute path inside the workspace', () => {
    const { root, file } = stage()
    expect(revealTargetOf(root, file)).toEqual({ kind: 'ok', target: realpathSync(file) })
  })

  it('rejects parent traversal and absolute paths outside the workspace', () => {
    const { root, outside } = stage()
    expect(revealTargetOf(root, join('..', 'outside', 'secret.txt')).kind).toBe('outside')
    expect(revealTargetOf(root, join(outside, 'secret.txt')).kind).toBe('outside')
  })

  it('rejects a symlink that escapes the workspace', () => {
    const { root, outside } = stage()
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(revealTargetOf(root, join('escape', 'secret.txt')).kind).toBe('outside')
  })

  it('names the missing target path', () => {
    const { root } = stage()
    expect(revealTargetOf(root, join('src', 'nope.txt'))).toEqual({
      kind: 'missing',
      target: join(root, 'src', 'nope.txt'),
    })
  })

  it('names the workspace root itself when the root is gone', () => {
    const { root } = stage()
    rmSync(root, { recursive: true, force: true })
    expect(revealTargetOf(root, 'x.txt')).toEqual({ kind: 'missing', target: root })
  })
})

/**
 * Stage a repository whose session cwd is a subdirectory — the B6-2 shape.
 * `marker` picks the `.git` entry kind: a directory for an ordinary clone,
 * a file for a linked worktree or a submodule.
 */
function stageRepository(marker: 'dir' | 'file' = 'dir') {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-reveal-repo-')); roots.push(temporary)
  const repository = join(temporary, 'repo 中文'); mkdirSync(repository)
  if (marker === 'dir') mkdirSync(join(repository, '.git'))
  else writeFileSync(join(repository, '.git'), 'gitdir: ../.git/worktrees/w\n')
  const rootFile = join(repository, 'package.json')
  writeFileSync(rootFile, '{}')
  const cwd = join(repository, 'apps', 'deepseekgui')
  mkdirSync(cwd, { recursive: true })
  const localFile = join(cwd, 'local.txt')
  writeFileSync(localFile, 'x')
  const sibling = join(temporary, 'outside'); mkdirSync(sibling)
  const secret = join(sibling, 'secret.txt'); writeFileSync(secret, 'x')
  return { temporary, repository, rootFile, cwd, localFile, secret }
}

describe('repositoryRootOf', () => {
  it('finds the nearest ancestor carrying a .git directory', () => {
    const { repository, cwd } = stageRepository('dir')
    expect(repositoryRootOf(cwd)).toBe(repository)
  })

  it('accepts a .git pointer file, so worktree and submodule sessions widen too', () => {
    const { repository, cwd } = stageRepository('file')
    expect(repositoryRootOf(cwd)).toBe(repository)
  })

  it('returns null when the cwd already carries the marker', () => {
    const { repository } = stageRepository('dir')
    expect(repositoryRootOf(repository)).toBeNull()
  })

  it('stops at the nearest marker, so a planted .git only ever narrows the root', () => {
    const { repository, cwd } = stageRepository('dir')
    const nearer = join(repository, 'apps')
    mkdirSync(join(nearer, '.git'))
    expect(repositoryRootOf(cwd)).toBe(nearer)
  })
})

describe('containedTargetOf', () => {
  it('keeps a workspace in no repository cwd-only', () => {
    const { root, outside } = stage()
    expect(containedTargetOf({ cwd: root, root, path: join(outside, 'secret.txt') }).kind).toBe('outside')
  })

  it('resolves relative text against the cwd, never against the wider root', () => {
    const { repository, cwd, localFile } = stageRepository('dir')
    expect(containedTargetOf({ cwd, root: repository, path: 'local.txt' }))
      .toEqual({ kind: 'ok', target: realpathSync(localFile) })
  })
})

describe('revealTargetOf across a repository', () => {
  it('reveals a repository-root file from a subdirectory session', () => {
    const { cwd, rootFile } = stageRepository('dir')
    expect(revealTargetOf(cwd, rootFile)).toEqual({ kind: 'ok', target: realpathSync(rootFile) })
  })

  it('still reveals a file inside the session cwd', () => {
    const { cwd, localFile } = stageRepository('dir')
    expect(revealTargetOf(cwd, localFile)).toEqual({ kind: 'ok', target: realpathSync(localFile) })
  })

  it('refuses a target outside the repository', () => {
    const { cwd, secret } = stageRepository('dir')
    expect(revealTargetOf(cwd, secret).kind).toBe('outside')
  })

  it('reveals a repository-root file from a worktree-shaped session', () => {
    const { cwd, rootFile } = stageRepository('file')
    expect(revealTargetOf(cwd, rootFile)).toEqual({ kind: 'ok', target: realpathSync(rootFile) })
  })

  it.runIf(process.platform === 'win32')('accepts a target whose drive spelling differs from the cwd', () => {
    const { cwd, rootFile } = stageRepository('dir')
    const shouted = cwd.replace(/^([a-z]):/iu, (_, drive: string) => `${drive.toUpperCase()}:`)
    const whispered = rootFile.replace(/^([a-z]):/iu, (_, drive: string) => `${drive.toLowerCase()}:`)
    expect(revealTargetOf(shouted, whispered).kind).toBe('ok')
  })

  it.runIf(process.platform !== 'win32')('keeps case-sensitive containment on POSIX', () => {
    const { temporary } = stageRepository('dir')
    const lower = join(temporary, 'case'); mkdirSync(lower)
    mkdirSync(join(lower, '.git'))
    const upper = join(temporary, 'CASE'); mkdirSync(upper)
    const target = join(upper, 'secret.txt'); writeFileSync(target, 'x')
    expect(revealTargetOf(lower, target).kind).toBe('outside')
  })
})
