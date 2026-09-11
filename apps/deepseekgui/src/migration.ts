/**
 * Managed Home 数据迁移（B6-P7）：一条机械、确定的代码流程——复制、逐项
 * 校验、写清单、切换指向（由调用方做）、验证、确认后清理。全程没有任何
 * 模型参与：助手住在 Harness 里，而 Harness 正握着要搬的文件，服务一停
 * 助手就没了，所以迁移必须能在没有模型可用时独立跑完。
 *
 * 铁律：
 * - 校验通过之前，旧副本与旧指向都不动；
 * - 清单写在新 Home 内，是收尾的唯一依据——绝不靠现场扫目录猜残留；
 * - 清单损坏 fail closed：不提示、不删除；
 * - 清理只删清单里列出的旧路径与空壳（链接只摘链接点），逐项报告失败，
 *   绝不原地重试；绝不递归删除、绝不跟进任何链接。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/migration
 */

import { createHash } from 'node:crypto'
import {
  accessSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, rmdirSync, statSync, statfsSync, unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from './atomic-write.ts'

/** Managed Home 内 DeepSeekGUI 自有目录（与 session-import 标记同址）。 */
const MIGRATION_DIRNAME = 'deepseekgui'

/** 迁移清单文件名（写在新 Home 内）。 */
const MIGRATION_MANIFEST_FILENAME = 'migration-manifest.json'

/** 清单 schema 版本。 */
const MIGRATION_VERSION = 1 as const

/** 单个条目：一个文件（目录只作为空目录条目记录）。 */
export interface MigrationItem {
  /** 相对源根的 POSIX 路径（跨平台比对用）。 */
  readonly path: string
  readonly kind: 'file' | 'dir'
  readonly bytes: number
  /** 文件内容的 SHA-256 hex；目录为空串。 */
  readonly sha256: string
}

/** 旧副本清理状态：pending（尚未清理）/ partial（部分残留）/ done。 */
export type CleanupStatus = 'pending' | 'partial' | 'done'

/**
 * 重启验证状态（句芒 2026-09-10 定的流程）。
 *
 * 切完指向不等于搬家成功：同一个进程里读得通，只说明这次运行还攥着旧的
 * 解析结果与文件句柄；真正的考验是应用整个重启一遍、从零解析新位置。而
 * 删旧副本是不可逆的——用户正因为原盘满了才搬走，删完才发现起不来，那份
 * 数据就真没了。所以顺序固定为：切指向 → 用户重启 → 重启后逐项核对 →
 * 通过了才谈删除。
 *
 * - `awaiting-restart`：已切指向，等用户重启后核对；此状态下绝不出现删除入口。
 * - `verified`：重启后逐项核对通过，旧副本可以删了。
 * - `failed`：核对发现对不上，停在这里；旧副本必须原样保留。
 */
export type VerificationStatus = 'awaiting-restart' | 'verified' | 'failed'

/** 重启验证事实。 */
export interface MigrationVerification {
  readonly status: VerificationStatus
  /** 完成核对的时刻；尚未核对为 null。 */
  readonly checkedAt: string | null
  /** 核对对不上的条目（相对路径）；仅 failed 时非空。 */
  readonly failures: readonly string[]
}

/** 迁移清单：搬了哪些对象、逐项校验结果、旧副本位置、完成时间。 */
export interface MigrationManifest {
  readonly schemaVersion: 1
  readonly completedAt: string
  /** 旧 Home（待清理的唯一目标）。 */
  readonly sourceHome: string
  /** 新 Home（清单所在地）。 */
  readonly targetHome: string
  readonly items: readonly MigrationItem[]
  /** 重启验证事实；旧清单缺这个字段时按最保守方式补成 awaiting-restart。 */
  readonly verification: MigrationVerification
  readonly cleanup: {
    readonly status: CleanupStatus
    /** status 为 partial 时仍未删掉的旧路径（绝对路径）。 */
    readonly remaining: readonly string[]
  }
}

/** 迁移失败：调用方据此回滚并给出明确错误。 */
class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

/** 目标位置的判定结果。 */
export type MigrationTargetVerdict =
  | { readonly ok: true; readonly targetHome: string }
  | {
    readonly ok: false
    readonly reason:
      | 'same-as-source'
      | 'target-inside-source'
      | 'source-inside-target'
      | 'target-not-writable'
      | 'not-enough-space'
      | 'target-not-empty'
    readonly detail: string
  }

/** 目标判定需要的文件系统事实（注入以便测试空间不足等分支）。 */
export interface MigrationTargetFacts {
  /** 目标目录是否已存在。 */
  exists(path: string): boolean
  /** 目录是否为空（不存在视为空）。 */
  isEmpty(path: string): boolean
  /** 可写（不存在时看最近的已存在祖先）。 */
  isWritable(path: string): boolean
  /** 目标所在卷的空闲字节数。 */
  freeBytes(path: string): number
}

/** 真实文件系统事实：`checkMigrationTarget` 的生产实现（测试注入替身）。 */
export const nodeMigrationFacts: MigrationTargetFacts = {
  exists: (path: string): boolean => existsSync(path),
  isEmpty: (path: string): boolean => !existsSync(path) || readdirSync(path).length === 0,
  isWritable: (path: string): boolean => {
    try {
      accessSync(path, constants.W_OK)
      return true
    } catch {
      return false
    }
  },
  freeBytes: (path: string): number => {
    const stats = statfsSync(path)
    return stats.bavail * stats.bsize
  },
}

/** 是否为普通对象（非 null、非数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 归一化比较用路径：绝对、去尾分隔符；Windows 大小写不敏感。 */
function canonical(path: string): string {
  const value = resolve(path).replace(/[\\/]+$/u, '')
  return process.platform === 'win32' ? value.toLowerCase() : value
}

/** left 是否位于 right 内部（或相等）。 */
function contains(right: string, left: string): boolean {
  const base = canonical(right)
  const candidate = canonical(left)
  return candidate === base || candidate.startsWith(`${base}${sep}`)
}

/**
 * 判定用户选择的目标父目录能否作为迁移目标。
 *
 * 新 Home 固定为 `<目标父目录>/dsh`。拒绝：目标与源相同、目标在源内部
 * （复制到自己里面）、源在目标内部、不可写、空间不足、目标非空冲突。
 * @param input - 源 Home、目标父目录、所需字节数与文件系统事实。
 * @returns 判定；ok 时给出新 Home 的绝对路径。
 */
export function checkMigrationTarget(input: {
  sourceHome: string
  targetParent: string
  requiredBytes: number
  facts: MigrationTargetFacts
}): MigrationTargetVerdict {
  const source = resolve(input.sourceHome)
  const targetHome = resolve(input.targetParent, 'dsh')
  if (canonical(targetHome) === canonical(source)) {
    return { ok: false, reason: 'same-as-source', detail: targetHome }
  }
  if (contains(source, targetHome)) {
    return { ok: false, reason: 'target-inside-source', detail: targetHome }
  }
  if (contains(targetHome, source)) {
    return { ok: false, reason: 'source-inside-target', detail: targetHome }
  }
  if (input.facts.exists(targetHome) && !input.facts.isEmpty(targetHome)) {
    return { ok: false, reason: 'target-not-empty', detail: targetHome }
  }
  if (!input.facts.isWritable(input.facts.exists(targetHome) ? targetHome : input.targetParent)) {
    return { ok: false, reason: 'target-not-writable', detail: targetHome }
  }
  if (input.facts.freeBytes(input.facts.exists(targetHome) ? targetHome : input.targetParent) < input.requiredBytes) {
    return { ok: false, reason: 'not-enough-space', detail: targetHome }
  }
  return { ok: true, targetHome }
}

/** 把绝对路径转成相对源根的 POSIX 路径。 */
function toRelative(sourceHome: string, absolute: string): string {
  return relative(sourceHome, absolute).split(sep).join('/')
}

/** 一个文件的 SHA-256 hex。 */
export function fileDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 收集迁移清单：源目录下每个文件（含大小与摘要）与每个空目录。
 *
 * 空目录也要记录，否则新位置会丢掉它们；非空目录由其中文件代表。
 * @param sourceHome - 源 Home 绝对路径。
 * @returns 按路径排序的条目列表。
 */
export function collectMigrationItems(sourceHome: string): MigrationItem[] {
  const items: MigrationItem[] = []
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    let files = 0
    for (const entry of entries) {
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        files += readdirSync(absolute).length > 0 ? 1 : 0
      } else if (entry.isFile()) {
        files += 1
        const stats = statSync(absolute)
        items.push({
          path: toRelative(sourceHome, absolute),
          kind: 'file',
          bytes: stats.size,
          sha256: fileDigest(absolute),
        })
      }
    }
    if (files === 0 && canonical(dir) !== canonical(sourceHome)) {
      items.push({ path: toRelative(sourceHome, dir), kind: 'dir', bytes: 0, sha256: '' })
    }
  }
  walk(sourceHome)
  return items.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** 清单总字节数（空间检查用）。 */
