/**
 * 迁移过的数据目录指针（#25）：跟着 launcher state 写/清、卸载器能读的编码、
 * 首启接回的判定。
 * @module @see-sol-lab/deepseekgui/tests/home-pointer
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  homePointerPath,
  looksLikeManagedHome,
  readHomePointer,
  reclaimableHome,
  syncHomePointer,
  writeHomePointer,
} from '../src/home-pointer.ts'
import { defaultLauncherState, type LauncherStateV1 } from '../src/launcher-state.ts'

const roots: string[] = []
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dsgui-home-pointer-')); roots.push(dir); return dir
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const migrated = (root: string): LauncherStateV1 => {
  const state = defaultLauncherState()
  return { ...state, active: { ...state.active, home: { kind: 'managed', root } } }
}

describe('home pointer file', () => {
  it('lives under %LOCALAPPDATA%\\DeepSeekGUI and is written as UTF-16LE without BOM or newline (what installer.nsh reads)', () => {
    const local = temp()
    const pointer = homePointerPath(local)
    expect(pointer).toBe(join(local, 'DeepSeekGUI', 'managed-home.txt'))
    const root = 'D:\\数据\\dsh 家'
    writeHomePointer(pointer, root)
    const bytes = readFileSync(pointer)
    expect(bytes.equals(Buffer.from(root, 'utf16le'))).toBe(true)
    expect(readHomePointer(pointer)).toBe(root)
  })

  it('tolerates a BOM and a trailing newline, rejects relative or empty content, and reads null when absent', () => {
    const local = temp()
    const pointer = homePointerPath(local)
    expect(readHomePointer(pointer)).toBeNull()
    mkdirSync(join(local, 'DeepSeekGUI'))
    writeFileSync(pointer, Buffer.from('\uFEFFE:\\dsh\r\n', 'utf16le'))
    expect(readHomePointer(pointer)).toBe('E:\\dsh')
    writeFileSync(pointer, Buffer.from('relative\\dsh', 'utf16le'))
    expect(readHomePointer(pointer)).toBeNull()
    writeFileSync(pointer, Buffer.from('', 'utf16le'))
    expect(readHomePointer(pointer)).toBeNull()
  })

  it('follows the launcher state: managed.root writes it, anything else clears it (an Existing Home is never recorded)', () => {
    const local = temp()
    const pointer = homePointerPath(local)
    syncHomePointer(pointer, migrated('D:\\Demo\\dsh'))
    expect(readHomePointer(pointer)).toBe('D:\\Demo\\dsh')
    syncHomePointer(pointer, defaultLauncherState())
    expect(existsSync(pointer)).toBe(false)
    const existing = defaultLauncherState()
    syncHomePointer(pointer, { ...existing, active: { ...existing.active, home: { kind: 'existing', path: 'C:\\Users\\me\\.dsh' } } })
    expect(existsSync(pointer)).toBe(false)
    // Clearing an already-absent pointer is not an error.
    syncHomePointer(pointer, defaultLauncherState())
  })
})

describe('reclaimableHome (first start after a keep-the-data uninstall)', () => {
  it('offers the pointed directory only when the launcher state is still the default and the directory still looks like a Home', () => {
    const local = temp()
    const pointer = homePointerPath(local)
    const home = temp()
    writeHomePointer(pointer, home)
    // Nothing inside yet: not a Home, no offer.
    expect(looksLikeManagedHome(home)).toBe(false)
    expect(reclaimableHome(defaultLauncherState(), pointer)).toBeNull()
    writeFileSync(join(home, 'settings.yaml'), 'ui-theme:\n  preference: system\n')
    expect(looksLikeManagedHome(home)).toBe(true)
    expect(reclaimableHome(defaultLauncherState(), pointer)).toBe(home)
    // Already migrated (root set) or pointing at an Existing Home: never ask.
    expect(reclaimableHome(migrated('D:\\elsewhere'), pointer)).toBeNull()
    const existing = defaultLauncherState()
    expect(reclaimableHome({ ...existing, active: { ...existing.active, home: { kind: 'existing', path: home } } }, pointer)).toBeNull()
    // Pointer gone (the user chose to delete data): nothing to offer.
    writeHomePointer(pointer, null)
    expect(reclaimableHome(defaultLauncherState(), pointer)).toBeNull()
  })
})
