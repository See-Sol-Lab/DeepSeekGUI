// @vitest-environment jsdom
/**
 * The control-bridge slice the skills page uses: address parsing, the one
 * command it sends, and how the picked path comes back.
 * @module @see-sol-lab/deepseekgui-skills/tests/bridge
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseControlBridge, pickSource, readBridge, type ControlBridgeClient } from '../src/client/bridge.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('parseControlBridge', () => {
  it('parses port and token and rejects malformed values', () => {
    expect(parseControlBridge('?deepseekgui-control=4321.abc')).toEqual({ port: '4321', token: 'abc' })
    expect(parseControlBridge('?x=1&deepseekgui-control=4321.a.b#h')).toEqual({ port: '4321', token: 'a.b' })
    expect(parseControlBridge('')).toBeNull()
    expect(parseControlBridge('?deepseekgui-control=.abc')).toBeNull()
    expect(parseControlBridge('?deepseekgui-control=4321')).toBeNull()
  })
})

describe('readBridge', () => {
  it('returns null outside the DeepSeekGUI window', () => {
    window.history.replaceState(null, '', '/')
    expect(readBridge()).toBeNull()
  })

  it('posts the command with the token and returns the model, or throws the error body', async () => {
    window.history.replaceState(null, '', '/?deepseekgui-control=4321.tok')
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:4321/control/command')
      expect(init.headers).toMatchObject({ 'x-deepseekgui-control-token': 'tok' })
      const body = JSON.parse(String(init.body)) as { command: { kind: string } }
      return body.command.kind === 'file'
        ? { ok: true, status: 200, json: async () => ({ ok: true, model: { skillPick: { nonce: 1, kind: 'file', path: 'E:/a.zip' } } }) }
        : { ok: false, status: 400, json: async () => ({ error: 'unknown command' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const bridge = readBridge()
    expect(bridge).not.toBeNull()
    expect(await bridge!.run({ type: 'skill-pick-source', kind: 'file' })).toEqual({ skillPick: { nonce: 1, kind: 'file', path: 'E:/a.zip' } })
    await expect(bridge!.run({ type: 'skill-pick-source', kind: 'directory' })).rejects.toThrow('unknown command')
    window.history.replaceState(null, '', '/')
  })

  it('reports HTTP status when the error body is not JSON', async () => {
    window.history.replaceState(null, '', '/?deepseekgui-control=4321.tok')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('no json') } })))
    await expect(readBridge()!.run({ type: 'skill-pick-source', kind: 'directory' })).rejects.toThrow('HTTP 500')
    window.history.replaceState(null, '', '/')
  })
})

describe('pickSource', () => {
  const bridgeWith = (model: unknown): ControlBridgeClient => ({ run: vi.fn(async () => model as never) })

  it('returns the picked path, null on cancel, and ignores a pick of another kind', async () => {
    expect(await pickSource(bridgeWith({ skillPick: { nonce: 1, kind: 'directory', path: 'E:/skills/a' } }), 'directory')).toBe('E:/skills/a')
    expect(await pickSource(bridgeWith({ skillPick: { nonce: 2, kind: 'directory', path: null } }), 'directory')).toBeNull()
    expect(await pickSource(bridgeWith({ skillPick: { nonce: 3, kind: 'file', path: 'E:/a.zip' } }), 'directory')).toBeNull()
    expect(await pickSource(bridgeWith({}), 'file')).toBeNull()
    expect(await pickSource(bridgeWith({ skillPick: null }), 'file')).toBeNull()
  })
})
