/**
 * Tests for DeepSeekGUI's safety zones (2026-09-24): which roots count as
 * Windows, installed application code, and DeepSeekGUI's own code; which
 * workspaces are chat-only; and which concerns a command or a set of target
 * paths raises. Environment-dependent helpers take an explicit `env`, so the
 * zone tables are pinned without touching the real process environment.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  actionConcerns,
  canonicalPath,
  chatOnlyReason,
  commandConcerns,
  ELEVATED_ENV,
  GUI_ROOTS_ENV,
  guiSourceRoot,
  isElevatedHost,
  isGitMetadataPath,
  launchedByDesktop,
  protectedZones,
  readOnlySubtrees,
  zoneOfPath,
} from '@deepseek-ai/dsh-sandbox'

const windows = process.platform === 'win32'
const cleanups: string[] = []

/** A fresh temp directory, removed after the test. */
function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-zones-'))
  cleanups.push(directory)
  return directory
}

/** A fake DeepSeekGUI source checkout (the manifest is what marks it). */
function checkout(name = '@see-sol-lab/deepseekgui'): string {
  const root = scratch()
  mkdirSync(join(root, 'apps', 'deepseekgui'), { recursive: true })
  writeFileSync(join(root, 'apps', 'deepseekgui', 'package.json'), JSON.stringify({ name }))
  return root
}

afterEach(() => {
  for (const directory of cleanups.splice(0)) rmSync(directory, { recursive: true, force: true })
})

/** The Windows roots the desktop sees on an ordinary machine. */
const windowsEnv = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  ProgramW6432: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramData: 'C:\\ProgramData',
  LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local',
}

describe('protectedZones', () => {
  it('lists the DeepSeekGUI roots first and skips blank entries', () => {
    const install = scratch()
    const zones = protectedZones({ [GUI_ROOTS_ENV]: ['', install, ' '].join(process.platform === 'win32' ? ';' : ':') })
    expect(zones[0]).toEqual({ kind: 'gui', root: canonicalPath(install) })
    expect(zones.filter(zone => zone.kind === 'gui')).toHaveLength(1)
  })

  it.runIf(windows)('adds Windows and the application roots, deduplicated', () => {
    const zones = protectedZones(windowsEnv)
    expect(zones.map(zone => zone.kind)).toEqual(['system', 'apps', 'apps', 'apps', 'apps'])
    expect(zones.map(zone => zone.root.toLowerCase())).toEqual([
      'c:\\windows',
      'c:\\program files',
      'c:\\program files (x86)',
      'c:\\programdata',
      'c:\\users\\someone\\appdata\\local\\programs',
    ])
  })

  it.runIf(!windows)('has no Windows roots elsewhere', () => {
    expect(protectedZones({ SystemRoot: '/win' })).toEqual([])
  })
})

describe('zoneOfPath', () => {
  it.runIf(windows)('names the most specific zone, case-insensitively', () => {
    const env = { ...windowsEnv, [GUI_ROOTS_ENV]: 'C:\\Program Files\\DeepSeekGUI' }
    const zones = protectedZones(env)
    expect(zoneOfPath('C:\\Program Files\\DeepSeekGUI\\resources\\app.asar', zones, env)).toBe('gui')
    expect(zoneOfPath('c:\\program files\\Other\\app.exe', zones, env)).toBe('apps')
    expect(zoneOfPath('C:\\WINDOWS\\System32\\drivers\\etc\\hosts', zones, env)).toBe('system')
    expect(zoneOfPath('C:\\Windows.old\\x', zones, env)).toBeUndefined()
    expect(zoneOfPath('D:\\work\\project\\a.ts', zones, env)).toBeUndefined()
  })

  it('recognises a DeepSeekGUI source checkout only for a desktop-launched harness', () => {
    const root = checkout()
    const inside = join(root, 'packages', 'x', 'src', 'index.ts')
    const desktop = { [GUI_ROOTS_ENV]: join(scratch(), 'install') }
    expect(zoneOfPath(inside, [], desktop)).toBe('gui')
    expect(zoneOfPath(inside, [], {})).toBeUndefined()
    expect(guiSourceRoot(inside)).toBe(canonicalPath(root))
  })

  it('does not mistake another project with the same layout for DeepSeekGUI', () => {
    const root = checkout('@someone/else')
    const desktop = { [GUI_ROOTS_ENV]: join(scratch(), 'install') }
    expect(zoneOfPath(join(root, 'src', 'a.ts'), [], desktop)).toBeUndefined()
  })
})

