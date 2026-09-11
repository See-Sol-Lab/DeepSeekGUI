/**
 * Browser instance management for the DeepSeekGUI browser capability.
 *
 * One headed Edge (channel 'msedge') browser per plugin instance, driven
 * through a loopback SSRF proxy so every navigation (and every redirect hop)
 * is validated before any byte moves. Tabs share one context; cookies are NOT
 * persisted to disk (B2 decision: headed + human login inside the visible
 * window; persistence switch is B3).
 *
 * The manager is session-free: any tool call may use the shared instance.
 * Browser crashes (kernel process death) never take down the harness process —
 * playwright reports the disconnect and the next call restarts the browser.
 *
 * @module @see-sol-lab/deepseekgui-browser/browser
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from 'playwright-core'
import { randomUUID } from 'node:crypto'
import type { ClickTargetFacts } from './gate.ts'
import type { HostLookup } from './ssrf.ts'
import { validateNavigationTarget } from './ssrf.ts'
import { startSsrfProxy, type SsrfProxy } from './proxy.ts'
import { paneEnsure, paneHide, paneReveal, paneSetProxy, type PaneBridge } from './pane.ts'

/** Snapshot tree node (a11y), model-facing. Index signature makes it a JsonValue. */
export interface A11yNode {
  ref: string
  role: string
  name: string
  value: string
  children: A11yNode[]
  [key: string]: string | A11yNode[]
}

/** Tab inventory entry. */
export interface TabInfo {
  index: number
  url: string
  title: string
}

/** Browser manager options. */
export interface BrowserManagerOptions {
  /** DNS injection for the SSRF gate (nodeLookup in production). */
  lookup: HostLookup
  /** Directory screenshots are written to; defaults to $DEEPSEEKGUI_USERDATA/deepseekgui-browser/screenshots. */
  screenshotDir?: string
  /** Playwright channel; defaults to system Edge. */
  channel?: string
  /** Headed by default (user-visible browsing). */
  headless?: boolean
  /**
   * Embedded-pane bridge (B3-11). Present = drive the in-window pane via
   * connectOverCDP instead of launching a separate Edge window; the facade
   * surface is identical, only the chrome differs (Codex-style split view).
   */
  paneBridge?: PaneBridge
}

/** Model-facing element locator. Ref is preferred (from a snapshot); text,
 * selector, or role+name are fallbacks. All resolution happens INSIDE the
 * browser process (CDP input injection) — the physical mouse and keyboard of
 * the user's machine are never touched, and no window focus is stolen. */
export interface ElementLocator {
  /** Snapshot ref (e.g. "a0.1.0"), resolved against the last snapshot. */
  ref?: string
  /** Visible text of the element (button label, link text...). */
  text?: string
  /** CSS selector. */
  selector?: string
  /** ARIA role + accessible name (pair with `name`). */
  role?: string
  name?: string
}

/** The shared browser facade tools call. */
export interface BrowserFacade {
  /** Navigate the active tab (SSRF-gated); returns the settled URL + title. */
  navigate(url: string, timeoutMs: number): Promise<{ finalUrl: string; title: string }>
  /** A11y snapshot of the active tab. */
  snapshot(maxDepth: number): Promise<{ title: string; url: string; nodes: A11yNode[]; text: string }>
  /** Screenshot the active tab to a file; returns the absolute path. */
  screenshot(fullPage: boolean): Promise<string>
  /** Wait for a condition. */
  wait(condition: 'load' | 'network-idle' | 'timeout', selector: string | null, ms: number): Promise<void>
  /** Tab management; `index` names the tab to close (default: the active one). */
  tabs(action: 'list' | 'new' | 'switch' | 'close', index?: number): Promise<TabInfo[]>
  /** Switch the active tab by index. */
  selectTab(index: number): Promise<void>
  /** Click an element (in-process injection; never the physical mouse). */
  click(loc: ElementLocator, button: 'left' | 'right'): Promise<void>
  /** Read what a click would land on, so consequential clicks can be gated. */
  inspectClickTarget(loc: ElementLocator): Promise<ClickTargetFacts | null>
  /** Type into an input; optionally clear first and/or press Enter after. */
  type(loc: ElementLocator, text: string, clearFirst: boolean, pressEnter: boolean): Promise<void>
  /** Scroll the page (or bring a located element into view). */
  scroll(direction: 'up' | 'down' | 'top' | 'bottom', amount: number, loc: ElementLocator | null): Promise<void>
  /** Press keyboard keys in the page (e.g. "Enter", "Control+A"). */
  keyboard(keys: string): Promise<void>
  /** Hover an element (menus, previews). */
  hover(loc: ElementLocator): Promise<void>
  /** Submit a form / send / login (L2 in the gate; the tool layer approves). */
  submit(loc: ElementLocator): Promise<void>
  /** Current page URL (post-navigation verification helper). */
  currentUrl(): Promise<string>
  /** Close the browser and proxy. */
  close(): Promise<void>
}

