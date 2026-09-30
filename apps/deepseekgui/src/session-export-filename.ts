/**
 * 会话导出的默认文件名（B8-P1）：从会话标题清洗出 Windows 上合法的文件
 * 名主干，再拼上导出时间戳。纯函数——不碰文件系统，时间由调用方传入。
 *
 * 清洗次序即安全次序：先去非法字符与控制字符，再去首尾空格与句点（
 * Windows 拒收以句点结尾的路径分量），截到 60 字符后复查一遍结尾（截断
 * 可能重新制造出句点结尾），命中设备保留名就加前缀让开，全空才回退
 * `session`。
 * @module @see-sol-lab/deepseekgui/session-export-filename
 */

/** 标题主干最多保留的字符数（UTF-16 code units）。 */
export const SESSION_EXPORT_TITLE_MAX_CHARS = 60

/** Windows 文件名禁用的字符与全部控制字符。 */
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/gu

/** Windows 保留设备名（不区分大小写）；命中即让开，绝不原样当文件名。 */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

/** 全空标题的回退主干。 */
const FALLBACK_STEM = 'session'

/**
 * 清洗会话标题为文件名主干：去 Windows 非法字符与控制字符、去首尾空格
 * 与句点、限长、让开设备保留名；清洗完为空回退 `session`。
 * @param title - 会话显示标题（原样输入，不改调用方）。
 * @returns 合法的主干，不含扩展名与时间戳。
 */
export function sessionExportFileStem(title: string): string {
  let stem = title.replace(ILLEGAL_CHARACTERS, '')
  stem = stem.replace(/^[\s.]+/u, '').replace(/[\s.]+$/u, '')
  if (stem.length > SESSION_EXPORT_TITLE_MAX_CHARS) {
    stem = stem.slice(0, SESSION_EXPORT_TITLE_MAX_CHARS)
    // 截断点落在代理对中间时少留半个字符，避免写盘时变成替换符。
    const tail = stem.charCodeAt(stem.length - 1)
    if (tail >= 0xd800 && tail <= 0xdbff) stem = stem.slice(0, -1)
  }
  // 限长后结尾可能又是句点或空格，复查一遍。
  stem = stem.replace(/[\s.]+$/u, '')
  if (RESERVED_NAMES.has(stem.toUpperCase())) stem = `${FALLBACK_STEM}-${stem}`
  return stem === '' ? FALLBACK_STEM : stem
}

/**
 * 组出另存为对话框的默认文件名。
 * @param title - 会话显示标题。
 * @param now - 导出时间（本机时区）。
 * @returns `<清洗后的标题>-<yyyyMMdd-HHmm>.md`。
 */
export function sessionExportFileName(title: string, now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${String(now.getFullYear()).padStart(4, '0')}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${sessionExportFileStem(title)}-${stamp}.md`
}
