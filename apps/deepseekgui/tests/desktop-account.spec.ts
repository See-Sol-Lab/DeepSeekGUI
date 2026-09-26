/**
 * desktop-account 测试：Host 推来的账号帧是不可信输入（凭证经 env 进子进程，
 * agent 读得到），校验要把非官方授权页、非官方平台会话、畸形字段整帧拒掉；
 * 状态机照官方桌面：每个尝试只开一次浏览器，失败/过期把窗口拉回来。
 * @module @see-sol-lab/deepseekgui/tests/desktop-account
 */

import { describe, expect, it, vi } from 'vitest'
import { createDesktopAccount, isAuthorizeUrl, parseAccountFrame, PLATFORM_ORIGIN } from '../src/desktop-account.ts'

const AUTHORIZE = `${PLATFORM_ORIGIN}/dsh/authorize?state=s&code_challenge=c`
const session = { origin: PLATFORM_ORIGIN, token: 'grant-token', userId: 'u1' }
const frame = (phase: string | null, extra: Record<string, unknown> = {}) => ({
  view: {
    status: 'signed-out',
    attempt: phase === null ? null : { id: 'a1', phase, ...extra },
    links: { usageUrl: `${PLATFORM_ORIGIN}/usage`, topUpUrl: `${PLATFORM_ORIGIN}/top_up` },
  },
  session: null,
})

describe('isAuthorizeUrl', () => {
  it('只认官方平台的授权路径', () => {
    expect(isAuthorizeUrl(AUTHORIZE)).toBe(true)
    expect(isAuthorizeUrl('https://evil.example/dsh/authorize')).toBe(false)
    expect(isAuthorizeUrl(`${PLATFORM_ORIGIN}/other`)).toBe(false)
    expect(isAuthorizeUrl('http://platform.deepseek.com/dsh/authorize')).toBe(false)
    expect(isAuthorizeUrl('https://u:p@platform.deepseek.com/dsh/authorize')).toBe(false)
    expect(isAuthorizeUrl(`${AUTHORIZE}#frag`)).toBe(false)
    expect(isAuthorizeUrl('not a url')).toBe(false)
  })
})

describe('parseAccountFrame', () => {
  it('接受官方形状，只保留桌面要的字段', () => {
    expect(parseAccountFrame({ ...frame('waiting-browser', { authorizeUrl: AUTHORIZE, expiresAt: 1 }), session })).toEqual({
      view: { status: 'signed-out', attempt: { id: 'a1', phase: 'waiting-browser', authorizeUrl: AUTHORIZE } },
      session: { origin: PLATFORM_ORIGIN, token: 'grant-token', userId: 'u1' },
    })
  })

  it('整帧拒收：非官方授权页、非官方会话 origin、畸形令牌与请求头', () => {
    expect(parseAccountFrame(frame('waiting-browser', { authorizeUrl: 'https://evil.example/dsh/authorize' }))).toBeNull()
    expect(parseAccountFrame({ ...frame(null), session: { ...session, origin: 'https://evil.example' } })).toBeNull()
    expect(parseAccountFrame({ ...frame(null), session: { ...session, token: 'a b' } })).toBeNull()
    expect(parseAccountFrame({ ...frame(null), session: { ...session, token: '' } })).toBeNull()
    expect(parseAccountFrame({ ...frame(null), session: { ...session, requestHeaders: { 'x-a': 'v\r\ninjected: 1' } } })).toBeNull()
    expect(parseAccountFrame({ ...frame(null), session: { ...session, requestHeaders: { 'bad name': 'v' } } })).toBeNull()
    expect(parseAccountFrame(frame('unknown-phase'))).toBeNull()
    expect(parseAccountFrame({ view: { status: 'weird', attempt: null }, session: null })).toBeNull()
    expect(parseAccountFrame(null)).toBeNull()
  })

  it('合规的部署头与 dist 保留下来', () => {
    const parsed = parseAccountFrame({ ...frame(null), session: { ...session, embeddedPageDist: 'beta', requestHeaders: { cookie: 'k=v' } } })
    expect(parsed?.session).toEqual({ ...session, embeddedPageDist: 'beta', requestHeaders: { cookie: 'k=v' } })
  })
})

describe('createDesktopAccount', () => {
  const setup = () => {
    const deps = {
      openExternal: vi.fn<(url: string) => void>(),
      focusWindow: vi.fn(),
      dark: vi.fn(() => true),
      onSessionChange: vi.fn(),
      onViewChange: vi.fn(),
    }
    return { deps, account: createDesktopAccount(deps) }
  }
  const parsed = (value: unknown) => {
    const result = parseAccountFrame(value)
    if (result === null) throw new Error('fixture rejected')
    return result
  }

  it('每个登录尝试只打开一次浏览器，授权页跟随桌面配色', () => {
    const { deps, account } = setup()
    account.accept(parsed(frame('initializing')))
    expect(deps.openExternal).not.toHaveBeenCalled()
    account.accept(parsed(frame('waiting-browser', { authorizeUrl: AUTHORIZE })))
    account.accept(parsed(frame('waiting-browser', { authorizeUrl: AUTHORIZE })))
    expect(deps.openExternal).toHaveBeenCalledOnce()
    const opened = new URL(deps.openExternal.mock.calls[0]?.[0] ?? '')
    expect(opened.searchParams.get('theme')).toBe('dark')
    expect(opened.searchParams.get('state')).toBe('s')
  })

  it('失败或过期把窗口拉回前台，每个尝试一次', () => {
    const { deps, account } = setup()
    account.accept(parsed(frame('failed')))
    account.accept(parsed(frame('failed')))
    expect(deps.focusWindow).toHaveBeenCalledOnce()
  })

  it('会话变化才通知；reset 清空并通知一次', () => {
    const { deps, account } = setup()
    account.accept(parsed({ ...frame(null), session }))
    account.accept(parsed({ ...frame(null), session }))
    expect(deps.onSessionChange).toHaveBeenCalledOnce()
    expect(account.session()?.token).toBe('grant-token')
    account.reset()
    expect(account.session()).toBeNull()
    expect(account.view()).toBeNull()
    expect(deps.onSessionChange).toHaveBeenLastCalledWith(null)
  })
})
