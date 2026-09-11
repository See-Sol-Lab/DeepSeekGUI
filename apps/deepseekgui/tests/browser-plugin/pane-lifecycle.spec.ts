/**
 * Embedded-pane lifecycle matrix (B6-4): drives the real
 * `DeepSeekGUIBrowser` state machine over fake CDP objects, in the exact
 * call order the tools produce (navigate → wait → snapshot/click). The
 * shell bridge, the SSRF proxy, and playwright's chromium are mocked at the
 * module boundary; the manager's own state transitions are the subject.
 *
 * Cases: same Session, consecutive calls (Session switch), panel closed with
 * the ✕ and reopened, renderer/view rebuild, navigation failure, and the
 * empty placeholder page.
 * @module @see-sol-lab/deepseekgui/tests/browser-plugin/pane-lifecycle
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const hook = vi.hoisted(() => ({
  connectOverCDP: undefined as undefined | ((url: string) => Promise<unknown>),
  paneEnsure: undefined as undefined | ((bridge: unknown) => Promise<{ cdpPort: number; paneUrl: string }>),
  paneSetProxy: undefined as undefined | ((bridge: unknown, rules: string) => Promise<void>),
  paneHide: undefined as undefined | ((bridge: unknown) => Promise<void>),
  paneReveal: undefined as undefined | ((bridge: unknown) => Promise<void>),
  startSsrfProxy: undefined as undefined | ((lookup: unknown) => Promise<{ port: number; close: () => Promise<void> }>),
  counts: { connect: 0, ensure: 0, proxyStarted: 0, proxyClosed: 0, paneHidden: 0, paneRevealed: 0 },
}))

vi.mock('playwright-core', () => ({
  chromium: {
    connectOverCDP: (url: string) => hook.connectOverCDP!(url),
    launch: () => Promise.reject(new Error('headed launch is not used by these pane cases')),
  },
}))

vi.mock('../../browser-plugin/src/pane.ts', () => ({
  paneBridgeFromEnv: () => null,
  paneEnsure: (bridge: unknown) => hook.paneEnsure!(bridge),
  paneSetProxy: (bridge: unknown, rules: string) => hook.paneSetProxy!(bridge, rules),
  paneHide: (bridge: unknown) => hook.paneHide!(bridge),
  paneReveal: (bridge: unknown) => hook.paneReveal!(bridge),
}))

vi.mock('../../browser-plugin/src/proxy.ts', () => ({
  startSsrfProxy: (lookup: unknown) => hook.startSsrfProxy!(lookup),
}))

const { DeepSeekGUIBrowser } = await import('../../browser-plugin/src/browser.ts')

/** The shell's empty-state marker page (title is the claim marker). */
const MARKER_URL = 'data:text/html;charset=utf-8,%3C!doctype%20html%3E'
const MARKER_TITLE = 'deepseekgui-browser-pane'
const BRIDGE = { origin: 'http://127.0.0.1:1234', token: 't' }
const LOOKUP = { lookup: async (): Promise<readonly string[]> => ['93.184.216.34'] }

class FakeCdpSession {
  async send(method: string): Promise<unknown> {
    return method === 'Accessibility.getFullAXTree'
      ? { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Root' }, childIds: [] }] }
      : {}
  }

  async detach(): Promise<void> {}
}

class FakeContext {
  constructor(readonly pageList: FakePage[]) {
    for (const page of pageList) page.attach(this)
  }

  pages(): FakePage[] {
    return this.pageList
  }

  async newCDPSession(_page: FakePage): Promise<FakeCdpSession> {
    return new FakeCdpSession()
  }
}

class FakePage {
  closed = false
  gotoError: Error | null = null
  contextRef: FakeContext | null = null
  keyboard = { press: async (): Promise<void> => {}, type: async (): Promise<void> => {} }

  constructor(public currentUrl: string, public pageTitle = 'Title') {}