const DEFAULT_CHANNEL = 'msedge'
const DEFAULT_SCREENSHOT_DIR = () => {
  const base = process.env.DEEPSEEKGUI_USERDATA ?? process.env.TEMP ?? process.cwd()
  return `${base.replace(/[\\/]$/, '')}/deepseekgui-browser/screenshots`
}

/** Ref prefix for a11y nodes; M3 click/type will address elements by these. */
function refForPath(path: readonly number[]): string {
  return `a${path.join('.')}`
}

/** Extract visible text from the page (model-readable body). */
async function pageText(page: Page): Promise<string> {
  // evaluate with a string expression: no DOM types leak into this Node module.
  const text = await page.evaluate('document.body ? document.body.innerText : ""')
  return typeof text === 'string' ? text.slice(0, 20_000) : ''
}

/** CDP Accessibility.getFullAXTree node (the subset we consume). */
interface CdpAxNode {
  nodeId: string
  parentId?: string
  ignored?: boolean
  role?: { value: string }
  name?: { value: string }
  value?: { value: string }
  childIds?: string[]
}

/** Fetch the full a11y tree via CDP (playwright-core has no page.accessibility). */
async function cdpAccessibilityTree(page: Page): Promise<CdpAxNode[]> {
  const session: CDPSession = await page.context().newCDPSession(page)
  try {
    const result = await session.send('Accessibility.getFullAXTree') as { nodes?: CdpAxNode[] }
    return result.nodes ?? []
  } finally {
    await session.detach().catch(() => undefined)
  }
}

/**
 * Turn a CDP connection failure into something a person can act on.
 *
 * The debugging port is chosen at random when DeepSeekGUI starts and cannot be
 * reserved beforehand — the switch has to be set before the app is ready,
 * and there is no synchronous way to claim a port that early. So a collision
 * with another program on this machine is rare but possible, and the raw
 * failure ("connect ECONNREFUSED 127.0.0.1:31337") tells the user nothing.
 * Restarting picks a new port, which is the actual fix.
 * @param port - the CDP port that was attempted.
 * @param cause - the underlying error.
 * @returns an error worth showing.
 */
export function cdpConnectFailure(port: number, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(
    `Could not reach the browser debugging port ${String(port)} (${detail}). `
    + 'DeepSeekGUI picks this port at random on startup, so another program on this '
    + 'machine may be holding it. Restarting DeepSeekGUI picks a different port.',
  )
}

/** Flatten the model tree into a ref → (role, name) table for locator resolution. */
export function collectRefs(nodes: readonly A11yNode[], out: Map<string, { role: string; name: string }>): void {
  for (const node of nodes) {
    out.set(node.ref, { role: node.role, name: node.name })
    collectRefs(node.children, out)
  }
}

/**
 * Total nodes one snapshot may produce.
 *
 * The depth cap alone does not bound the work: a single level of a generated
 * page can hold tens of thousands of siblings, and all of them end up in the
 * model's context as well as in memory here.
 */
export const A11Y_MAX_NODES = 5_000

/** Height ceiling for a full-page screenshot, in CSS pixels. */
export const SCREENSHOT_MAX_HEIGHT = 20_000

/**
 * Ceiling for a single page operation (click, fill, hover, scroll).
 *
 * It has to stay clear of the tool-level timeout above it, which is 30s for
 * most tools. Playwright's own default is also 30s, so the two used to expire
 * together: the tool could give up on a click at the very moment the click
 * went through, reporting a failure for something that actually happened. On
 * a Submit button that is the worst possible answer. Ending the underlying
 * operation first means the tool's verdict matches what the page did.
 */
export const OPERATION_TIMEOUT_MS = 20_000

/**
 * How long a locator may wait for its first match before the tool says
 * "nothing matches". Dynamic pages attach elements late, so zero is wrong;
 * but a name that matches nothing must come back in seconds, not after the
 * whole operation timeout (2026-09-11 manual test round 3: a role/name that
 * existed nowhere on the page sat for the full 30s).
 */
export const LOCATOR_ATTACH_TIMEOUT_MS = 3_000

