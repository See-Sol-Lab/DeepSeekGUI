/**
 * usage-fetch：主进程带官方账号的平台令牌请求五个用量接口（2026-09-25 起取代
 * 隐藏窗口 + 独立登录）。令牌只进请求头、绝不跟随跳转；单个接口失败只让该键缺省。
 * @module @see-sol-lab/deepseekgui/tests/usage-fetch
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ WebContentsView: vi.fn(), session: {}, shell: {} }))

const { fetchUsage } = await import('../src/usage-fetch.ts')
const { planUsageFetch, usageRequestPaths } = await import('../src/usage-service.ts')

const session = { origin: 'https://platform.deepseek.com', token: 'grant-token', userId: 'u1', requestHeaders: { 'x-deploy': 'd' } }
const plan = planUsageFetch(Date.UTC(2026, 8, 25, 4, 0, 0), 8 * 3600)

describe('fetchUsage', () => {
  it('未登录（没有平台会话）不发任何请求', async () => {
    const send = vi.fn<typeof fetch>()
    expect(await fetchUsage({ session: () => null, version: '0.1.7-rc.2', locale: () => 'zh_CN', fetch: send }, plan, new AbortController().signal))
      .toEqual({ kind: 'no-token' })
    expect(send).not.toHaveBeenCalled()
  })

  it('五个接口都带令牌与身份头、禁止跳转，按键收回状态与正文', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response('{"code":0}', { status: 200 }))
    const result = await fetchUsage({ session: () => session, version: '0.1.7-rc.2', locale: () => 'zh_CN', fetch: send },
      plan, new AbortController().signal)
    const paths = usageRequestPaths(plan)
    expect(send).toHaveBeenCalledTimes(5)
    expect(send.mock.calls.map(([url]) => (url as URL).href)).toEqual(Object.values(paths).map(path => `https://platform.deepseek.com${path}`))
    const init = send.mock.calls[0]?.[1]
    expect(init?.redirect).toBe('error')
    expect(init?.headers).toMatchObject({
      'x-dsh-auth-token': 'grant-token', 'x-client-platform': 'web', 'x-client-version': '0.1.7-rc.2', 'x-deploy': 'd',
    })
    expect(result).toEqual({ kind: 'responses', responses: Object.fromEntries(Object.keys(paths).map(key => [key, { status: 200, body: '{"code":0}' }])) })
  })

  it('单个接口网络失败只让该键缺省', async () => {
    let call = 0
    const send = vi.fn<typeof fetch>(async () => {
      call++
      if (call === 2) throw new TypeError('fetch failed')
      return new Response('{}', { status: 401 })
    })
    const result = await fetchUsage({ session: () => session, version: 'v', locale: () => 'en_US', fetch: send }, plan, new AbortController().signal)
    expect(result.kind).toBe('responses')
    if (result.kind !== 'responses') return
    expect(Object.keys(result.responses)).toEqual(['summary', 'cost30', 'amountPrev', 'amountToday'])
    expect(result.responses.summary).toEqual({ status: 401, body: '{}' })
  })

  it('调用方中止即停，不再发后面的请求', async () => {
    const controller = new AbortController()
    const send = vi.fn<typeof fetch>(async () => { controller.abort(); throw new DOMException('aborted', 'AbortError') })
    await expect(fetchUsage({ session: () => session, version: 'v', locale: () => 'en_US', fetch: send }, plan, controller.signal)).rejects.toThrow()
    expect(send).toHaveBeenCalledOnce()
  })
})
