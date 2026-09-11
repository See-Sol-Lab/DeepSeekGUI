/**
 * Embedded-pane bridge parsing (B3-11): the env contract between the DeepSeekGUI
 * shell and the plugin. Loopback-only by construction — anything else refuses.
 * @module @see-sol-lab/deepseekgui-browser/tests/pane
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { paneBridgeFromEnv, paneHide, paneReveal } from '../../browser-plugin/src/pane.ts'

describe('paneBridgeFromEnv（DEEPSEEKGUI_BROWSER_BRIDGE 解析）', () => {
  it('合法值：127.0.0.1:port#token → origin + token', () => {
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '127.0.0.1:52341#abc-def' }))
      .toEqual({ origin: 'http://127.0.0.1:52341', token: 'abc-def' })
  })

  it('缺失/空值 → null（DeepSeekGUI 外正常降级独立 Edge）', () => {
    expect(paneBridgeFromEnv({})).toBeNull()
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '' })).toBeNull()
  })

  it('坏格式 → null：无 #、# 在开头/结尾', () => {
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '127.0.0.1:1234' })).toBeNull()
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '#token' })).toBeNull()
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '127.0.0.1:1234#' })).toBeNull()
  })

  it('非 loopback 主机一律拒绝（桥永远不该指向远端）', () => {
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: 'evil.example:80#t' })).toBeNull()
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: '192.168.1.5:8080#t' })).toBeNull()
    expect(paneBridgeFromEnv({ DEEPSEEKGUI_BROWSER_BRIDGE: 'localhost:8080#t' })).toBeNull()
  })
})

describe('pane 桥动作（#22：导航即弹出）', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reveal / hide 各自 POST 到 /control/browser-pane，带 token；HTTP 失败抛错', async () => {
    const calls: Array<{ url: string; body: unknown; token: string | undefined }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: JSON.parse(init.body), token: init.headers['x-deepseekgui-control-token'] })
      return { ok: calls.length < 3, status: 500, json: async () => ({ ok: true }) }
    }))
    const bridge = { origin: 'http://127.0.0.1:1', token: 't' }
    await paneReveal(bridge)
    await paneHide(bridge)
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:1/control/browser-pane', body: { action: 'reveal' }, token: 't' },
      { url: 'http://127.0.0.1:1/control/browser-pane', body: { action: 'hide' }, token: 't' },
    ])
    await expect(paneReveal(bridge)).rejects.toThrow('HTTP 500')
  })
})
