/**
 * platform-view 的纯函数：页面矩形的边界校验、Cookie 合并、平台身份头。
 * DesktopPlatformView 本身要真 Electron，开发态实跑验收。
 * @module @see-sol-lab/deepseekgui/tests/platform-view
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: vi.fn(), session: {}, shell: {} }))

const { mergePlatformCookies, platformBounds, platformClientHeaders } = await import('../src/platform-view.ts')

describe('platformBounds', () => {
  it('取整并只收有限的非负数', () => {
    expect(platformBounds({ x: 1.4, y: 2.6, width: 300, height: 200, extra: 'x' })).toEqual({ x: 1, y: 3, width: 300, height: 200 })
    expect(() => platformBounds({ x: -1, y: 0, width: 1, height: 1 })).toThrow('Invalid Platform bounds')
    expect(() => platformBounds({ x: 0, y: 0, width: Number.NaN, height: 1 })).toThrow('Invalid Platform bounds')
    expect(() => platformBounds({ x: 0, y: 0, width: 200_000, height: 1 })).toThrow('Invalid Platform bounds')
    expect(() => platformBounds(null)).toThrow('Invalid Platform bounds')
  })
})

describe('mergePlatformCookies', () => {
  it('同名以部署值为准，其余保留', () => {
    expect(mergePlatformCookies('a=1; b=2', 'b=3; c=4')).toBe('a=1; b=3; c=4')
    expect(mergePlatformCookies('', 'k=v')).toBe('k=v')
  })
})

describe('platformClientHeaders', () => {
  it('按系统报桌面客户端身份（与 Host 账号插件一致），没有对应桌面身份的系统报 web', () => {
    expect(platformClientHeaders('0.1.7-rc.2', 'zh_CN', 'win32')['x-client-platform']).toBe('desktop-win')
    expect(platformClientHeaders('0.1.7-rc.2', 'zh_CN', 'darwin')['x-client-platform']).toBe('desktop-mac')
    expect(platformClientHeaders('0.1.7-rc.2', 'zh_CN', 'linux')['x-client-platform']).toBe('web')
    const headers = platformClientHeaders('0.1.7-rc.2', 'zh_CN')
    expect(headers['x-client-version']).toBe('0.1.7-rc.2')
    expect(headers['x-client-locale']).toBe('zh_CN')
    expect(Number(headers['x-client-timezone-offset'])).toBe(-new Date().getTimezoneOffset() * 60)
  })
})