export function totalBytesOf(items: readonly MigrationItem[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0)
}

/**
 * 复制清单里的每一项并逐项校验（大小 + SHA-256）。
 *
 * 任何一项不符立即抛 {@link MigrationError}；调用方负责删除目标目录
 * 回滚。校验失败绝不继续，也绝不切换指向。
 * @param items - 源清单。
 * @param sourceHome - 源 Home。
 * @param targetHome - 新 Home。
 */
export function copyAndVerifyItems(
  items: readonly MigrationItem[],
  sourceHome: string,
  targetHome: string,
): void {
  mkdirSync(targetHome, { recursive: true })
  for (const item of items) {
    const from = join(sourceHome, ...item.path.split('/'))
    const to = join(targetHome, ...item.path.split('/'))
    if (item.kind === 'dir') {
      mkdirSync(to, { recursive: true })
      continue
    }
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    const copied = statSync(to)
    if (copied.size !== item.bytes) {
      throw new MigrationError(`migration verify failed for ${item.path}: expected ${String(item.bytes)} bytes, got ${String(copied.size)}`)
    }
    const digest = fileDigest(to)
    if (digest !== item.sha256) {
      throw new MigrationError(`migration verify failed for ${item.path}: digest mismatch`)
    }
  }
}

/**
 * 只摘链接本身，绝不碰链接目标。`unlinkSync` 摘文件符号链接；目录 junction
 * 要用 `rmdirSync`（Win32 RemoveDirectory 对 junction 的语义就是只删链接点）。
 * @param path - 链接路径（调用方已用 lstat 确认是链接）。
 */
