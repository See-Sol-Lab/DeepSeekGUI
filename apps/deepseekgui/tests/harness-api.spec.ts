/**
 * harness-api 测试：官方 Remote 信封构造（B5-P1：`namespace/method` 端点 +
 * `payload.args` 包裹）、响应严格解析、业务错误与传输失败的 fail-closed
 * 语义。fake fetch 注入，零网络。
 * @module @see-sol-lab/deepseekgui/tests/harness-api
 */

import { describe, expect, it } from 'vitest'
import {
  createHarnessApi,
  HarnessRpcError,
} from '../src/harness-api.ts'

type FetchState = {
  seenUrl: string
  seenBody: { type: string; rpcId: string; method: string; payload: { args: unknown } }
}

function fakeFetch(responder: (state: FetchState) => unknown) {
  const state: FetchState = { seenUrl: '', seenBody: { type: '', rpcId: '', method: '', payload: { args: {} } } }
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<unknown> => {
    state.seenUrl = url
    state.seenBody = JSON.parse(init.body) as FetchState['seenBody']
    const value = await responder(state)
    return {
      ok: true,
      status: 200,
      json: async () => value,
    }
  }
  return { state, fetch }
}

function okEnvelope(state: FetchState, value: unknown): unknown {
  return {
    type: 'server-response',
    rpcId: state.seenBody.rpcId,
    result: { ok: true, value },
  }
}

describe('createHarnessApi / settingsDescribe', () => {
  it('构造官方信封：settings/describe 端点、空 args，并解析 describe 值', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, {
      writable: true,
      hasDocument: true,
      namespaces: [
        { ns: 'permission', value: { defaultPreset: 'workspace-write' }, applies: 'live', revision: 3 },
      ],
    }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    const value = await api.settingsDescribe()
    expect(state.seenUrl).toBe('http://127.0.0.1:3080/api/settings/describe')
    expect(state.seenBody.type).toBe('client-request')
    expect(state.seenBody.method).toBe('settings/describe')
    expect(state.seenBody.payload.args).toEqual({})
    expect(value.namespaces[0]?.ns).toBe('permission')
    expect(value.namespaces[0]?.value).toEqual({ defaultPreset: 'workspace-write' })
  })

  it('业务错误（ok:false）转为 HarnessRpcError 并携带 code', async () => {
    const { fetch } = fakeFetch(state => ({
      type: 'server-response',
      rpcId: state.seenBody.rpcId,
      result: {
        ok: false,
        error: { code: 'settings-conflict', message: 'revision mismatch', details: { ns: 'x', expected: 1, actual: 2 } },
      },
    }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.settingsDescribe()).rejects.toMatchObject({ code: 'settings-conflict' })
  })

  it('响应形状不符按坏响应失败，绝不猜测', async () => {
    const { fetch } = fakeFetch(() => ({ type: 'server-response', rpcId: 'other', result: { ok: true, value: {} } }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.settingsDescribe()).rejects.toBeInstanceOf(HarnessRpcError)
  })

  it('fetch 抛错（网络失败/超时）映射为 unreachable，不裸奔', async () => {
    const api = createHarnessApi({
      baseUrl: 'http://127.0.0.1:3080',
      fetch: async () => { throw new Error('ECONNREFUSED') },
    })
    await expect(api.settingsDescribe()).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('value 形状不符（缺 writable）按 bad-response 拒绝', async () => {
    const { fetch } = fakeFetch(state => okEnvelope(state, { hasDocument: true, namespaces: [] }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.settingsDescribe()).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('createHarnessApi / settingsMutate', () => {
  it('平铺 args（ns/ops/expectedRevision）并严格解析 namespace 视图', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, {
      ns: 'ui-theme', value: { preference: 'dark' }, applies: 'live', revision: 8,
    }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    const view = await api.settingsMutate('ui-theme', [{ op: 'set', path: ['preference'], value: 'dark' }])
    expect(state.seenBody.method).toBe('settings/mutate')
    expect(state.seenBody.payload.args).toEqual({
      ns: 'ui-theme',
      ops: [{ op: 'set', path: ['preference'], value: 'dark' }],
    })
    expect(view.revision).toBe(8)
  })

  it('expectedRevision 传入时随 args 发送（乐观并发防护）', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, {
      ns: 'permission', value: { defaultPreset: 'workspace-write' }, applies: 'live', revision: 7,
    }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await api.settingsMutate('permission', [{ op: 'set', path: ['defaultPreset'], value: 'workspace-write' }], 7)
    expect(state.seenBody.payload.args).toMatchObject({ expectedRevision: 7 })
  })
})

describe('createHarnessApi / sessionList', () => {
  it('session/list 端点、args 键为 _request（host 签名参数名）并解析受信摘要字段', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, {
      items: [
        {
          sessionId: 's1', updatedAt: 123, running: true, blank: false,
          cwd: 'C:\\ws', origin: 'subagent', parentSessionId: 'p',
        },
      ],
    }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    const value = await api.sessionList()
    expect(state.seenUrl).toContain('/api/session/list')
    expect(state.seenBody.method).toBe('session/list')
    expect(state.seenBody.payload.args).toEqual({ _request: {} })
    expect(value.items).toEqual([
      expect.objectContaining({ sessionId: 's1', running: true, blank: false, cwd: 'C:\\ws' }),
    ])
  })

  it('行形状不符按 bad-response 拒绝', async () => {
    const { fetch } = fakeFetch(state => okEnvelope(state, { items: [{ sessionId: 7 }] }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.sessionList()).rejects.toMatchObject({ code: 'bad-response' })
  })

  it('空列表是合法结果', async () => {
    const { fetch } = fakeFetch(state => okEnvelope(state, { items: [] }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.sessionList()).resolves.toEqual({ items: [] })
  })
})

describe('createHarnessApi / sessionCreate', () => {
  it('session/create：request 包裹 cwd 载荷，解析 sessionId', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, { sessionId: 'fk-new' }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    const created = await api.sessionCreate({ cwd: 'C:\\ud' })
    expect(state.seenBody.method).toBe('session/create')
    expect(state.seenBody.payload.args).toEqual({ request: { cwd: 'C:\\ud' } })
    expect(created.sessionId).toBe('fk-new')
  })

  it('响应缺 sessionId 按 bad-response 拒绝', async () => {
    const { fetch } = fakeFetch(state => okEnvelope(state, {}))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.sessionCreate({ cwd: 'C:\\ud' })).rejects.toMatchObject({ code: 'bad-response' })
  })
})

describe('createHarnessApi / sessionPrompt', () => {
  it('session/prompt：request 携带客户端 mint 的 requestId（关联身份必填）', async () => {
    const { state, fetch } = fakeFetch(state => okEnvelope(state, { accepted: true }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await api.sessionPrompt({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
    expect(state.seenBody.method).toBe('session/prompt')
    const request = (state.seenBody.payload.args as { request: Record<string, unknown> }).request
    expect(request).toMatchObject({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
    expect(typeof request.requestId).toBe('string')
    expect((request.requestId as string).length).toBeGreaterThan(0)
  })

  it('accepted 不为 true 按 bad-response 拒绝', async () => {
    const { fetch } = fakeFetch(state => okEnvelope(state, { accepted: false }))
    const api = createHarnessApi({ baseUrl: 'http://127.0.0.1:3080', fetch: fetch as never })
    await expect(api.sessionPrompt({ sessionId: 's1', mode: 'queue', content: [] }))
      .rejects.toMatchObject({ code: 'bad-response' })
  })
})