describe('launchedByDesktop / isElevatedHost', () => {
  it('reads the desktop markers', () => {
    expect(launchedByDesktop({})).toBe(false)
    expect(launchedByDesktop({ [GUI_ROOTS_ENV]: '  ' })).toBe(false)
    expect(launchedByDesktop({ [GUI_ROOTS_ENV]: 'C:\\x' })).toBe(true)
    expect(isElevatedHost({})).toBe(false)
    expect(isElevatedHost({ [ELEVATED_ENV]: '0' })).toBe(false)
    expect(isElevatedHost({ [ELEVATED_ENV]: '1' })).toBe(true)
  })
})

describe('chatOnlyReason', () => {
  it('treats a drive root and the home directory as chat-only', () => {
    expect(chatOnlyReason(parse(tmpdir()).root, {})).toBe('drive-root')
    expect(chatOnlyReason(homedir(), {})).toBe('home')
  })

  it('leaves an ordinary project folder alone, including one inside the home directory', () => {
    expect(chatOnlyReason(scratch(), {})).toBeUndefined()
  })

  it.runIf(windows)('treats a system or application root — or a folder containing one — as chat-only', () => {
    const parent = scratch()
    const env = { ProgramData: join(parent, 'ProgramData'), SystemRoot: join(parent, 'Windows') }
    expect(chatOnlyReason(join(parent, 'Windows'), env)).toBe('system')
    expect(chatOnlyReason(join(parent, 'ProgramData', 'Vendor'), env)).toBe('apps')
    // The parent contains both; the first zone in the table names it.
    expect(chatOnlyReason(parent, env)).toBe('system')
  })
})

describe('isGitMetadataPath', () => {
  it('matches files inside a .git directory of the workspace only', () => {
    const root = scratch()
    expect(isGitMetadataPath(root, join(root, '.git', 'config'))).toBe(true)
    expect(isGitMetadataPath(root, join(root, 'vendor', 'lib', '.git', 'HEAD'))).toBe(true)
    expect(isGitMetadataPath(root, join(root, '.gitignore'))).toBe(false)
    expect(isGitMetadataPath(root, join(root, 'src', 'git.ts'))).toBe(false)
    expect(isGitMetadataPath(root, root)).toBe(false)
    expect(isGitMetadataPath(root, join(scratch(), '.git', 'config'))).toBe(false)
  })
})

describe('readOnlySubtrees', () => {
  const dirs = (root: string, ...paths: string[]): void => { for (const path of paths) mkdirSync(join(root, path), { recursive: true }) }

  it('reports nested repositories\' .git, not the root\'s, and neither node_modules nor .git internals', () => {
    const root = scratch()
    dirs(root, '.git/objects', 'child/.git/refs', 'a/b/c/.git', 'node_modules/pkg/.git', 'child/.git/modules/sub/.git', 'src/lib')
    expect(readOnlySubtrees(root, {}).map(path => path.slice(root.length + 1)).sort())
      .toEqual([join('a', 'b', 'c', '.git'), join('child', '.git')])
  })

  it('reports a DeepSeekGUI checkout below the workspace only for a desktop-launched harness', () => {
    const root = scratch()
    const code = join(root, 'GUI Code')
    mkdirSync(join(code, 'apps', 'deepseekgui'), { recursive: true })
    writeFileSync(join(code, 'apps', 'deepseekgui', 'package.json'), JSON.stringify({ name: '@see-sol-lab/deepseekgui' }))
    dirs(root, 'notes')
    expect(readOnlySubtrees(root, {})).toEqual([])
    expect(readOnlySubtrees(root, { [GUI_ROOTS_ENV]: join(scratch(), 'install') })).toEqual([canonicalPath(code)])
  })

  it('does not fence a workspace that is the checkout itself, only its nested repositories', () => {
    const root = checkout()
    dirs(root, 'fixtures/repo/.git')
    expect(readOnlySubtrees(root, { [GUI_ROOTS_ENV]: join(scratch(), 'install') })).toEqual([canonicalPath(join(root, 'fixtures', 'repo', '.git'))])
  })

  it.runIf(windows)('does not follow a junction out of the workspace', () => {
    const root = scratch()
    const elsewhere = scratch()
    dirs(elsewhere, 'repo/.git')
    symlinkSync(join(elsewhere, 'repo'), join(root, 'linked'), 'junction')
    expect(readOnlySubtrees(root, {})).toEqual([])
  })
})