  attach(context: FakeContext): void {
    this.contextRef = context
  }

  context(): FakeContext {
    if (this.contextRef === null) throw new Error('fake page has no context')
    return this.contextRef
  }

  url(): string {
    return this.currentUrl
  }

  isClosed(): boolean {
    return this.closed
  }

  async title(): Promise<string> {
    return this.pageTitle
  }

  setDefaultTimeout(_ms: number): void {}

  async goto(url: string): Promise<void> {
    if (this.gotoError !== null) throw this.gotoError
    this.currentUrl = url
    this.pageTitle = 'Example Domain'
  }

  async waitForLoadState(): Promise<void> {}
  async waitForTimeout(): Promise<void> {}
  async waitForSelector(): Promise<void> {}
  async screenshot(): Promise<Buffer> {
    return Buffer.from('fake-png')
  }

  async evaluate(): Promise<string> {
    return 'visible text'
  }

  /** Simulate the shell destroying this view (the ✕ path). */
  destroy(): void {
    this.closed = true
  }
}

class FakeBrowser {
  disconnected: (() => void) | null = null

  constructor(readonly context: FakeContext) {}

  contexts(): FakeContext[] {
    return [this.context]
  }

  on(event: string, listener: () => void): void {
    if (event === 'disconnected') this.disconnected = listener
  }

  async close(): Promise<void> {}
}

/** The shell side of the contract: which pages exist and what ensure reports. */
interface Shell {
  pages: FakePage[]
  paneUrl: string
}

function wire(shell: Shell): void {
  hook.counts = { connect: 0, ensure: 0, proxyStarted: 0, proxyClosed: 0, paneHidden: 0, paneRevealed: 0 }
  hook.startSsrfProxy = async () => {
    hook.counts.proxyStarted += 1
    return { port: 45678, close: async () => { hook.counts.proxyClosed += 1 } }
  }
  hook.paneSetProxy = async () => {}
  hook.paneHide = async () => { hook.counts.paneHidden += 1 }
  hook.paneReveal = async () => { hook.counts.paneRevealed += 1 }
  hook.paneEnsure = async () => {
    hook.counts.ensure += 1
    return { cdpPort: 9333, paneUrl: shell.paneUrl }
  }
  hook.connectOverCDP = async () => {
    hook.counts.connect += 1
    return new FakeBrowser(new FakeContext(shell.pages))
  }
}

function manager(): InstanceType<typeof DeepSeekGUIBrowser> {
  return new DeepSeekGUIBrowser({ lookup: LOOKUP, paneBridge: BRIDGE, screenshotDir: 'E:\\fake-shots' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('嵌入式 pane 生命周期矩阵（B6-4）', () => {
  it('同一 Session：navigate → wait → snapshot 复用同一页，不重建、不回到占位页', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()

    await expect(browser.navigate('https://example.com/', 5_000))
      .resolves.toEqual({ finalUrl: 'https://example.com/', title: 'Example Domain' })
    await browser.wait('load', null, 100)
    const snapshot = await browser.snapshot(3)
    expect(snapshot.url).toBe('https://example.com/')
    expect(snapshot.nodes.length).toBeGreaterThan(0)
    // One attach for the whole sequence: no rebuild happened under the tools.
    expect(hook.counts.connect).toBe(1)
    expect(hook.counts.ensure).toBe(1)
    // The navigation opened the panel; reading it afterwards did not (#22).
    expect(hook.counts.paneRevealed).toBe(1)
  })

  it('每次导航都弹出面板，桥出错不影响导航本身（#22）', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)
    hook.paneReveal = async () => { hook.counts.paneRevealed += 1; throw new Error('bridge down') }
    await expect(browser.navigate('https://example.com/2', 5_000)).resolves.toMatchObject({ finalUrl: 'https://example.com/2' })
    expect(hook.counts.paneRevealed).toBe(2)
  })

  it('连续调用（会话切换不携带状态）：第二次调用不触发任何重置', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)
    // A call from another Session reaches the same shared manager.
    await browser.snapshot(3)
    await browser.currentUrl()
    expect(hook.counts.connect).toBe(1)
    expect(hook.counts.proxyStarted).toBe(1)
  })

