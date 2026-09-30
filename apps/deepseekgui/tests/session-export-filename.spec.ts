/**
 * B8-P1 会话导出的默认文件名清洗（纯函数）：Windows 非法字符、控制字符、
 * 首尾空格与句点、设备保留名、超长、全空——清洗规则钉在这一组用例里。
 * @module @see-sol-lab/deepseekgui/tests/session-export-filename
 */
import { describe, expect, it } from 'vitest'
import { sessionExportFileStem, sessionExportFileName } from '../src/session-export-filename.ts'

/** 固定导出时刻：2026-09-28 15:02 本机时间。 */
const NOW = new Date(2026, 8, 28, 15, 2)

describe('sessionExportFileStem', () => {
  it('普通标题原样保留', () => {
    expect(sessionExportFileStem('调试导出')).toBe('调试导出')
    expect(sessionExportFileStem('fix: the login bug')).toBe('fix the login bug')
  })

  it('去掉 Windows 非法字符与控制字符', () => {
    expect(sessionExportFileStem('a<b>c:"d"/e\\f|g?h*i')).toBe('abcdefghi')
    expect(sessionExportFileStem('a\u0000b\u001fc')).toBe('abc')
  })

  it('去首尾空格与句点', () => {
    expect(sessionExportFileStem('  .标题.  ')).toBe('标题')
    expect(sessionExportFileStem('标题。')).toBe('标题。')
  })

  it('命中设备保留名时加前缀让开（不区分大小写）', () => {
    expect(sessionExportFileStem('CON')).toBe('session-CON')
    expect(sessionExportFileStem('nul')).toBe('session-nul')
    expect(sessionExportFileStem('Com1')).toBe('session-Com1')
    expect(sessionExportFileStem('CON 的会话')).toBe('CON 的会话')
  })

  it('超长截到 60 字符，截断点不留在代理对中间', () => {
    expect(sessionExportFileStem('字'.repeat(80))).toHaveLength(60)
    // 截断点落在代理对中间：悬空的高代理被去掉。
    expect(sessionExportFileStem('a'.repeat(59) + '😀' + 'b'.repeat(10))).toBe('a'.repeat(59))
    // 截断点恰好在一对之后：完整代理对保留。
    expect(sessionExportFileStem('a'.repeat(58) + '😀' + 'b'.repeat(10))).toBe('a'.repeat(58) + '😀')
  })

  it('全空标题回退 session', () => {
    expect(sessionExportFileStem('')).toBe('session')
    expect(sessionExportFileStem('  ... ')).toBe('session')
    expect(sessionExportFileStem('///***')).toBe('session')
    expect(sessionExportFileStem('CON')).not.toBe('CON')
  })
})

describe('sessionExportFileName', () => {
  it('默认文件名是「主干-yyyyMMdd-HHmm.md」', () => {
    expect(sessionExportFileName('调试导出', NOW)).toBe('调试导出-20260928-1502.md')
    expect(sessionExportFileName('', NOW)).toBe('session-20260928-1502.md')
  })

  it('清洗发生在拼时间戳之前', () => {
    expect(sessionExportFileName('a/b<c>', NOW)).toBe('abc-20260928-1502.md')
  })
})