function unlinkLink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    rmdirSync(path)
  }
}

/**
 * 递归删除一棵**我们自己复制出来的**树，逐项 lstat，绝不跟进任何链接。
 *
 * 这里不能用 `rmSync({ recursive: true })`：产品跑的 Electron 43 内嵌 Node
 * 24.19 上实测它会**跟进目录 junction**，把链接目标里的内容逐个删掉（系统
 * Node 24.18 不会，所以 vitest 永远抓不到）。2026-09-10 实机：迁移清理对旧
 * Home 的 `profiles/node_modules/@*` 逐个递归删除，顺着官方 heal 建的 junction
 * 把安装目录 `resources/dsh/node_modules` 里几百个包删空，安装版从此起不来
 * （dsh-service 的 ensurePluginResolvable 在 08-23 踩过同一个坑）。而回滚这条
 * 路同样会遇到链接——切指向失败之前 Harness 已在新位置起过一次，heal 已经把
 * junction 建好了。
 *
 * 尽力而为：删不掉的项跳过，留给调用方的错误提示与用户。
 * @param dir - 要删除的目录。
 */
function removeTreeLinkSafe(dir: string): void {
  const root = lstatSync(dir, { throwIfNoEntry: false })
  if (root === undefined) return
  if (root.isSymbolicLink()) { unlinkLink(dir); return }
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    try {
      const stats = lstatSync(path)
      if (stats.isSymbolicLink()) unlinkLink(path)
      else if (stats.isDirectory()) removeTreeLinkSafe(path)
      else unlinkSync(path)
    } catch {
      // 单项删不掉：跳过，目录随之留下，调用方据此报错。
    }
  }
  try {
    rmdirSync(dir)
  } catch {
    // 非空或已不在：留着。
  }
}

/** 删除目标目录（迁移失败回滚时用；只删我们刚创建的那一份，链接只摘链接）。 */
export function removeTargetCopy(targetHome: string): void {
  removeTreeLinkSafe(targetHome)
}

/**
 * 摘空壳：自底向上只删**空目录与链接本身**，普通文件一个不碰。
 *
 * 这是清理阶段"只删清单里列出的路径"那条铁律的另一半：清单条目已经逐个
 * 删过，剩下的目录要么空了、要么装着清单之外的东西——后者不是我们的，留下。
 * 链接不是数据（官方 heal 与 ensurePluginResolvable 每次启动都会重建），
 * 摘掉的只是链接点本身，目标一个字节不动；跟进链接的后果见
 * {@link removeTreeLinkSafe}。
 * @param dir - 起点目录。
 */