/**
 * Rebuild the CDP flat list into the model tree (orphan nodes dropped, depth
 * and count capped).
 *
 * Ignored nodes are transparent, not pruned: Chromium's full tree keeps the
 * generic wrappers a page is made of as `ignored: true` nodes WITH the real
 * links and buttons hanging under them. The first port returned null for an
 * ignored node and so dropped its whole subtree — on any real site the
 * snapshot came back as a bare RootWebArea and the model had no refs to
 * click, only text (2026-09-11 manual test round 3). An ignored node now
 * contributes its children to its parent and costs no depth.
 * @param raw - the CDP node list.
 * @param maxDepth - deepest emitted level (ignored levels are free).
 * @param maxNodes - emitted-node ceiling.
 * @returns the model tree.
 */
export function cdpTreeToNodes(raw: readonly CdpAxNode[], maxDepth: number, maxNodes = A11Y_MAX_NODES): A11yNode[] {
  const byId = new Map(raw.map(node => [node.nodeId, node]))
  const seen = new Set<string>()
  const out: A11yNode[] = []
  const roots = raw.filter(node => node.parentId === undefined || node.parentId === '')
  const stack = roots.toReversed().map(node => ({ node, parentPath: [] as number[], into: out }))
  let produced = 0
  while (stack.length > 0 && produced < maxNodes) {
    const { node, parentPath, into } = stack.pop()!
    if (seen.has(node.nodeId)) continue
    seen.add(node.nodeId)
    let path = parentPath
    let children = into
    if (node.ignored !== true) {
      path = [...parentPath, into.length]
      if (path.length > maxDepth) continue
      children = []
      into.push({ ref: refForPath(path), role: node.role?.value ?? '', name: node.name?.value ?? '', value: node.value?.value ?? '', children })
      produced++
    }
    for (const childId of (node.childIds ?? []).toReversed()) {
      const child = byId.get(childId)
      if (child !== undefined) stack.push({ node: child, parentPath: path, into: children })
    }
  }
  return out
}

/**
 * The shared browser manager. Lazily launches on first use; the launch is
 * serialized so concurrent tool calls share one instance.
 */
/**
 * Find the shell view whose committed URL is the claim key. The CDP endpoint
 * exposes every view in the shell, so identity is by URL and nothing else is
 * ever adopted.
 * @param browser - the CDP connection.
 * @param paneUrl - the URL the shell reported for its pane.
 * @returns the matching page, or undefined.
 */
/** The slice of a playwright Locator the visible-first narrowing needs (fakeable in tests). */
export interface MatchSet<T> {
  first(): T & { waitFor(options: { state: 'attached'; timeout: number }): Promise<void> }
  filter(options: { visible: boolean }): { count(): Promise<number>; first(): T }
  count(): Promise<number>
}

/**
 * Narrow a match set to the first visible element, failing fast and
 * specifically otherwise (the policy {@link DeepSeekGUIBrowser.resolveTarget}
 * applies; see its comment for the three failures this replaces).
 * @param matches - every element the locator matches.
 * @param label - {@link describeLocator} output for the message.
 * @param attachTimeoutMs - how long to wait for the first match to exist at all.
 * @returns the first visible match.
 */
export async function firstVisibleMatch<T>(
  matches: MatchSet<T>,
  label: string,
  attachTimeoutMs: number = LOCATOR_ATTACH_TIMEOUT_MS,
): Promise<T> {
  try {
    await matches.first().waitFor({ state: 'attached', timeout: attachTimeoutMs })
  } catch {
    throw new Error(`no element matches ${label} (waited ${String(attachTimeoutMs)}ms); take a browser_snapshot and pick a ref or text from it`)
  }
  const visible = matches.filter({ visible: true })
  if (await visible.count() === 0) {
    const total = await matches.count()
    throw new Error(`${String(total)} element(s) match ${label} but none is visible (hidden by pagination, a collapsed section, or an off-screen duplicate); scroll or navigate to where it is shown, or use a more specific locator`)
  }
  return visible.first()
}

/** One-line description of a model locator for error messages. */
export function describeLocator(loc: ElementLocator): string {
  if (loc.selector !== undefined && loc.selector !== '') return `selector ${JSON.stringify(loc.selector)}`
  if (loc.role !== undefined && loc.role !== '') {
    return loc.name !== undefined && loc.name !== '' ? `role ${loc.role} named ${JSON.stringify(loc.name)}` : `role ${loc.role}`
  }
  if (loc.ref !== undefined && loc.ref !== '') return `ref ${loc.ref}`
  if (loc.text !== undefined && loc.text !== '') return `text ${JSON.stringify(loc.text)}`
  return 'the locator'
}

