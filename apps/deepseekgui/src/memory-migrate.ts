/**
 * 增强记忆条目迁回 Markdown（住户 2026-09-29）：增强记忆（条目模式）整个拿掉，
 * 记忆回到两份文件——全局 `<home>/memory.md` 与项目 `<文件夹>/<文件夹名>.memory.md`，
 * 每个新窗口开头注入一次。用过条目模式的人，条目不能就此消失：启动时把仍然有效
 * 的条目追加进对应文件，一次做完就留一个标记，以后不再动。
 *
 * - 数据源是旧服务按条落盘的 `<home>/storages/deepseekgui_memory/entries/<id>.json`
 *   （`{ state: 'active', entry }`；被遗忘的是墓碑，不迁）。接续记录（continuation）
 *   是给下一个会话的一次性交接，不是长期记忆，也不迁。
 * - 按文字去重：文件里已经有同样的一段（忽略空白差异与大小写）就不再追加。
 * - 项目文件夹已经不存在的条目留在原处，只记下数量。
 * - 旧目录原样保留作备份，绝不删除；标记文件写在它旁边，说明发生了什么。
 * 纯 Node 模块，不依赖 electron，可单测。
 * @module @see-sol-lab/deepseekgui-desktop/memory-migrate
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { atomicWriteFile } from './atomic-write.ts'

/** 迁移标题与标记文件的语言：与桌面文案判据同源。 */
export type MigrateLocale = 'zh' | 'en'

/** 一次迁移的结果。 */
export interface MemoryMigration {
  /** 已经迁过（或从没用过条目模式），什么都没做。 */
  readonly skipped: boolean
  /** 追加进各文件的条目数。 */
  readonly appended: number
  /** 文件里已有同样文字而没追加的条目数。 */
  readonly duplicates: number
  /** 项目文件夹已不存在、留在备份里的条目数。 */
  readonly orphaned: number
  /** 写入过的文件。 */
  readonly files: readonly string[]
}

/** 标记文件名：在旧存储目录旁边，读得懂。 */
export const MIGRATION_MARKER = 'MIGRATED-TO-MARKDOWN.txt'

/** 旧条目里迁移需要的那一小部分。 */
interface LiveEntry {
  scope: { kind: 'global' } | { kind: 'project'; path: string }
  content: string
  createdAt: string
}

/**
 * 从一条落盘记录里取出有效条目；形状不对、墓碑、接续记录一律返回 null。
 * @param raw - 解析后的 JSON。
 * @returns 条目或 null。
 */
function liveEntryOf(raw: unknown): LiveEntry | null {
  const record = unwrap(raw)
  if (record === null || record.state !== 'active') return null
  const entry = record.entry
  if (typeof entry !== 'object' || entry === null) return null
  const { content, scope, kind, createdAt } = entry as Record<string, unknown>
  if (typeof content !== 'string' || content.trim() === '' || kind === 'continuation') return null
  if (typeof scope !== 'object' || scope === null) return null
  const { kind: scopeKind, path } = scope as Record<string, unknown>
  const at = typeof createdAt === 'string' ? createdAt : ''
  if (scopeKind === 'global') return { scope: { kind: 'global' }, content: content.trim(), createdAt: at }
  if (scopeKind === 'project' && typeof path === 'string' && path !== '') return { scope: { kind: 'project', path }, content: content.trim(), createdAt: at }
  return null
}

/**
 * 记录可能直接落盘，也可能包在存储层的信封里（value / record / data）。
 * @param raw - 解析后的 JSON。
 * @returns 带 state 字段的那一层，或 null。
 */
function unwrap(raw: unknown): Record<string, unknown> | null {
  let current: unknown = raw
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== 'object' || current === null) return null
    const record = current as Record<string, unknown>
    if ('state' in record) return record
    current = record.value ?? record.record ?? record.data
  }
  return null
}

/**
 * 条目写成 Markdown 列表项；多行内容的后续行缩进两格，仍属同一项。
 * @param content - 条目文字。
 * @returns 一行或多行。
 */
function bullet(content: string): string {
  return `- ${content.split(/\r?\n/u).join('\n  ')}`
}