function removeEmptyShell(dir: string): void {
  const root = lstatSync(dir, { throwIfNoEntry: false })
  if (root === undefined) return
  if (root.isSymbolicLink()) { unlinkLink(dir); return }
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    try {
      const stats = lstatSync(path)
      if (stats.isSymbolicLink()) unlinkLink(path)
      else if (stats.isDirectory()) removeEmptyShell(path)
    } catch {
      // 读不到或摘不掉：留着。
    }
  }
  try {
    rmdirSync(dir)
  } catch {
    // 非空（有清单之外的文件）或已不在：留着。
  }
}

/** 清单文件路径。 */
export function migrationManifestPath(home: string): string {
  return join(home, MIGRATION_DIRNAME, MIGRATION_MANIFEST_FILENAME)
}

/** 写清单（原子；新 Home 内）。 */
export function writeMigrationManifest(home: string, manifest: MigrationManifest): void {
  const path = migrationManifestPath(home)
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFile(path, `${JSON.stringify(manifest, null, 2)}\n`, message => new MigrationError(message))
}

/**
 * 解析验证事实。字段缺失或形状不对时一律回落成"等重启验证"——这是最保守
 * 的一端：删除入口不会出现，用户至多多重启一次，绝不会因为读不懂一份清单
 * 就把旧副本删了。
 * @param raw - 清单里的 verification 原值。
 * @returns 可用的验证事实。
 */
function parseVerification(raw: unknown): MigrationVerification {
  const awaiting: MigrationVerification = { status: 'awaiting-restart', checkedAt: null, failures: [] }
  if (!isRecord(raw)) return awaiting
  if (raw.status !== 'awaiting-restart' && raw.status !== 'verified' && raw.status !== 'failed') return awaiting
  const checkedAt = typeof raw.checkedAt === 'string' ? raw.checkedAt : null
  const failures: string[] = Array.isArray(raw.failures)
    ? raw.failures.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (raw.status === 'verified' && (checkedAt === null || !Number.isFinite(Date.parse(checkedAt)) || failures.length !== 0)) return awaiting
  return { status: raw.status, checkedAt, failures }
}

/**
 * 读清单。缺失 = 从未迁移（null，无错误）；损坏 = fail closed：调用方
 * 不得据此提示或删除任何东西。
 * @param home - 当前 Home。
 * @returns 清单或 null，外加损坏原因。
 */
export function readMigrationManifest(home: string): { manifest: MigrationManifest | null; error: string | null } {
  const path = migrationManifestPath(home)
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { manifest: null, error: null }
    return { manifest: null, error: `migration manifest: read failed: ${String(error instanceof Error ? error.message : error)}` }
  }
  try {
    const raw: unknown = JSON.parse(content)
    if (!isRecord(raw)) throw new Error('top level must be an object')
    if (raw.schemaVersion !== MIGRATION_VERSION) throw new Error(`unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}`)
    if (typeof raw.completedAt !== 'string' || typeof raw.sourceHome !== 'string' || typeof raw.targetHome !== 'string') {
      throw new Error('missing completedAt/sourceHome/targetHome')
    }
    assertMigrationRoots(raw.sourceHome, raw.targetHome)
    if (canonical(raw.targetHome) !== canonical(home)) throw new Error('manifest belongs to another target Home')
    if (!Array.isArray(raw.items)) throw new Error('items must be an array')
    if (!isRecord(raw.cleanup) || (raw.cleanup.status !== 'pending' && raw.cleanup.status !== 'partial' && raw.cleanup.status !== 'done')) {
      throw new Error('cleanup.status must be pending, partial or done')
    }
    if (!Array.isArray(raw.cleanup.remaining) || raw.cleanup.remaining.some(entry => typeof entry !== 'string')) {
      throw new Error('cleanup.remaining must be a string array')
    }
    const items: MigrationItem[] = raw.items.map((entry) => {
      if (!isRecord(entry) || typeof entry.path !== 'string' || (entry.kind !== 'file' && entry.kind !== 'dir')
        || typeof entry.bytes !== 'number' || typeof entry.sha256 !== 'string') {
        throw new Error('malformed item')
      }
      assertItemPath(entry.path)
      if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0
        || (entry.kind === 'file' ? !/^[a-f0-9]{64}$/u.test(entry.sha256) : entry.sha256 !== '' || entry.bytes !== 0)) {
        throw new Error('invalid item size or digest')
      }
      return { path: entry.path, kind: entry.kind, bytes: entry.bytes, sha256: entry.sha256 }
    })
    return {
      manifest: {
        schemaVersion: 1,
        completedAt: raw.completedAt,
        sourceHome: raw.sourceHome,
        targetHome: raw.targetHome,
        items,
        verification: parseVerification(raw.verification),
        cleanup: { status: raw.cleanup.status, remaining: raw.cleanup.remaining },
      },
      error: null,
    }
  } catch (error) {
    return { manifest: null, error: `migration manifest: ${String(error instanceof Error ? error.message : error)}` }
  }
}

