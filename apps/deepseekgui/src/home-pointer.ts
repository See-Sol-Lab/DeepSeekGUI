/**
 * 迁移过的数据目录指针（人工测试 #25，莉莉丝 2026-09-11 定）。
 *
 * 搬过家的 Managed Home 住在 userData 之外，而"它在哪"这一行记录
 * （launcher-state.json 的 `active.home.root`）住在 userData 里。卸载器的
 * "同时删除数据目录"只删 `%APPDATA%\DeepSeekGUI`，于是出现了两个坏结果：
 * 用户选了"删"，D 盘那份原样留着（用户会反感）；用户选了"留"，重装后程序不
 * 知道那份在哪，把用户当新人。
 *
 * 她的裁决：选了删就删干净；选了留，重装首启要问一句"接着用吗"。两条都需要
 * 一份**活得比 userData 久**的记录，所以指针放在
 * `%LOCALAPPDATA%\DeepSeekGUI\managed-home.txt`：
 * - 每次 launcher state 落盘时同步——有 `managed.root` 就写，否则删（Existing
 *   Home 是用户自己的目录，从不写进去，卸载器也就永远不会碰它）；
 * - 卸载器（installer.nsh）在"删"的分支读它，把那个目录一起删掉，再删指针；
 * - 主进程首启读它：目录还像个 Home（有 settings.yaml 或 profiles）就弹一问。
 *
 * 文件内容是 UTF-16LE、无 BOM、无换行的绝对路径：NSIS 的 `FileReadUTF16LE`
 * 直接读得出中文路径，不必再做任何裁剪。
 * @module @see-sol-lab/deepseekgui/home-pointer
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { LauncherStateV1 } from './launcher-state.ts'
import { atomicWriteFile } from './atomic-write.ts'

/** 指针所在目录名（`%LOCALAPPDATA%` 之下），与产品名同名。 */
export const HOME_POINTER_DIRNAME = 'DeepSeekGUI'
/** 指针文件名——installer.nsh 里写死了同一个名字，改这里要一起改。 */
export const HOME_POINTER_FILENAME = 'managed-home.txt'

/**
 * 指针文件的绝对路径。
 * @param localAppData - `%LOCALAPPDATA%`。
 * @returns 指针路径。
 */
export function homePointerPath(localAppData: string): string {
  return join(localAppData, HOME_POINTER_DIRNAME, HOME_POINTER_FILENAME)
}

/**
 * 写入或清除指针。
 * @param pointerPath - {@link homePointerPath}。
 * @param root - 迁移后的 Managed Home 根；null 表示当前没有搬过家，指针删掉。
 */
export function writeHomePointer(pointerPath: string, root: string | null): void {
  if (root === null) {
    rmSync(pointerPath, { force: true })
    return
  }
  mkdirSync(join(pointerPath, '..'), { recursive: true })
  atomicWriteFile(pointerPath, Buffer.from(root, 'utf16le'), message => new Error(`Could not save data-location pointer: ${message}`))
}

/**
 * 读指针；不存在、空、非绝对路径都当作没有。
 * @param pointerPath - {@link homePointerPath}。
 * @returns 记录的绝对路径，或 null。
 */
export function readHomePointer(pointerPath: string): string | null {
  let raw: Buffer
  try {
    raw = readFileSync(pointerPath)
  } catch {
    return null
  }
  // 容忍有人手工加了 BOM 或换行。
  let text = raw.toString('utf16le')
  if (text.startsWith('﻿')) text = text.slice(1)
  text = text.replace(/[\r\n]+$/u, '')
  return text !== '' && isAbsolute(text) ? text : null
}

/**
 * 目录看起来还是一个 Managed Home（迁移会连 settings.yaml 与 profiles 一起搬）。
 * @param root - 指针指向的目录。
 * @returns 是否值得问用户要不要接着用。
 */
export function looksLikeManagedHome(root: string): boolean {
  return existsSync(join(root, 'settings.yaml')) || existsSync(join(root, 'profiles'))
}

/**
 * 让指针跟上 launcher state：有 `managed.root` 就记，否则清。
 * @param pointerPath - {@link homePointerPath}。
 * @param state - 刚落盘（或刚读到）的 launcher state。
 */
export function syncHomePointer(pointerPath: string, state: LauncherStateV1): void {
  const home = state.active.home
  writeHomePointer(pointerPath, home.kind === 'managed' && home.root !== undefined ? home.root : null)
}

/**
 * 首启是否该问"接着用之前搬走的目录吗"：launcher state 还是缺省（新用户或
 * 数据目录刚被卸载器清过）、指针在、目录还像个 Home。
 * @param state - 当前 launcher state。
 * @param pointerPath - {@link homePointerPath}。
 * @returns 可接回的目录，或 null。
 */
export function reclaimableHome(state: LauncherStateV1, pointerPath: string): string | null {
  const home = state.active.home
  if (home.kind !== 'managed' || home.root !== undefined) return null
  const root = readHomePointer(pointerPath)
  if (root === null || !looksLikeManagedHome(root)) return null
  return root
}
