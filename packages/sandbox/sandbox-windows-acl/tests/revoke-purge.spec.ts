/**
 * DeepSeekGUI (2026-09-29): taking a workspace grant back, cleaning a
 * folder's sandbox marks, and probing a root — against REAL directory DACLs
 * and labels (observed through icacls, the operator's own tool), plus the
 * `acl-helper` argv contract and its process entry. Win32-only for the ACL
 * parts, like the other real-FFI suites.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { AclWriteGrant, workspaceWriteSid } from '../src/index.ts'
import { parseHelperArgs, runHelper } from '../src/helper.ts'

const isWin32 = process.platform === 'win32'
const helperEntry = fileURLToPath(new URL('../src/acl-helper.ts', import.meta.url))

/** The directory's security as icacls renders it (the operator-visible form). */
function icaclsText(path: string): string {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' })
  expect(result.status, `icacls failed: ${result.stderr}`).toBe(0)
  return result.stdout
}

/** The lines icacls prints for this sandbox scheme's marks on `path` itself (explicit only). */
function marks(path: string): string[] {
  return icaclsText(path).split(/\r?\n/u)
    .map(line => line.replace(path, '').trim())
    .filter(line => /S-1-4-|DENY|Mandatory Label/u.test(line) && !line.includes('(I)'))
}

/** A probe with a throwaway SID: only its `marks` answer is SID-independent. */
function inspect(root: string, sid = workspaceWriteSid(root)): { grant: boolean; marks: boolean } {
  const probe = AclWriteGrant.create(sid)
  try {
    return probe.inspect(root)
  } finally {
    probe.dispose()
  }
}

describe('acl-helper argv', () => {
  it('parses each command with its workspace and read-only directories', () => {
    expect(parseHelperArgs(['grant', '--workspace', 'C:\\ws', '--read-only', 'C:\\ws\\a\\.git', '--read-only', 'C:\\ws\\b'])).toEqual({
      command: 'grant', workspace: 'C:\\ws', readOnly: ['C:\\ws\\a\\.git', 'C:\\ws\\b'],
    })
    expect(parseHelperArgs(['revoke', '--workspace', 'C:\\ws'])).toEqual({ command: 'revoke', workspace: 'C:\\ws', readOnly: [] })
    expect(parseHelperArgs(['purge', '--workspace', 'C:\\ws'])).toEqual({ command: 'purge', workspace: 'C:\\ws', readOnly: [] })
  })

  it('refuses anything else', () => {
    expect(() => parseHelperArgs([])).toThrow('unknown command: undefined')
    expect(() => parseHelperArgs(['chmod', '--workspace', 'C:\\ws'])).toThrow('unknown command: chmod')
    expect(() => parseHelperArgs(['grant', '--workspace'])).toThrow('missing value after --workspace')
    expect(() => parseHelperArgs(['grant', '--everyone', 'yes'])).toThrow('unknown argument: --everyone')
    expect(() => parseHelperArgs(['grant'])).toThrow('missing --workspace')
    expect(() => parseHelperArgs(['revoke', '--workspace', 'C:\\ws', '--read-only', 'C:\\ws\\.git'])).toThrow('revoke does not accept --read-only')
  })

  it('refuses a workspace that is not an existing directory, before touching any ACL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-acl-helper-args-'))
    try {
      const file = join(dir, 'file.txt')
      writeFileSync(file, '')
      expect(() => runHelper({ command: 'purge', workspace: join(dir, 'gone'), readOnly: [] })).toThrow('--workspace is not an existing directory')
      expect(() => runHelper({ command: 'purge', workspace: file, readOnly: [] })).toThrow('--workspace is not an existing directory')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('the process entry reports failure on stderr with exit 1', () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx/esm', helperEntry, 'chmod'], { encoding: 'utf8', timeout: 30_000 })
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('acl-helper: unknown command: chmod\n')
  }, 30_000)
})

