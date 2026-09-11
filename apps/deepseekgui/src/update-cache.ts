/**
 * single-slot 更新缓存的落盘事实（P11 从 main.ts 提取）：目录准备与清理、
 * partial → verified 改名、verified 记录的严格读写。
 *
 * 提取目的是让完整的更新业务序列（manifest → 下载 → 完整性校验 → 就绪 →
 * 用户确认 → 安装交接）能在测试里连续跑完，而不是只覆盖「更新源不可达」
 * 之类的错误提示；main 只做接线与 UI 状态机。
 *
 * 铁律：
 * - 缓存目录内最多一份产物：新下载前清空整个目录；
 * - 只有校验通过的文件才被改名为最终名；
 * - verified 记录损坏、形状不符、摘要非法或指向缓存目录之外时一律当没有
 *   （fail closed：宁可让用户重新下载，也绝不把来路不明的文件当已验证产物）；
 * - 清理失败只记诊断，不挡新下载。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/update-cache
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { atomicWriteFile } from './atomic-write.ts'

/** 更新缓存的目录名（位于 Electron userData 下）。 */
export const UPDATE_CACHE_DIRNAME = 'updates'

/** 已验证安装包的落盘记录文件名（缓存目录内）。 */
export const VERIFIED_RECORD_FILENAME = 'verified.json'

/** 一份已验证安装包的记录。 */
export interface VerifiedUpdateRecord {
  /** 最终文件名下的绝对路径（缓存目录内）。 */
  readonly path: string
  /** 该文件的 SHA-256（64 位小写 hex）。 */
  readonly sha256: string
  /** 该文件携带的 DeepSeekGUI app version。 */
  readonly version: string
}

/**
 * 缓存目录绝对路径。
 * @param userDataDir - Electron userData 目录。
 * @returns `<userDataDir>/updates`。
 */
export function updateCacheDir(userDataDir: string): string {
  return join(userDataDir, UPDATE_CACHE_DIRNAME)
}

/**
 * 准备一次新下载：建目录并清空其中所有条目（single-slot）。
 * 单个条目删不掉时只跳过——它不挡新下载，也会在下一次准备时再试。
 * @param dir - 缓存目录。
 */
export function prepareUpdateCache(dir: string): void {
  mkdirSync(dir, { recursive: true })
  if (lstatSync(dir).isSymbolicLink()) throw new Error('The update cache must not be a directory link')
  for (const name of readdirSync(dir)) {
    try {
      const path = join(dir, name)
      const entry = lstatSync(path)
      if (entry.isSymbolicLink()) {
        try { unlinkSync(path) } catch { rmdirSync(path) }
      } else if (entry.isFile()) unlinkSync(path)
    } catch {
      // 单个条目清理失败不挡新下载。
    }
  }
}

/**
 * 把校验通过的临时文件改名为最终名。改名失败说明这一份不可用：删掉临时
 * 文件并返回失败原因，绝不留下半截产物冒充就绪。
 * @param partial - 下载中的临时路径。
 * @param verified - 最终路径。
 * @returns null = 改名成功；否则为失败原因文本。
 */
export function promoteVerifiedFile(partial: string, verified: string): string | null {
  try {
    renameSync(partial, verified)
    return null
  } catch (error) {
    try {
      unlinkSync(partial)
    } catch {
      // 临时文件已经不在：没有残留需要清理。
    }
    return String(error instanceof Error ? error.message : error)
  }
}

/**
 * 落盘 verified 记录（写失败抛错，由调用方决定是否只记诊断——记录只影响
 * 重启后的复用，不影响本次安装）。
 * @param dir - 缓存目录。
 * @param record - 已验证安装包事实。
 */
export function writeVerifiedRecord(dir: string, record: VerifiedUpdateRecord): void {
  atomicWriteFile(join(dir, VERIFIED_RECORD_FILENAME), `${JSON.stringify(record, undefined, 2)}\n`, message => new Error(message))
}

/** 是否为 64 位小写 hex 摘要。 */
function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

/**
 * 严格读取 verified 记录。记录缺失、不是 JSON、字段类型不符、摘要非法、
 * 版本为空、目标文件不存在，或路径不在缓存目录内，一律返回 null——调用方
 * 按「没有可复用的已验证产物」处理（fail closed）。
 * @param dir - 缓存目录。
 * @returns 记录或 null。
 */
export function readVerifiedRecord(dir: string): VerifiedUpdateRecord | null {
  let raw: unknown
  try {
    if (lstatSync(dir).isSymbolicLink()) return null
    raw = JSON.parse(readFileSync(join(dir, VERIFIED_RECORD_FILENAME), 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { path, sha256, version } = raw as Record<string, unknown>
  if (typeof path !== 'string' || typeof sha256 !== 'string' || typeof version !== 'string') return null
  if (version === '' || !isSha256Hex(sha256)) return null
  // 记录只能指向缓存目录内的文件：被改写或手编的记录不得把安装路径指向别处。
  if (dirname(resolve(path)) !== resolve(dir)) return null
  if (!existsSync(path)) return null
  try {
    if (dirname(realpathSync(path)) !== realpathSync(dir)) return null
  } catch { return null }
  return { path, sha256, version }
}