/** The shell's empty-state page: a data: document titled by the pane marker. */
export function isPanePlaceholder(url: string, title: string): boolean {
  return url.startsWith('data:') && title === 'deepseekgui-browser-pane'
}

/**
 * Chromium's own error document: the committed navigation failed or the
 * renderer died, so the visible page is not the site the caller asked for.
 * Reading it would hand the model an empty tree as if the page were fine.
 * @param url - the page's current URL.
 * @returns true when the page is Chromium's error document.
 */
export function isChromiumErrorPage(url: string): boolean {
  return url.startsWith('chrome-error://')
}

function findPaneByUrl(browser: Browser, paneUrl: string): Page | undefined {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url() === paneUrl) return page
    }
  }
  return undefined
}

export class DeepSeekGUIBrowser implements BrowserFacade {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private proxy: SsrfProxy | null = null
  private activeTabIndex = 0
  /** Embedded-pane mode: the single in-window page this instance may drive. */
  private panePage: Page | null = null
  /** Last snapshot's ref → (role, name), for interaction locator resolution. */
  private readonly refTable = new Map<string, { role: string; name: string }>()
  private readonly options: Required<Pick<BrowserManagerOptions, 'lookup' | 'screenshotDir'>> &
    Pick<BrowserManagerOptions, 'channel' | 'headless' | 'paneBridge'>
  private launchQueue: Promise<void> | null = null
  private closed = false
  private refPage: Page | null = null
  private refUrl = ''

  constructor(options: BrowserManagerOptions) {
    this.options = {
      lookup: options.lookup,
      screenshotDir: options.screenshotDir ?? DEFAULT_SCREENSHOT_DIR(),
      channel: options.channel ?? DEFAULT_CHANNEL,
      headless: options.headless ?? false,
      ...options.paneBridge !== undefined ? { paneBridge: options.paneBridge } : {},
    }
  }