describe.skipIf(!isWin32)('taking a workspace grant back, and cleaning marks (real ACLs)', () => {
  const scratchDirs: string[] = []
  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** A workspace with a .git, a nested repository, a file, and the user's own Everyone entry. */
  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-revoke-'))
    scratchDirs.push(root)
    mkdirSync(join(root, '.git'))
    mkdirSync(join(root, 'child', '.git'), { recursive: true })
    writeFileSync(join(root, 'a.txt'), 'a')
    const own = spawnSync('icacls', [root, '/grant', '*S-1-1-0:(OI)(CI)(RX)'], { encoding: 'utf8' })
    expect(own.status, own.stdout).toBe(0)
    return root
  }

  it('the process entry grants, then takes the grant back: the folder is an ordinary folder again and the user\'s entry stays', () => {
    const root = workspace()
    const nested = join(root, 'child', '.git')
    const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx/esm', helperEntry, ...args], { encoding: 'utf8', timeout: 60_000 })

    expect(inspect(root)).toEqual({ grant: false, marks: false })
    const granted = run('grant', '--workspace', root, '--read-only', nested)
    expect(granted.status, granted.stderr).toBe(0)
    expect(JSON.parse(granted.stdout)).toMatchObject({ ok: true, changed: true })
    expect(inspect(root)).toEqual({ grant: true, marks: true })
    expect(marks(root).some(line => line.includes('Mandatory Label\\Low Mandatory Level'))).toBe(true)
    expect(marks(root).some(line => line.includes('Everyone:(CI)(DENY)'))).toBe(true)
    expect(marks(join(root, 'a.txt')).length).toBe(0) // inherited only
    expect(icaclsText(join(root, 'a.txt'))).toContain('Low Mandatory Level')

    const revoked = run('revoke', '--workspace', root)
    expect(revoked.status, revoked.stderr).toBe(0)
    expect(JSON.parse(revoked.stdout)).toMatchObject({ ok: true, changed: true })
    expect(inspect(root)).toEqual({ grant: false, marks: false })
    expect(marks(root)).toEqual([])
    expect(icaclsText(join(root, 'a.txt'))).not.toContain('Low Mandatory Level')
    expect(icaclsText(root)).toMatch(/Everyone:\(OI\)\(CI\)\(RX\)/u)
    // The read-only denies name only the capability SID: inert without the grant, and left alone.
    expect(marks(join(root, '.git')).some(line => line.includes('S-1-4-'))).toBe(true)

    // A second revoke is one read and no write.
    const again = run('revoke', '--workspace', root)
    expect(JSON.parse(again.stdout)).toMatchObject({ ok: true, changed: false })
  }, 120_000)

  it('keeps the shared deny and label while another capability grant stands on the folder', () => {
    const root = workspace()
    const own = AclWriteGrant.create(workspaceWriteSid(root))
    const other = AclWriteGrant.create('S-1-4-9000-91')
    try {
      own.add(root, true)
      other.add(root, true)
      expect(own.revokeStanding(root)).toBe(true)
      expect(inspect(root)).toEqual({ grant: false, marks: true })
      expect(marks(root).some(line => line.includes('Low Mandatory Level'))).toBe(true)
      expect(marks(root).some(line => line.includes('Everyone:(CI)(DENY)'))).toBe(true)
      expect(icaclsText(root)).not.toContain(workspaceWriteSid(root))
      expect(icaclsText(root)).toContain('S-1-4-9000-91')
    } finally {
      own.dispose()
      other.dispose()
    }
  })

  it('cleans every mark whatever SID made it, on the root and its read-only directories, and nothing else', () => {
    const root = workspace()
    const nested = join(root, 'child', '.git')
    const older = AclWriteGrant.create('S-1-4-9000-92') // a workspace path spelled differently, or an older build
    try {
      older.add(root, true, [nested])
    } finally {
      older.dispose()
    }
    expect(inspect(root)).toEqual({ grant: false, marks: true })
    expect(runHelper({ command: 'purge', workspace: root, readOnly: [nested, join(root, 'gone'), join(root, 'a.txt'), tmpdir()] })).toBe(true)
    expect(marks(root)).toEqual([])
    expect(marks(join(root, '.git'))).toEqual([])
    expect(marks(nested)).toEqual([])
    expect(icaclsText(root)).toMatch(/Everyone:\(OI\)\(CI\)\(RX\)/u)
    expect(inspect(root)).toEqual({ grant: false, marks: false })
    expect(runHelper({ command: 'purge', workspace: root, readOnly: [] })).toBe(false)
  })

  it('leaves an inherited mark to the ancestor that carries it', () => {
    const root = workspace()
    const inner = join(root, 'inner')
    mkdirSync(inner)
    const grant = AclWriteGrant.create(workspaceWriteSid(root))
    try {
      grant.add(root, true)
    } finally {
      grant.dispose()
    }
    expect(inspect(inner)).toEqual({ grant: false, marks: false })
    expect(runHelper({ command: 'purge', workspace: inner, readOnly: [] })).toBe(false)
    expect(icaclsText(inner)).toContain('Low Mandatory Level')
    expect(runHelper({ command: 'revoke', workspace: root, readOnly: [] })).toBe(true)
    expect(icaclsText(inner)).not.toContain('Low Mandatory Level')
  })
})