  it('用户 ✕ 销毁面板后再调用：返回可行动错误，显式 navigate 恢复', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)

    // The ✕ destroys the view; the shell builds a fresh marker view when the
    // panel is reopened.
    page.destroy()
    const fresh = new FakePage(MARKER_URL, MARKER_TITLE)
    shell.pages = [fresh]
    shell.paneUrl = MARKER_URL

    await expect(browser.snapshot(3)).rejects.toThrow(/browser_navigate/)
    expect(hook.counts.connect).toBe(2)
    // The explicit navigate recovers on the new view.
    await expect(browser.navigate('https://example.com/', 5_000)).resolves.toMatchObject({
      finalUrl: 'https://example.com/',
    })
    await expect(browser.snapshot(3)).resolves.toMatchObject({ url: 'https://example.com/' })
  })

  it('占位页：snapshot 与 screenshot 都给出指向 browser_navigate 的可行动错误', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await expect(browser.snapshot(3)).rejects.toThrow(/call browser_navigate again/)
    await expect(browser.screenshot(false)).rejects.toThrow(/call browser_navigate again/)
  })

  it('导航失败：错误回给调用方，页面状态不被重置，下一次 navigate 仍复用同一页', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)
    page.gotoError = new Error('net::ERR_NAME_NOT_RESOLVED')
    await expect(browser.navigate('https://unreachable.example/', 5_000))
      .rejects.toThrow('net::ERR_NAME_NOT_RESOLVED')
    // No reset: the same attachment keeps serving the next call.
    expect(hook.counts.connect).toBe(1)
    page.gotoError = null
    await expect(browser.navigate('https://example.com/next', 5_000)).resolves.toMatchObject({
      finalUrl: 'https://example.com/next',
    })
    expect(hook.counts.connect).toBe(1)
  })

  it('renderer 重建但旧 target 未报告关闭：管理器不会自愈（当前行为记录）', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)

    // The shell replaces the view's renderer without closing the old page
    // object (crash-and-reload path): the manager keeps driving the stale
    // page because nothing told it the target died.
    const replacement = new FakePage(MARKER_URL, MARKER_TITLE)
    shell.pages = [replacement]
    const stale = await browser.snapshot(3)
    expect(stale.url).toBe('https://example.com/')
    expect(hook.counts.connect).toBe(1)
  })

  it('用户手动在面板里导航后，工具跟随当前页而不是回到旧页', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)
    // A human clicks a link inside the pane: the same target's URL moves.
    page.currentUrl = 'https://manual.example/page'
    expect((await browser.snapshot(3)).url).toBe('https://manual.example/page')
    expect(hook.counts.connect).toBe(1)
  })

  it('Chromium 错误页：读操作给出可行动错误而不是空页面', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: MARKER_URL }
    wire(shell)
    const browser = manager()
    await browser.navigate('https://example.com/', 5_000)
    // The renderer died and Chromium committed its own error document.
    page.currentUrl = 'chrome-error://chromewebdata/'
    await expect(browser.snapshot(3)).rejects.toThrow(/browser_navigate/)
    await expect(browser.screenshot(false)).rejects.toThrow(/browser_navigate/)
  })

  it('claim 失败：报出可行动的连接错误', async () => {
    const page = new FakePage(MARKER_URL, MARKER_TITLE)
    const shell: Shell = { pages: [page], paneUrl: 'https://never-matches.example/' }
    wire(shell)
    const browser = manager()
    await expect(browser.navigate('https://example.com/', 5_000))
      .rejects.toThrow(/browser pane|browser panel|reopen|restart/i)
  })
})