describe('commandConcerns', () => {
  it('finds nothing in an ordinary command', () => {
    expect(commandConcerns('npm test && git status', [], {})).toEqual([])
  })

  it('catches Windows and application locations spelled through variables or the registry', () => {
    expect(commandConcerns('Remove-Item $env:windir\\Temp\\x', [], {})).toEqual(['system'])
    expect(commandConcerns('copy x %SystemRoot%\\y', [], {})).toEqual(['system'])
    expect(commandConcerns('reg add HKLM\\Software\\Vendor /v x /d 1', [], {})).toEqual(['system'])
    expect(commandConcerns('Set-ItemProperty HKLM:\\Software\\Vendor x 1', [], {})).toEqual(['system'])
    expect(commandConcerns('Set-Content "C:\\Program Files\\Vendor\\app.js" x', [], {})).toEqual(['apps'])
    expect(commandConcerns('del %LOCALAPPDATA%\\Programs\\Vendor\\x.dll', [], {})).toEqual(['apps'])
  })

  it.runIf(windows)('catches absolute paths inside protected roots, with either slash, in presentation order', () => {
    const env = { ...windowsEnv, [GUI_ROOTS_ENV]: 'D:\\Apps\\DeepSeekGUI' }
    const zones = protectedZones(env)
    expect(commandConcerns('Copy-Item D:/Apps/DeepSeekGUI/resources/x C:/Windows/y.', zones, env)).toEqual(['system', 'gui'])
    expect(commandConcerns('type D:\\work\\notes.txt', zones, env)).toEqual([])
  })

  it.runIf(windows)('reads a quoted path whole, spaces and Chinese included, with either quote or slash', () => {
    const env = { ...windowsEnv, [GUI_ROOTS_ENV]: 'E:\\Dev Projects\\DeepSeekGUI;E:\\开发 项目\\界面' }
    const zones = protectedZones(env)
    expect(commandConcerns('Set-Content -LiteralPath "E:\\Dev Projects\\DeepSeekGUI\\victim.txt" -Value x', zones, env)).toEqual(['gui'])
    expect(commandConcerns("Set-Content -LiteralPath 'E:\\Dev Projects\\DeepSeekGUI\\victim.txt' -Value x", zones, env)).toEqual(['gui'])
    expect(commandConcerns('Remove-Item "E:/Dev Projects/DeepSeekGUI/apps/x.ts"', zones, env)).toEqual(['gui'])
    expect(commandConcerns('Set-Content "E:\\开发 项目\\界面\\说明.md" x', zones, env)).toEqual(['gui'])
  })

  it.runIf(windows)('does not take a neighbour of a protected root for the root itself', () => {
    // The truncated prefix of a quoted neighbour ("E:\Dev") must not be judged again on its own.
    const env = { ...windowsEnv, [GUI_ROOTS_ENV]: 'E:\\Dev' }
    const zones = protectedZones(env)
    expect(commandConcerns('Set-Content "E:\\Dev Projects\\other\\x.txt" x', zones, env)).toEqual([])
    expect(commandConcerns("Remove-Item 'E:\\Dev Projects\\other'", zones, env)).toEqual([])
    const named = { ...windowsEnv, [GUI_ROOTS_ENV]: 'E:\\Dev Projects\\DeepSeekGUI' }
    expect(commandConcerns('Set-Content "E:\\Dev Projects\\DeepSeekGUI-fork\\x.txt" x', protectedZones(named), named)).toEqual([])
    expect(commandConcerns('Set-Content "E:\\Dev Projects\\notes.txt" x', protectedZones(named), named)).toEqual([])
  })
})

describe('actionConcerns', () => {
  it('collects zone, git, workspace, and elevation concerns in presentation order', () => {
    const install = scratch()
    const workspace = scratch()
    const env = { [GUI_ROOTS_ENV]: install, [ELEVATED_ENV]: '1' }
    expect(actionConcerns({
      workspaceRoot: workspace,
      paths: [join(workspace, '.git', 'index'), join(install, 'resources', 'x')],
      fullAccess: true,
    }, env)).toEqual(['gui', 'elevated', 'git'])
    expect(actionConcerns({ workspaceRoot: workspace, paths: [join(workspace, 'a.ts')], fullAccess: true }, { [GUI_ROOTS_ENV]: install }))
      .toEqual([])
  })

  it('flags every action in a DeepSeekGUI workspace, and elevation only with full access', () => {
    const install = scratch()
    const env = { [GUI_ROOTS_ENV]: install, [ELEVATED_ENV]: '1' }
    expect(actionConcerns({ workspaceRoot: install, command: 'npm test', fullAccess: false }, env)).toEqual(['gui'])
    expect(actionConcerns({ workspaceRoot: scratch(), command: 'npm test', fullAccess: false }, env)).toEqual([])
  })

  it('judges a command where it actually runs: relative paths inside a protected working directory', () => {
    const install = checkout()
    const workspace = scratch()
    const env = { [GUI_ROOTS_ENV]: install }
    const command = "Set-Content -LiteralPath './victim.txt' -Value changed"
    expect(actionConcerns({ workspaceRoot: workspace, command, cwd: join(install, 'apps', 'deepseekgui'), fullAccess: true }, env)).toEqual(['gui'])
    expect(actionConcerns({ workspaceRoot: workspace, command, cwd: workspace, fullAccess: true }, env)).toEqual([])
    expect(actionConcerns({ workspaceRoot: workspace, command, fullAccess: true }, env)).toEqual([])
  })
})
