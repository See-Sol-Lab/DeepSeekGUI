/**
 * safeReleaseLink：更新面板发布页链接的安全闸（R10 后 release-notes 模块的
 * 唯一幸存导出）。
 * @module @see-sol-lab/deepseekgui/tests/release-notes
 */

import { describe, expect, it } from 'vitest'
import { safeReleaseLink } from '../src/release-notes.ts'

describe('safeReleaseLink', () => {
  it('只接受不带凭据的 https 绝对地址', () => {
    expect(safeReleaseLink('https://example.com/a?b=c#d')).toBe('https://example.com/a?b=c#d')
    expect(safeReleaseLink('http://example.com/')).toBeNull()
    expect(safeReleaseLink('https://user:pw@example.com/')).toBeNull()
    expect(safeReleaseLink('javascript:alert(1)')).toBeNull()
    expect(safeReleaseLink('#中文')).toBeNull()
    expect(safeReleaseLink('/relative')).toBeNull()
    expect(safeReleaseLink(`https://example.com/${'x'.repeat(2100)}`)).toBeNull()
  })
})