/** 项目记忆文件名（与 workbench-inspector 的 projectMemoryFileName 同一条规则）。 */
function projectMemoryPath(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/u, '')
  const name = basename(trimmed)
  return join(folder, `${name === '' || /^[A-Za-z]:$/u.test(trimmed) ? 'project' : name}.memory.md`)
}

/**
 * 把条目追加进一份文件（按文字去重）。
 * @param path - 目标文件。
 * @param entries - 要追加的条目（已按时间排好）。
 * @param heading - 追加段的标题。
 * @returns 追加数与重复数。
 */
function appendEntries(path: string, entries: readonly LiveEntry[], heading: string): { appended: number; duplicates: number } {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const haystack = `\n${existing.replace(/\r\n/gu, '\n')}\n`
  const seen = new Set<string>()
  const fresh: string[] = []
  let duplicates = 0
  for (const entry of entries) {
    const key = entry.content.replace(/\r\n/gu, '\n')
    if (seen.has(key) || haystack.includes(`\n${key}\n`) || haystack.includes(`\n${bullet(key)}\n`)) {
      duplicates++
      continue
    }
    seen.add(key)
    fresh.push(bullet(entry.content))
  }
  if (fresh.length > 0) {
    const separator = existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
    atomicWriteFile(path, `${existing}${separator}${heading}\n\n${fresh.join('\n')}\n`, message => new Error(message))
  }
  return { appended: fresh.length, duplicates }
}

/**
 * 一次性把增强记忆的有效条目迁回两份 Markdown 文件。
 * @param home - 当前 DSH home。
 * @param locale - 迁移标题与标记说明的语言。
 * @param now - 当前时间（测试可注入）。
 * @returns 这一次做了什么。
 */
export function migrateMemoryEntries(home: string, locale: MigrateLocale, now: Date = new Date()): MemoryMigration {
  const store = join(home, 'storages', 'deepseekgui_memory')
  const entriesDir = join(store, 'entries')
  const marker = join(store, MIGRATION_MARKER)
  if (!existsSync(entriesDir) || existsSync(marker)) return { skipped: true, appended: 0, duplicates: 0, orphaned: 0, files: [] }

  const live: LiveEntry[] = []
  for (const name of readdirSync(entriesDir).filter(file => file.endsWith('.json')).sort()) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(entriesDir, name), 'utf8'))
      const entry = liveEntryOf(parsed)
      if (entry !== null) live.push(entry)
    } catch {
      // A file that does not parse stays in the backup untouched.
    }
  }
  live.sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const targets = new Map<string, LiveEntry[]>()
  let orphaned = 0
  for (const entry of live) {
    let path: string
    if (entry.scope.kind === 'global') path = join(home, 'memory.md')
    else if (existsSync(entry.scope.path)) path = projectMemoryPath(entry.scope.path)
    else {
      orphaned++
      continue
    }
    const list = targets.get(path) ?? []
    list.push(entry)
    targets.set(path, list)
  }

  const day = now.toISOString().slice(0, 10)
  const heading = locale === 'zh' ? `## 从记忆条目迁回（${day}）` : `## Moved back from memory entries (${day})`
  let appended = 0
  let duplicates = 0
  const files: string[] = []
  for (const [path, entries] of targets) {
    const result = appendEntries(path, entries, heading)
    appended += result.appended
    duplicates += result.duplicates
    if (result.appended > 0) files.push(path)
  }

  atomicWriteFile(marker, locale === 'zh'
    ? `${now.toISOString()}\nDeepSeekGUI 已去掉增强记忆（条目模式），有效条目已追加进 memory.md 与各项目的 <文件夹名>.memory.md：追加 ${String(appended)} 条，已存在 ${String(duplicates)} 条，项目文件夹已不存在 ${String(orphaned)} 条。\n本目录作为备份原样保留，可以手动删除。\n`
    : `${now.toISOString()}\nDeepSeekGUI removed enhanced memory (entries mode); live entries were appended to memory.md and each project's <folder>.memory.md: ${String(appended)} appended, ${String(duplicates)} already present, ${String(orphaned)} whose project folder no longer exists.\nThis directory is kept as a backup and may be deleted by hand.\n`,
  message => new Error(message))
  return { skipped: false, appended, duplicates, orphaned, files }
}