/**
 * 重启后核对新位置：按清单逐项确认每个对象都还在、且读得到。
 *
 * **这里刻意不比对大小与摘要。** 字节级校验属于复制阶段——那时 Harness 已停、
 * 数据静止，`copyAndVerifyItems` 逐项验过 SHA-256，那一步才是"完整搬过来了"
 * 的证据。切指向之后新位置就投入使用了：活跃会话会往日志里追加、投影缓存会
 * 更新，等重启再算一遍摘要必然对不上——那是"数据被正常使用"，不是"数据搬坏了"。
 * 实测踩过：一次正常迁移因当时开着一个会话，被判 failed 并提示"请不要删除旧
 * 位置"，用户于是永远删不掉旧数据，搬家想腾出的空间白搭。
 *
 * 所以这一步要回答的问题是"新位置从零启动之后还完整吗"：清单里的每一项都在
 * （不能少文件）、文件能打开（不是坏的或被占死的）。依据仍只有清单，绝不扫
 * 目录——扫目录连"少没少东西"都答不了。
 * @param home - 新 Home 绝对路径。
 * @param items - 迁移清单条目。
 * @returns 核对结果；failures 为缺失或读不到的相对路径。
 */
export function verifyMigratedHome(
  home: string,
  items: readonly MigrationItem[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  for (const item of items) {
    const absolute = join(home, ...item.path.split('/'))
    try {
      const stats = statSync(absolute)
      // 类型也要对得上：清单里的目录变成了文件（或反过来）同样是搬坏了。
      if (item.kind === 'dir' ? !stats.isDirectory() : !stats.isFile()) failures.push(item.path)
      else if (item.kind === 'file') closeSync(openSync(absolute, 'r'))
    } catch {
      failures.push(item.path)
    }
  }
  return { ok: failures.length === 0, failures }
}

/** 核对结果写回清单（验证通过或失败都留下事实，供下次启动读回）。 */
export function manifestAfterVerification(
  manifest: MigrationManifest,
  result: { ok: boolean; failures: readonly string[] },
  now: Date = new Date(),
): MigrationManifest {
  return {
    ...manifest,
    verification: {
      status: result.ok ? 'verified' : 'failed',
      checkedAt: now.toISOString(),
      failures: result.ok ? [] : [...result.failures],
    },
  }
}

/**
 * 是否该请用户重启完成验证：已切指向但还没核对过，且旧副本仍在。
 * @param manifest - 读回的清单（null = 无/损坏）。
 * @returns 待验证事实；无需提示时为 null。
 */
export function awaitingRestartOf(manifest: MigrationManifest | null): { targetHome: string } | null {
  if (manifest === null) return null
  if (manifest.verification.status !== 'awaiting-restart') return null
  return { targetHome: manifest.targetHome }
}

/**
 * 核对失败的事实（旧副本原样保留，用户可以切回去）。
 * @param manifest - 读回的清单（null = 无/损坏）。
 * @returns 失败条目与旧位置；无失败时为 null。
 */
export function verificationFailureOf(
  manifest: MigrationManifest | null,
): { failures: readonly string[]; sourceHome: string } | null {
  if (manifest === null) return null
  if (manifest.verification.status !== 'failed') return null
  return { failures: manifest.verification.failures, sourceHome: manifest.sourceHome }
}

/**
 * 可以删旧副本的唯一依据：重启后核对已通过、清单说还没清理干净、旧 Home
 * 仍然存在。
 *
 * 三个条件缺一不可。尤其是第一条——没经过重启核对就提示删除，等于把
 * "搬家看起来成功了"当成"搬家确实成功了"，而这一步是不可逆的。清单损坏
 * （调用方拿不到 manifest）时返回 null，fail closed：既不提示也不删除。
 * @param manifest - 读回的清单（null = 无/损坏）。
 * @returns 待清理项；无需提示时为 null。
 */
export function pendingCleanupOf(manifest: MigrationManifest | null): { count: number; sourceHome: string; bytes: number } | null {
  if (manifest === null) return null
  if (manifest.verification.status !== 'verified') return null
  if (manifest.cleanup.status === 'done') return null
  if (!existsSync(manifest.sourceHome)) return null
  return { count: manifest.items.length, sourceHome: manifest.sourceHome, bytes: totalBytesOf(manifest.items) }
}

/** 清理结果：删掉的目标与失败的项。 */
export interface CleanupOutcome {
  readonly deleted: readonly string[]
  readonly failed: readonly { readonly path: string; readonly message: string }[]
}

/**
 * 按清单删除旧副本（用户确认后由代码执行）。
 *
 * 逐项删除清单里列出的路径；删不掉的留在结果里，绝不原地重试、绝不
 * 后台自愈。文件条目直接 unlink；目录条目在清单里只是"收集时它是空的"这一
 * 事实，收集之后官方 heal 可能已经往里建了 junction——所以绝不递归删除，只
 * 摘空壳（链接只摘链接点，清单之外的普通文件不动）。摘完仍在的目录记为
 * 失败：里面有清单之外的东西，不是我们的。
 * @param manifest - 清单。
 * @returns 逐项结果。
 */
export function deleteOldCopy(manifest: MigrationManifest): CleanupOutcome {
  assertMigrationRoots(manifest.sourceHome, manifest.targetHome)
  if (manifest.verification.status !== 'verified') throw new MigrationError('Migration must be verified before cleanup')
  if (manifest.cleanup.status === 'done') return { deleted: [], failed: [] }
  const deleted: string[] = []
  const failed: { path: string; message: string }[] = []
  for (const item of manifest.items) {
    assertItemPath(item.path)
    const absolute = join(manifest.sourceHome, ...item.path.split('/'))
    try {
      assertPlainParents(manifest.sourceHome, item.path)
      const current = lstatSync(absolute, { throwIfNoEntry: false })
      if (current === undefined) continue
      if (item.kind === 'dir') {
        removeEmptyShell(absolute)
        if (existsSync(absolute)) throw new Error('directory still holds files that are not in the manifest')
      } else {
        if (!current.isFile() || current.size !== item.bytes || fileDigest(absolute) !== item.sha256) {
          throw new MigrationError('The old file changed after migration; it was kept')
        }
        unlinkSync(absolute)
      }
      deleted.push(absolute)
    } catch (error) {
      failed.push({ path: absolute, message: String(error instanceof Error ? error.message : error) })
    }
  }
  // 清单自身的目录与空壳：只有全部条目都删掉后才尝试移除源根——同样只摘
  // 空壳，源根残留（例如正被占用）不算条目失败：下次启动的提示由清单状态决定。
  if (failed.length === 0) {
    removeEmptyShell(manifest.sourceHome)
    if (existsSync(manifest.sourceHome)) failed.push({ path: manifest.sourceHome, message: 'Old Home still contains unlisted or locked entries' })
  }
  return { deleted, failed }
}

/** Reject a migration manifest that could identify the current Home or a filesystem root for deletion. */
function assertMigrationRoots(source: string, target: string): void {
  if (!isAbsolute(source) || !isAbsolute(target)) throw new MigrationError('Migration roots must be absolute')
  const sourcePath = existsSync(source) ? realpathSync(source) : resolve(source)
  const targetPath = existsSync(target) ? realpathSync(target) : resolve(target)
  if (dirname(sourcePath) === sourcePath || contains(sourcePath, targetPath) || contains(targetPath, sourcePath)) {
    throw new MigrationError('Invalid or overlapping migration roots')
  }
}

/** Manifest entries use relative POSIX segments, never drive names or parent traversal. */
function assertItemPath(path: string): void {
  if (path.includes('\\') || path.includes(':') || path.includes('\0')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new MigrationError('Invalid migration item path')
}

/** Refuse linked parent directories before unlinking an old file through them. */
function assertPlainParents(root: string, path: string): void {
  let current = root
  for (const part of ['', ...path.split('/').slice(0, -1)]) {
    if (part !== '') current = join(current, part)
    const info = lstatSync(current, { throwIfNoEntry: false })
    if (info?.isSymbolicLink()) throw new MigrationError('An old directory was replaced by a link; cleanup was stopped')
  }
}

/** 用清理结果更新清单状态。 */
export function manifestAfterCleanup(
  manifest: MigrationManifest,
  outcome: CleanupOutcome,
): MigrationManifest {
  const remaining = outcome.failed.map(entry => entry.path)
  return {
    ...manifest,
    cleanup: {
      status: remaining.length === 0 ? 'done' : 'partial',
      remaining,
    },
  }
}
