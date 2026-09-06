/**
 * D20 出厂种子（莉莉丝 2026-09-06 定案）：Managed Home 首次启动时把两份
 * 用户可编辑的文件按语言种下——`AGENTS.md`（全局协作指引模板）与
 * `memory.md`（只有标题的全局记忆）；项目侧按用户按钮把项目 AGENTS.md 模板
 * 写进工作区。三处都只在文件**不存在**时写，存在即原样保留：这两类文件是
 * 用户的，产品升级也绝不覆盖。
 *
 * 模板随包放在 `src/templates/`（electron-builder `files` 送进包），内容不是
 * 代码，改文案不用重编译；模板缺失是包坏了，读取直接抛错而不是静默种空文件。
 *
 * 纯 Node 模块，不依赖 electron，可单测。
 * @module @see-sol-lab/deepseekgui-desktop/memory-seed
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 种子语言：与桌面文案判据同源（main 的 localeOf）。 */
export type SeedLocale = 'zh' | 'en'

/** 一次种子写入的结果：写了 / 已有所以没动。 */
export type SeedOutcome = 'created' | 'exists'

/** 全局记忆的出厂内容：只有标题，正文留给用户。 */
export const GLOBAL_MEMORY_SEED: Readonly<Record<SeedLocale, string>> = {
  zh: '# 全局记忆\n',
  en: '# Global memory\n',
}

/**
 * 读取一份随包模板。
 * @param templatesDir - `src/templates` 的绝对路径。
 * @param name - 模板文件名（`AGENTS.global.zh.md` 等）。
 * @returns 模板全文。
 */
function readTemplate(templatesDir: string, name: string): string {
  return readFileSync(join(templatesDir, name), 'utf8')
}

/**
 * 只在目标不存在时写入；父目录缺失时补建。
 * @param path - 目标文件。
 * @param content - 写入内容。
 * @returns created / exists。
 */
function writeIfAbsent(path: string, content: string): SeedOutcome {
  if (existsSync(path)) return 'exists'
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
  return 'created'
}

/** Managed Home 两份全局文件的种子结果。 */
export interface HomeSeedResult {
  readonly agents: SeedOutcome
  readonly memory: SeedOutcome
}

/**
 * 给 Managed Home 种全局 `AGENTS.md` 与 `memory.md`（都只在缺失时写）。
 * 只允许对 DeepSeekGUI 自己的 Managed Home 调用——Existing Home 是用户自己
 * 的 dsh 家目录，产品一个字节都不写。
 * @param home - Managed Home 绝对路径。
 * @param locale - 种子语言。
 * @param templatesDir - 随包模板目录。
 * @returns 两份文件各自的结果。
 */
export function seedManagedHome(home: string, locale: SeedLocale, templatesDir: string): HomeSeedResult {
  const agents = writeIfAbsent(join(home, 'AGENTS.md'), readTemplate(templatesDir, `AGENTS.global.${locale}.md`))
  const memory = writeIfAbsent(join(home, 'memory.md'), GLOBAL_MEMORY_SEED[locale])
  return { agents, memory }
}

/**
 * 按用户按钮把项目 AGENTS.md 模板写进会话工作区；已存在则原样保留。
 * @param cwd - 会话工作区。
 * @param locale - 种子语言。
 * @param templatesDir - 随包模板目录。
 * @returns created / exists。
 */
export function seedProjectAgents(cwd: string, locale: SeedLocale, templatesDir: string): SeedOutcome {
  return writeIfAbsent(join(cwd, 'AGENTS.md'), readTemplate(templatesDir, `AGENTS.project.${locale}.md`))
}