  /** Launch (once) the proxy + browser; concurrent callers share the promise. */
  private ensure(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('browser instance has been disposed'))
    // Pane mode: the user's ✕ destroys the pane view, but the CDP connection
    // targets the whole shell — no 'disconnected' fires for one closed
    // target. Detect the dead page here and reset the full chain, so the
    // next tool call rebuilds a fresh pane instead of reporting closed
    // forever (the shell keeps it silent until the user reopens the panel).
    if (this.panePage !== null && this.panePage.isClosed()) {
      const stale = { browser: this.browser, proxy: this.proxy }
      this.panePage = null
      this.context = null
      this.browser = null
      this.proxy = null
      this.launchQueue = null
      void stale.browser?.close().catch(() => undefined)
      void stale.proxy?.close().catch(() => undefined)
    }
    this.launchQueue ??= this.launch()
    return this.launchQueue
  }

  private async launch(): Promise<void> {
    let proxy: SsrfProxy | undefined
    let launched: Browser | null = null
    try {
      proxy = await startSsrfProxy(this.options.lookup)
      this.proxy = proxy
      if (this.closed) throw new Error('browser instance has been disposed')
      if (this.options.paneBridge !== undefined) {
        await this.attachPane(this.options.paneBridge, proxy)
        return
      }
      const browser = await chromium.launch({
        ...this.options.channel !== undefined ? { channel: this.options.channel } : {},
        ...this.options.headless !== undefined ? { headless: this.options.headless } : {},
      })
      launched = browser
      this.browser = browser
      this.context = await browser.newContext({
        proxy: { server: `http://127.0.0.1:${proxy.port}` },
        viewport: { width: 1280, height: 800 },
      })
      // Browser kernel death must never wedge the plugin: mark for restart.
      const ownedProxy = proxy
      browser.on('disconnected', () => { this.resetAfterDisconnect(browser, ownedProxy) })
      await this.context.newPage()
      this.activeTabIndex = 0
    } catch (error) {
      await launched?.close().catch(() => undefined)
      await proxy?.close().catch(() => undefined)
      this.browser = null
      this.context = null
      this.panePage = null
      this.proxy = null
      this.launchQueue = null
      throw error
    }
  }

  /**
   * Embedded-pane mode (B3-11): ask the shell to open the in-window pane,
   * route its session through our SSRF proxy, then adopt EXACTLY the pane's
   * target over CDP. The CDP endpoint exposes every view in the shell — the
   * pane URL from the bridge is the claim key, and nothing else is touched.
   * @param bridge - the shell's loopback bridge.
   * @param proxy - the already-started SSRF proxy.
   */
  private async attachPane(bridge: PaneBridge, proxy: SsrfProxy): Promise<void> {
    const { cdpPort, paneUrl } = await paneEnsure(bridge)
    await paneSetProxy(bridge, `http=127.0.0.1:${String(proxy.port)};https=127.0.0.1:${String(proxy.port)}`)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(cdpPort)}`)
      .catch((error: unknown) => { throw cdpConnectFailure(cdpPort, error) })
    // The shell awaits the pane's navigation before replying, so the URL is
    // committed on its side; CDP page state can still trail it by a tick, so
    // one short retry covers the gap instead of failing the whole tool call.
    let pane = findPaneByUrl(browser, paneUrl)
    if (pane === undefined) {
      await new Promise((resolve) => { setTimeout(resolve, 250) })
      pane = findPaneByUrl(browser, paneUrl)
    }
    if (pane === undefined) {
      // Disconnect only — connectOverCDP's close() never kills the shell.
      await browser.close().catch(() => undefined)
      throw new Error('embedded browser pane not found over CDP')
    }
    this.browser = browser
    this.panePage = pane
    this.context = pane.context()
    browser.on('disconnected', () => { this.resetAfterDisconnect(browser, proxy) })
  }

  /**
   * Shared post-disconnect reset (kernel death or CDP drop): next call relaunches.
   * @param browser - the connection this listener belongs to.
   * @param proxy - that connection's SSRF proxy.
   */
  private resetAfterDisconnect(browser: Browser, proxy: SsrfProxy): void {
    // Identity guard: a stale connection's late 'disconnected' must never
    // clobber live state. The ✕ → rebuild path races exactly that way — the
    // old browser closes while the new launch is in flight, and an unguarded
    // handler would null `launchQueue`/`panePage` out from under it (two
    // concurrent launches, an orphaned proxy, or "browser not launched"
    // thrown between ensure() and activePage()).
    if (this.browser !== browser) {
      void proxy.close().catch(() => undefined)
      return
    }
    this.browser = null
    this.context = null
    this.panePage = null
    void proxy.close().catch(() => undefined)
    this.proxy = null
    this.launchQueue = null
  }

  /**
   * The active page (guaranteed after ensure()), with the per-operation
   * ceiling applied.
   *
   * Every page hands out through here, so the ceiling cannot be missed by a
   * page that arrived along some path that skipped setup. Setting it again on
   * an already-configured page costs nothing.
   * @returns the page tools should act on.
   */
  private activePage(): Page {
    const page = this.pickActivePage()
    page.setDefaultTimeout(OPERATION_TIMEOUT_MS)
    return page
  }

  /** Which page is active, before any configuration is applied. */
  private pickActivePage(): Page {
    // Pane mode drives exactly one adopted page; every other CDP target in
    // the shell (official UI, chrome bar) is out of bounds by construction.
    if (this.panePage !== null) {
      if (this.panePage.isClosed()) throw new Error('the embedded browser pane was closed — call the tool again to reopen it')
      return this.panePage
    }
    const context = this.context
    if (context === null) throw new Error('browser not launched')
    const pages = context.pages()
    const page = pages[this.activeTabIndex]
    if (page === undefined || page.isClosed()) {
      // Fall back to the first live page; the caller sees navigation state.
      this.activeTabIndex = 0
      const first = context.pages()[0]
      // Every tab closed by hand without a 'disconnected' yet: say so, rather
      // than letting a non-null assertion surface as a raw TypeError.
      if (first === undefined) throw new Error('the browser has no open page — call the tool again to reopen it')
      return first
    }
    return page
  }

  /**
   * Resolve a model locator into the playwright locator of every match.
   * Priority: CSS selector → ARIA role+name → snapshot ref (via the cached
   * table, itself resolved to role+name) → visible text. All resolution is
   * in-process. Callers go through {@link resolveTarget}, which narrows the
   * matches to one visible element.
   * @param loc - the model-facing locator.
   * @param page - the target page.
   * @returns the playwright locator (possibly matching several elements).
   */
  private resolveLocator(loc: ElementLocator, page: Page): import('playwright-core').Locator {
    if (loc.selector !== undefined && loc.selector !== '') return page.locator(loc.selector)
    if (loc.role !== undefined && loc.role !== '') {
      return page.getByRole(loc.role as never, loc.name !== undefined && loc.name !== '' ? { name: loc.name } : {})
    }
    if (loc.ref !== undefined && loc.ref !== '') {
      if (this.refPage !== page || this.refUrl !== page.url()) throw new Error('snapshot references belong to another page; take a new browser_snapshot')
      const entry = this.refTable.get(loc.ref)
      if (entry !== undefined && entry.role !== '') {
        return page.getByRole(entry.role as never, { name: entry.name, exact: true })
      }
    }
    if (loc.text !== undefined && loc.text !== '') return page.getByText(loc.text, { exact: false })
    throw new Error('locator: none of ref/text/selector/role resolved to an element — snapshot the page first')
  }

  /**
   * The one element an interaction acts on: the first VISIBLE match.
   *
   * Three failures of the old "first match, wait until actionable" rule, all
   * from one site that renders every card of every page into the DOM and
   * lets pagination toggle visibility (2026-09-11 manual test round 3):
   * text "查看详情" on page 2 resolved to a hidden page-1 card and waited the
   * full timeout for it to become visible; a CSS selector matching 213 cards
   * threw a strict-mode violation listing them; and a name that matched
   * nothing at all also sat for the full timeout. Now: nothing attached
   * within a short window → "no element matches"; matches but none visible →
   * says so with the count; otherwise the first visible one, in document
   * order — what "click the first card" means.
   * @param loc - the model-facing locator.
   * @param page - the target page.
   * @returns a locator pinned to exactly one visible element.
   */
  private async resolveTarget(loc: ElementLocator, page: Page): Promise<import('playwright-core').Locator> {
    const matches = this.resolveLocator(loc, page)
    const target = await firstVisibleMatch(matches, describeLocator(loc))
    if (loc.ref !== undefined && !loc.selector && !loc.role && await matches.filter({ visible: true }).count() !== 1) {
      throw new Error('snapshot reference matches multiple visible elements; use a unique selector or text instead')
    }
    return target
  }

  async click(loc: ElementLocator, button: 'left' | 'right'): Promise<void> {
    await this.ensure()
    const page = this.activePage()
    await (await this.resolveTarget(loc, page)).click({ button })
  }

  async inspectClickTarget(loc: ElementLocator): Promise<ClickTargetFacts | null> {
    await this.ensure()
    const page = this.activePage()
    try {
      return await (await this.resolveTarget(loc, page)).evaluate((node): ClickTargetFacts => {
        // This callback runs inside the page, but it is type-checked here in
        // the Node build, which has no DOM lib — hence the structural shape
        // instead of HTMLElement.
        const element = node as unknown as {
          tagName: string
          innerText?: string
          getAttribute: (name: string) => string | null
          closest: (selector: string) => unknown
        }
        const attribute = (name: string): string | null => element.getAttribute(name)?.toLowerCase() ?? null
        const label = [
          element.innerText ?? '',
          attribute('aria-label') ?? '',
          attribute('value') ?? '',
          attribute('title') ?? '',
          attribute('name') ?? '',
        ].join(' ').toLowerCase()
        return {
          tag: element.tagName.toLowerCase(),
          type: attribute('type'),
          role: attribute('role'),
          label,
          inForm: element.closest('form') !== null,
        }
      })
    } catch {
      // Element gone, detached, or not readable: the caller treats null as
      // "unknown", which fails closed into asking the user.
      return null
    }
  }

  async type(loc: ElementLocator, text: string, clearFirst: boolean, pressEnter: boolean): Promise<void> {
    await this.ensure()
    const page = this.activePage()
    const target = await this.resolveTarget(loc, page)
    const editable = await target.evaluate((node) => {
      const element = node as unknown as { tagName: string; type?: string; isContentEditable?: boolean }
      const tag = element.tagName.toLowerCase()
      return element.isContentEditable === true || tag === 'textarea'
        || (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'hidden', 'color', 'range', 'image'].includes(element.type ?? 'text'))
    })
    if (!editable) throw new Error('browser_type requires an editable input, textarea, or contenteditable element')
    if (clearFirst) {
      await target.fill(text)
    } else {
      await target.focus()
      await page.keyboard.type(text, { delay: 8 })
    }
    if (pressEnter) await page.keyboard.press('Enter')
  }

  async scroll(direction: 'up' | 'down' | 'top' | 'bottom', amount: number, loc: ElementLocator | null): Promise<void> {
    await this.ensure()
    const page = this.activePage()
    if (loc !== null && (loc.ref !== undefined || loc.text !== undefined || loc.selector !== undefined || loc.role !== undefined)) {
      await (await this.resolveTarget(loc, page)).scrollIntoViewIfNeeded()
      return
    }
    if (direction === 'top' || direction === 'bottom') {
      await page.evaluate(`window.scrollTo(0, ${direction === 'top' ? '0' : 'document.body.scrollHeight'})`)
      return
    }
    const delta = direction === 'down' ? amount : -amount
    await page.evaluate(`window.scrollBy(0, ${delta})`)
  }

  async keyboard(keys: string): Promise<void> {
    await this.ensure()
    await this.activePage().keyboard.press(keys)
  }

  async hover(loc: ElementLocator): Promise<void> {
    await this.ensure()
    await (await this.resolveTarget(loc, this.activePage())).hover()
  }

  async submit(loc: ElementLocator): Promise<void> {
    await this.ensure()
    await (await this.resolveTarget(loc, this.activePage())).click()
  }

  async navigate(url: string, timeoutMs: number): Promise<{ finalUrl: string; title: string }> {
    await this.ensure()
    // The gate: hygiene + resolve + check BEFORE the browser moves.
    const verdict = await validateNavigationTarget(url, this.options.lookup)
    if (!verdict.ok) {
      throw new Error(`navigation blocked: ${verdict.detail}`)
    }
    const page = this.activePage()
    // A new address opens the panel (#22); a bridge hiccup here must not
    // fail the navigation the user asked for.
    if (this.options.paneBridge !== undefined) await paneReveal(this.options.paneBridge).catch(() => undefined)
    this.refTable.clear()
    this.refPage = null
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
    const finalUrl = page.url()
    // Post-navigation re-check of the settled URL (redirect hops were each
    // re-validated by the proxy; this is the last-hop confirmation).
    const settled = await validateNavigationTarget(finalUrl, this.options.lookup)
    if (!settled.ok) {
      throw new Error(`navigation landed on a blocked target: ${settled.detail}`)
    }
    return { finalUrl, title: await page.title() }
  }

  async snapshot(maxDepth: number): Promise<{ title: string; url: string; nodes: A11yNode[]; text: string }> {
    await this.ensure()
    const page = this.activePage()
    // The shell's own empty-state page is never what the caller wants to
    // read (DS 验房 2026-09-06: after a long wait the pane had been rebuilt
    // and snapshot quietly returned the placeholder copy).
    if (isPanePlaceholder(page.url(), await page.title().catch(() => ''))) {
      throw new Error('the embedded browser pane shows its empty placeholder page (it was reopened or rebuilt); call browser_navigate again before reading it')
    }
    // A dead page (failed commit or renderer crash) reads as an empty tree;
    // say the page is gone instead of reporting an empty success (B6-4).
    if (isChromiumErrorPage(page.url())) {
      throw new Error('the browser page failed to load (Chromium error page); call browser_navigate again to reload it')
    }
    const nodes = cdpTreeToNodes(await cdpAccessibilityTree(page), maxDepth)
    // Cache the ref → (role, name) table so interaction tools can resolve
    // snapshot refs into ARIA locators without re-reading the tree.
    this.refTable.clear()
    collectRefs(nodes, this.refTable)
    this.refPage = page
    this.refUrl = page.url()
    return { title: await page.title(), url: page.url(), nodes, text: await pageText(page) }
  }

  async screenshot(fullPage: boolean): Promise<string> {
    await this.ensure()
    const page = this.activePage()
    if (isPanePlaceholder(page.url(), await page.title().catch(() => ''))) {
      throw new Error('the embedded browser pane shows its empty placeholder page (it was reopened or rebuilt); call browser_navigate again before taking a screenshot')
    }
    if (isChromiumErrorPage(page.url())) {
      throw new Error('the browser page failed to load (Chromium error page); call browser_navigate again before taking a screenshot')
    }
    let buffer: Buffer
    try {
      buffer = fullPage ? await this.boundedFullPageShot(page) : await page.screenshot({ type: 'png' })
    } catch (error) {
      // A hidden or not-yet-composited pane has no bitmap; say so instead of
      // surfacing Playwright's "0 width" (DS 验房 2026-09-06).
      const message = error instanceof Error ? error.message : String(error)
      if (/0 width|0 height/u.test(message)) {
        // The panel is collapsed (the user closed it): a hidden view has no
        // bitmap. The panel is the user's to open — say so instead of
        // popping it (2026-09-11 manual test #22).
        throw new Error('the embedded browser pane is hidden (the user collapsed it), so there is nothing to capture; ask the user to open the browser panel (the globe button), then retry — navigating to a new address also opens it')
      }
      throw error
    }
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    mkdirSync(this.options.screenshotDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(this.options.screenshotDir, `browser-${stamp}-${randomUUID()}.png`)
    writeFileSync(file, buffer, { flag: 'wx', mode: 0o600 })
    return file
  }

  /**
   * Full-page screenshot with a height ceiling.
   *
   * An infinite-scroll page can report a document tens of thousands of pixels
   * tall; `fullPage: true` then asks the compositor for one bitmap that size
   * and writes the whole thing to disk. Past the ceiling, capture the top of
   * the page instead — a truncated screenshot is far more useful than an
   * allocation failure.
   * @param page - the active page.
   * @returns PNG bytes.
   */
  private async boundedFullPageShot(page: Page): Promise<Buffer> {
    const size = await page.evaluate(() => {
      // Typed structurally: this file is checked in the Node build, which has
      // no DOM lib, even though the callback runs in the page.
      const scope = globalThis as unknown as {
        document: { documentElement: { scrollWidth: number; scrollHeight: number } }
      }
      const root = scope.document.documentElement
      return { width: root.scrollWidth, height: root.scrollHeight }
    }).catch(() => null)
    if (size === null || size.height <= SCREENSHOT_MAX_HEIGHT) {
      return page.screenshot({ fullPage: true, type: 'png' })
    }
    return page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: size.width, height: SCREENSHOT_MAX_HEIGHT },
    })
  }

  async wait(condition: 'load' | 'network-idle' | 'timeout', selector: string | null, ms: number): Promise<void> {
    await this.ensure()
    const page = this.activePage()
    switch (condition) {
      case 'load':
        await page.waitForLoadState('load', { timeout: ms })
        return
      case 'network-idle':
        await page.waitForLoadState('networkidle', { timeout: ms })
        return
      case 'timeout':
        if (selector !== null && selector !== '') {
          await page.waitForSelector(selector, { timeout: ms })
        } else {
          await page.waitForTimeout(ms)
        }
    }
  }

  async tabs(action: 'list' | 'new' | 'switch' | 'close', index?: number): Promise<TabInfo[]> {
    await this.ensure()
    // Pane mode is single-tab by design: the pane is one view in the shell
    // window, and its CDP siblings are the app's own UI — never tab material.
    // A close that cannot happen says so instead of returning the list as if
    // it had (2026-09-11 manual test round 3).
    if (this.panePage !== null) {
      if (action === 'new') throw new Error('the embedded browser panel is single-tab; navigate in place instead')
      if (action === 'close') throw new Error('the embedded browser panel is single-tab and stays open; the user closes it with the panel\'s ✕')
      const page = this.activePage()
      return [{ index: 0, url: page.url(), title: await page.title().catch(() => '') }]
    }
    const context = this.context
    if (context === null) throw new Error('browser not launched')
    // 'switch' 不在下面出现是刻意的：它在这个 facade 上无事可做——下标住在
    // 调用方的参数里，切换由 tools 层调 selectTab() 完成。
    if (action === 'new') {
      this.refTable.clear()
      await context.newPage()
      this.activeTabIndex = context.pages().length - 1
    } else if (action === 'close') {
      const pages = context.pages()
      const which = index ?? this.activeTabIndex
      const target = pages[which]
      if (target === undefined) throw new Error(`no tab at index ${String(which)} (${String(pages.length)} open)`)
      if (pages.length === 1) throw new Error('the last tab stays open; navigate in place instead')
      this.refTable.clear()
      await target.close()
      this.activeTabIndex = Math.min(this.activeTabIndex, pages.length - 2)
    }
    return this.tabList()
  }

  /** Switch the active tab by index (bounded). */
  async selectTab(index: number): Promise<void> {
    await this.ensure()
    if (this.panePage !== null) {
      if (index !== 0) throw new Error('the embedded browser panel is single-tab')
      return
    }
    const pages = this.context?.pages() ?? []
    if (index < 0 || index >= pages.length) throw new Error(`no tab at index ${index}`)
    this.refTable.clear()
    this.activeTabIndex = index
  }

  private async tabList(): Promise<TabInfo[]> {
    const context = this.context
    if (context === null) return []
    const pages = context.pages()
    return Promise.all(pages.map(async (page, index) => ({
      index,
      url: page.url(),
      title: await page.title().catch(() => ''),
    })))
  }

  async currentUrl(): Promise<string> {
    await this.ensure()
    return this.activePage().url()
  }

  async close(): Promise<void> {
    this.closed = true
    await this.launchQueue?.catch(() => undefined)
    this.refTable.clear()
    this.refPage = null
    // Pane mode: collapse the pane in the shell, then just disconnect —
    // connectOverCDP's close() drops the session without killing the shell.
    if (this.panePage !== null && this.options.paneBridge !== undefined) {
      await paneHide(this.options.paneBridge).catch(() => undefined)
    }
    this.panePage = null
    if (this.browser !== null) {
      await this.browser.close().catch(() => undefined)
      this.browser = null
      this.context = null
    }
    if (this.proxy !== null) {
      await this.proxy.close().catch(() => undefined)
      this.proxy = null
    }
    this.launchQueue = null
  }
}
