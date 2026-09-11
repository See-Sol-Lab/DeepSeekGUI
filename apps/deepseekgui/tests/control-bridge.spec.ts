/**
 * D39 控制桥的安全边界。
 *
 * 这条桥能执行整个桌面命令面（quit、导出诊断、反馈外发、切 profile），
 * 所以「谁能进、进哪扇门」就是它的全部要害。要钉的是两条：
 *
 * 1. **两把钥匙不能互开。** pane 凭证经 env 交给我们 spawn 的 DSH 子进程，
 *    而那个进程里跑的正是 agent——它读得到自己的环境变量。pane token 能开
 *    命令门，等于把整个命令面交到 agent 手里。
 * 2. **凭证不对、路径不对，一律同一个 404。** 任何可区分的信号都是给探测
 *    者的线索。
 * @module @see-sol-lab/deepseekgui/tests/control-bridge
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { startControlBridge, type ControlBridge, type ControlBridgeDeps } from '../src/control-bridge.ts'
import type { DesktopControlModel } from '../src/control-model.ts'

let open: ControlBridge | null = null
afterEach(() => {
  open?.close()
  open = null
  vi.restoreAllMocks()
})

const MODEL = { revision: 7 } as unknown as DesktopControlModel

async function bridge(over: Partial<ControlBridgeDeps> = {}) {
  const env: NodeJS.ProcessEnv = {}
  const runCommand = vi.fn(async (_command: Parameters<ControlBridgeDeps['runCommand']>[0]) => {})
  const handlePaneRequest = vi.fn(async (_body: Record<string, unknown>) => ({ status: 200, body: { ok: true } }))
  const deps: ControlBridgeDeps = {
    appOrigin: 'http://127.0.0.1:3080',
    buildModel: () => MODEL,
    runCommand,
    redact: text => text.replace(/sk-[a-z]+/gu, '<redacted>'),
    handlePaneRequest,
    env,
    ...over,
  }
  const started = await startControlBridge(deps)
  open = started
  return { started, env, runCommand, handlePaneRequest }
}

/** 往桥上发一次请求。 */
async function call(
  started: ControlBridge,
  path: string,
  init: { token?: string; method?: string; body?: unknown } = {},
) {
  return fetch(`http://127.0.0.1:${String(started.port)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...init.token === undefined ? {} : { 'x-deepseekgui-control-token': init.token },
    },
    ...init.body === undefined ? {} : { body: JSON.stringify(init.body) },
  })
}

describe('startControlBridge — 两把钥匙', () => {
  it('每条通道一把，且互不相同', async () => {
    const { started } = await bridge()
    expect(started.controlToken).not.toBe(started.paneToken)
  })

  it('pane 凭证开不了命令门——那是把整个桌面交给 agent', async () => {
    // pane token 经 env 进 DSH 子进程，agent 读得到它自己的环境变量。
    const { started, runCommand } = await bridge()
    const response = await call(started, '/control/command', {
      method: 'POST', token: started.paneToken, body: { command: { type: 'quit' } },
    })
    expect(response.status).toBe(404)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('pane 凭证也读不了控制模型', async () => {
    const { started } = await bridge()
    expect((await call(started, '/control/model', { token: started.paneToken })).status).toBe(404)
  })

  it('命令凭证开不了 pane 门', async () => {
    const { started, handlePaneRequest } = await bridge()
    const response = await call(started, '/control/browser-pane', {
      method: 'POST', token: started.controlToken, body: { action: 'hide' },
    })
    expect(response.status).toBe(404)
    expect(handlePaneRequest).not.toHaveBeenCalled()
  })

  it('只有 pane 凭证能开 pane 门', async () => {
    const { started, handlePaneRequest } = await bridge()
    const response = await call(started, '/control/browser-pane', {
      method: 'POST', token: started.paneToken, body: { action: 'hide' },
    })
    expect(response.status).toBe(200)
    expect(handlePaneRequest).toHaveBeenCalledWith({ action: 'hide' })
  })

  it('pane 通道的地址与凭证写进给定环境，命令凭证绝不进去', async () => {
    const { started, env } = await bridge()
    expect(env.DEEPSEEKGUI_BROWSER_BRIDGE).toBe(`127.0.0.1:${String(started.port)}#${started.paneToken}`)
    // 命令凭证只随页面 URL 下发，任何进子进程的东西里都不能有它。
    expect(JSON.stringify(env)).not.toContain(started.controlToken)
  })
})

describe('startControlBridge — 一律同一个 404', () => {
  it('无凭证、错凭证、错路径都回同样的 404，一个动作都不执行', async () => {
    const { started, runCommand, handlePaneRequest } = await bridge()
    const responses = await Promise.all([
      call(started, '/control/model'),
      call(started, '/control/model', { token: 'wrong' }),
      call(started, '/control/nope', { token: started.controlToken }),
      call(started, '/control/command', { method: 'POST', token: 'wrong', body: { command: { type: 'quit' } } }),
    ])
    for (const response of responses) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not found' })
    }
    expect(runCommand).not.toHaveBeenCalled()
    expect(handlePaneRequest).not.toHaveBeenCalled()
  })
})

describe('startControlBridge — 条件拉取', () => {
  it('revision 相同时只回小包，不带模型', async () => {
    const { started } = await bridge()
    const response = await call(started, '/control/model?since=7', { token: started.controlToken })
    expect(await response.json()).toEqual({ revision: 7, changed: false })
  })

  it('revision 不同或没带 since 时回全量', async () => {
    const { started } = await bridge()
    for (const path of ['/control/model?since=6', '/control/model']) {
      const body = await (await call(started, path, { token: started.controlToken })).json() as { changed: boolean }
      expect(body.changed).toBe(true)
    }
  })
})

describe('startControlBridge — 命令', () => {
  it('凭证对且命令合法时执行，并回当前模型', async () => {
    const { started, runCommand } = await bridge()
    const response = await call(started, '/control/command', {
      method: 'POST', token: started.controlToken, body: { command: { type: 'quit' } },
    })
    expect(response.status).toBe(200)
    expect(runCommand).toHaveBeenCalledWith({ type: 'quit' })
  })

  it('非法命令按 400 拒绝，绝不执行', async () => {
    const { started, runCommand } = await bridge()
    const response = await call(started, '/control/command', {
      method: 'POST', token: started.controlToken, body: { command: { type: 'not-a-command' } },
    })
    expect(response.status).toBe(400)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('命令失败时回 500，且错误已脱敏', async () => {
    const { started } = await bridge({
      runCommand: vi.fn(async () => { throw new Error('failed with sk-abcdefghij') }),
    })
    const response = await call(started, '/control/command', {
      method: 'POST', token: started.controlToken, body: { command: { type: 'quit' } },
    })
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('sk-abcdefghij')
  })

  it('坏 JSON 按 400 拒绝', async () => {
    const { started } = await bridge()
    const response = await fetch(`http://127.0.0.1:${String(started.port)}/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': started.controlToken },
      body: '{ not json',
    })
    expect(response.status).toBe(400)
  })
})

describe('startControlBridge — preflight', () => {
  it('放行预检且不要求凭证（preflight 本来就不带）', async () => {
    const { started } = await bridge()
    const response = await fetch(`http://127.0.0.1:${String(started.port)}/control/command`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3080')
  })
})
