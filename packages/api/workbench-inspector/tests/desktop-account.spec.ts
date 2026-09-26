import { afterEach, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import type { AccountView, PlatformSession } from '@deepseek-ai/dsh-deepseek-account'
import { ACCOUNT_BRIDGE_ENV, DESKTOP_ACCOUNT_SHIM, installDesktopAccountBridge, parseAccountBridge } from '../src/desktop-account.ts'

const contexts: Context[] = []
afterEach(async () => {
  Reflect.deleteProperty(globalThis, Symbol.for('deepseekgui.accountBridge'))
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const signedOut: AccountView = {
  status: 'signed-out', attempt: null,
  links: { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' },
}
const signedIn: AccountView = { ...signedOut, status: 'credential-stored' }
const session: PlatformSession = { origin: 'https://platform.deepseek.com', token: 'grant', userId: null }

function indexTable(ctx: Context): IndexInjection[] {
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table)
  return table
}

it('parses only a loopback host:port#token route', () => {
  expect(parseAccountBridge('127.0.0.1:4321#secret')).toEqual({ url: 'http://127.0.0.1:4321/control/account', token: 'secret' })
  expect(parseAccountBridge(undefined)).toBeUndefined()
  expect(parseAccountBridge('example.com:80#x')).toBeUndefined()
  expect(parseAccountBridge('127.0.0.1:4321')).toBeUndefined()
})

it('stays inert when DeepSeekGUI did not launch the Host', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const post = vi.fn<typeof fetch>()
  installDesktopAccountBridge(ctx, {}, post)
  ctx.provide('deepseekAccount', { watch: vi.fn(), getPlatformSession: vi.fn() } as never)
  await new Promise(resolve => setTimeout(resolve, 10))
  expect(indexTable(ctx)).toEqual([])
  expect(post).not.toHaveBeenCalled()
})

it('injects the page shim and pushes every account frame with its Platform session', async () => {
  const ctx = new Context(); contexts.push(ctx)
  const post = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
  const env: NodeJS.ProcessEnv = { [ACCOUNT_BRIDGE_ENV]: '127.0.0.1:4321#secret' }
  installDesktopAccountBridge(ctx, env, post)
  // Commands the agent starts inherit this environment: the route must be gone.
  expect(env[ACCOUNT_BRIDGE_ENV]).toBeUndefined()
  expect(indexTable(ctx)).toEqual([{ kind: 'script', placement: 'head', text: DESKTOP_ACCOUNT_SHIM }])
  const frames = [signedOut, signedIn]
  const getPlatformSession = vi.fn(async () => session)
  ctx.provide('deepseekAccount', {
    async *watch(signal: AbortSignal) {
      for (const frame of frames) yield frame
      await new Promise((resolve) => { signal.addEventListener('abort', resolve) })
    },
    getPlatformSession,
  } as never)
  await vi.waitFor(() => { expect(post).toHaveBeenCalledTimes(2) })
  const [url, init] = post.mock.calls[1] ?? []
  expect(url).toBe('http://127.0.0.1:4321/control/account')
  expect(init?.headers).toMatchObject({ 'x-deepseekgui-control-token': 'secret' })
  expect(init?.redirect).toBe('error')
  expect(JSON.parse(init?.body as string)).toEqual({ view: signedIn, session })
})

it('installs the desktop carriers only in a page DeepSeekGUI loaded', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 200 }))
  const inWindow: Record<string, unknown> = { location: { search: '?deepseekgui-control=5555.tok' }, fetch }
  runInNewContext(DESKTOP_ACCOUNT_SHIM, inWindow)
  expect(inWindow.dshDesktop).toEqual({ shell: 'deepseekgui' })
  const platform = inWindow.dshPlatform as { open: (page: string, rect: object) => Promise<void>; close: () => Promise<void> }
  await platform.open('top-up', { x: 1, y: 2, width: 3, height: 4, top: 9 })
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:5555/control/platform', expect.objectContaining({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': 'tok' },
    body: JSON.stringify({ type: 'open', page: 'top-up', bounds: { x: 1, y: 2, width: 3, height: 4 } }),
  }))
  fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
  await expect(platform.close()).rejects.toThrow('HTTP 404')

  const outside: Record<string, unknown> = { location: { search: '' }, fetch }
  runInNewContext(DESKTOP_ACCOUNT_SHIM, outside)
  expect('dshDesktop' in outside).toBe(false)
  expect('dshPlatform' in outside).toBe(false)
  expect('dshOnboarding' in outside).toBe(false)
})

/** A fake same-origin Harness RPC answering the three reads and recording writes. */
function harness(credentials: Record<string, { configured: boolean }>) {
  const calls: { method: string; args: unknown }[] = []
  const answers: Record<string, unknown> = {
    'settings/describe': { namespaces: [
      { ns: 'llm-deepseek', value: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { ns: 'llm-pi-ai', value: { providers: { kimi: { apiKeyEnv: 'KIMI_KEY' } } } },
    ] },
    'llm/listConfigurableProviders': [
      { provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'kimi', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kimi'] },
    ],
    'credentials/describe': credentials,
    'credentials/set': null,
  }
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = JSON.parse(init.body as string) as { rpcId: string; method: string; payload: { args: unknown } }
    calls.push({ method: request.method, args: request.payload.args })
    expect(url).toBe(`/api/${request.method}`)
    return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: answers[request.method] } }))
  })
  const page: Record<string, unknown> = { location: { search: '?deepseekgui-control=5555.tok' }, fetch, crypto }
  runInNewContext(DESKTOP_ACCOUNT_SHIM, page)
  return { onboarding: page.dshOnboarding as { hasApiKey(): Promise<boolean>; saveApiKey(value: string): Promise<boolean> }, calls }
}

it('reports an API key configured on any configurable provider, like the official welcome backend', async () => {
  expect(await harness({ DEEPSEEK_API_KEY: { configured: false }, KIMI_KEY: { configured: true } }).onboarding.hasApiKey()).toBe(true)
  const none = harness({ DEEPSEEK_API_KEY: { configured: false }, KIMI_KEY: { configured: false } })
  expect(await none.onboarding.hasApiKey()).toBe(false)
  expect(none.calls.at(-1)).toEqual({ method: 'credentials/describe', args: { refs: ['DEEPSEEK_API_KEY', 'KIMI_KEY'] } })
})

it('saves only a printable key, into the official DeepSeek credential reference', async () => {
  const { onboarding, calls } = harness({})
  expect(await onboarding.saveApiKey('bad key')).toBe(false)
  expect(calls).toEqual([])
  expect(await onboarding.saveApiKey('sk-test')).toBe(true)
  expect(calls.at(-1)).toEqual({ method: 'credentials/set', args: { ref: 'DEEPSEEK_API_KEY', value: 'sk-test' } })
})
