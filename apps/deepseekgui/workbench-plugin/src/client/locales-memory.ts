/**
 * `deepseekgui.memory` namespace dictionaries: Settings → Global memory (the
 * `<home>/memory.md` editor) and the project memory editor in the session's
 * Memory view. The zh dictionary is the key-set source of truth.
 *
 * 2026-09-29 (住户): the entry-based enhanced memory is gone; memory is the two
 * Markdown files again, each injected at the start of every new window and
 * each editable here. A save goes through the desktop with the text the edit
 * started from, so a file changed underneath is refused, not overwritten.
 */

/** Namespace id. */
export const NS_MEMORY = 'deepseekgui.memory'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Settings nav label.
  'nav.memory': '全局记忆',
  // Shared chrome.
  'common.failed': '读取失败：{message}',
  'common.noDesktop': '当前不在 DeepSeekGUI 桌面窗口内，文件操作不可用。',
  // Settings → Global memory: the `<home>/memory.md` editor.
  'legacy.intro': '让助手在不同项目中了解你的背景，减少重复介绍。可以记录你的称呼、背景、工作习惯或常用工具，以及希望助手了解的信息。',
  'legacy.placeholder': '例如：\n我是一名小说作者，也会制作演示文稿。\n我熟悉 Python，前端开发经验较少。',
  'legacy.note': '由你编辑和保存，助手只读取。每个新会话开始时读入一次，保存后在新会话中生效。',
  'legacy.save': '保存更改',
  'legacy.saved': '已保存',
  'legacy.saving': '正在保存…',
  'legacy.open': '在文件管理器中显示',
  'legacy.unreadable': '当前读不到这个文件（可能超过大小上限），为避免覆盖原文，这里不提供保存。',
  'legacy.location': '文件位置：{path}',
  'legacy.failed': '保存失败：{message}',
  'legacy.agentsNote': 'AGENTS.md 是你给助手定的协作规矩（沟通方式、做事习惯），每次对话都会读取；不改也能正常使用。',
  'legacy.agentsOpen': '打开 AGENTS.md',
  'legacy.projectNote': '仅与项目有关的信息，请在会话顶部的「记忆」面板中管理。',
  'legacy.kept': '卸载 DeepSeekGUI 时这个文件和全局 AGENTS.md 默认保留，重装后照常生效；要清空请在这里删改。',
  // The session's Memory view: the project `<folder>.memory.md` editor.
  'project.label': '项目记忆内容',
  'project.placeholder': '例如：\n这个项目用 pnpm 管理依赖，测试命令是 pnpm test。\n发布前要先更新 CHANGELOG。',
  'project.note': '每个新会话开始时读入一次；助手也会在对话中把值得延续的信息写进这个文件。保存后在新会话中生效。',
  'project.save': '保存更改',
  'project.saving': '正在保存…',
  'project.saved': '已保存',
  'project.failed': '保存失败：{message}',
  'project.unreadable': '当前读不到这个文件，为避免覆盖原文，这里不提供保存。',
  'project.tooLong': '文件超过 {max} 字，这里放不下全文；请在文件管理器中打开编辑，或让助手精简。',
} as const

/** English dictionary (mirrors the zh key set). */
export const en: Record<keyof typeof zh, string> = {
  'nav.memory': 'Global memory',
  'common.failed': 'Read failed: {message}',
  'common.noDesktop': 'Not inside the DeepSeekGUI desktop window; file actions are unavailable.',
  'legacy.intro': 'Lets the assistant know your background across projects, so you repeat yourself less. Record how to address you, your background, working habits or usual tools, and anything else the assistant should know.',
  'legacy.placeholder': 'For example:\nI write novels and also make slide decks.\nI know Python well and have little front-end experience.',
  'legacy.note': 'You edit and save it; the assistant only reads it. It is read once at the start of every new session, so saved changes apply to new sessions.',
  'legacy.save': 'Save changes',
  'legacy.saved': 'Saved',
  'legacy.saving': 'Saving…',
  'legacy.open': 'Show in file manager',
  'legacy.unreadable': 'The file cannot be read right now (it may exceed the size limit); saving is disabled so the original is never overwritten.',
  'legacy.location': 'File location: {path}',
  'legacy.failed': 'Save failed: {message}',
  'legacy.agentsNote': 'AGENTS.md holds the collaboration rules you set for the assistant (how to communicate, how to work); it is read in every conversation and works fine unchanged.',
  'legacy.agentsOpen': 'Open AGENTS.md',
  'legacy.projectNote': 'Information that belongs to one project is managed in the "Memory" panel at the top of the session.',
  'legacy.kept': 'Uninstalling DeepSeekGUI keeps this file and the global AGENTS.md by default, so they apply again after a reinstall; to clear them, edit them here.',
  'project.label': 'Project memory text',
  'project.placeholder': 'For example:\nThis project uses pnpm; the test command is pnpm test.\nUpdate the CHANGELOG before each release.',
  'project.note': 'Read once at the start of every new session; the assistant also writes what is worth carrying forward into this file. Saved changes apply to new sessions.',
  'project.save': 'Save changes',
  'project.saving': 'Saving…',
  'project.saved': 'Saved',
  'project.failed': 'Save failed: {message}',
  'project.unreadable': 'The file cannot be read right now; saving is disabled so the original is never overwritten.',
  'project.tooLong': 'The file exceeds {max} characters, more than fits here; open it in the file manager to edit, or ask the assistant to condense it.',
}

/** Key type of the namespace. */
export type MemoryKey = keyof typeof zh

/** The namespace's translate function. */
export type Translate = (key: MemoryKey, params?: Record<string, unknown>) => string

/**
 * Readable text of a caught value.
 * @param error - the value.
 * @returns its message.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
