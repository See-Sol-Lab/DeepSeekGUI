/**
 * Browser plugin pure-function tests: CDP a11y tree projection (ref scheme,
 * ignored-node dropping, depth cap) and the model-facing output formatters.
 * Browser launching itself is covered by the dev/packaged smoke e2e (needs a
 * real Edge); everything deterministic is pinned here.
 * @module @see-sol-lab/deepseekgui-browser/tests/browser-tools
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  A11Y_MAX_NODES,
  cdpConnectFailure,
  cdpTreeToNodes,
  collectRefs,
  describeLocator,
  firstVisibleMatch,
  LOCATOR_ATTACH_TIMEOUT_MS,
  OPERATION_TIMEOUT_MS,
  SCREENSHOT_MAX_HEIGHT,
} from '../../browser-plugin/src/browser.ts'
import {
  boundedNumber,
  formatNavigate,
  NAVIGATE_BUDGET_MS,
  NAVIGATE_TIMEOUT_MAX_MS,
  STANDARD_BUDGET_MS,
  WAIT_BUDGET_MS,
  WAIT_MAX_MS,
  callerSight,
  formatScreenshot,
  formatSnapshot,
  formatTabs,
  screenshotNote,
} from '../../browser-plugin/src/tools.ts'

/** CDP 扁平列表 fixture：root → heading / button(带 text 子) / textbox。 */
const cdpFixture = [
  { nodeId: 'n1', role: { value: 'root' }, childIds: ['n2', 'n3', 'n5'] },
  { nodeId: 'n2', parentId: 'n1', role: { value: 'heading' }, name: { value: 'Title' } },
  { nodeId: 'n3', parentId: 'n1', role: { value: 'button' }, name: { value: 'Submit' }, childIds: ['n4'] },
  { nodeId: 'n4', parentId: 'n3', role: { value: 'text' }, name: { value: 'Submit' } },
  { nodeId: 'n5', parentId: 'n1', role: { value: 'textbox' }, name: { value: 'Search' }, value: { value: 'hello' } },
  // 孤儿节点（父不存在）与 ignored 节点不进入结果。
  { nodeId: 'n6', parentId: 'missing', role: { value: 'orphan' } },
  { nodeId: 'n7', parentId: 'n1', ignored: true, role: { value: 'presentational' } },
]

describe('cdpTreeToNodes（CDP a11y 树投影）', () => {
  it('生成稳定 ref（a<路径>），name/value 原样透传，ignored/孤儿丢弃', () => {
    const out = cdpTreeToNodes(cdpFixture, 10)
    expect(out).toEqual([
      {
        ref: 'a0',
        role: 'root',
        name: '',
        value: '',
        children: [
          { ref: 'a0.0', role: 'heading', name: 'Title', value: '', children: [] },
          {
            ref: 'a0.1',
            role: 'button',
            name: 'Submit',
            value: '',
            children: [{ ref: 'a0.1.0', role: 'text', name: 'Submit', value: '', children: [] }],
          },
          { ref: 'a0.2', role: 'textbox', name: 'Search', value: 'hello', children: [] },
        ],
      },
    ])
  })

  it('max_depth 截断子树（深度从 0 计：1 = 根保留、子节点截断）', () => {
    const out = cdpTreeToNodes(cdpFixture, 1)
    expect(out).toHaveLength(1)
    expect(out[0]!.children).toHaveLength(0)
    expect(cdpTreeToNodes(cdpFixture, 0)).toEqual([])
  })

  it('空树返回空数组', () => {
    expect(cdpTreeToNodes([], 5)).toEqual([])
  })
})

describe('collectRefs（ref → role/name 定位表）', () => {
  it('递归收集全部节点的 ref 映射', () => {
    const tree = [
      {
        ref: 'a0',
        role: 'root',
        name: '',
        value: '',
        children: [
          { ref: 'a0.0', role: 'button', name: 'Submit', value: '', children: [] },
          {
            ref: 'a0.1',
            role: 'textbox',
            name: 'Search',
            value: 'q',
            children: [{ ref: 'a0.1.0', role: 'text', name: 'hint', value: '', children: [] }],
          },
        ],
      },
    ]
    const table = new Map<string, { role: string; name: string }>()
    collectRefs(tree, table)
    expect([...table.entries()]).toEqual([
      ['a0', { role: 'root', name: '' }],
      ['a0.0', { role: 'button', name: 'Submit' }],
      ['a0.1', { role: 'textbox', name: 'Search' }],
      ['a0.1.0', { role: 'text', name: 'hint' }],
    ])
  })
})

describe('模型可见输出格式（format*）', () => {
  it('navigate 成功/失败形态', () => {
    expect(formatNavigate({ status: 'ok', final_url: 'https://a.test/', title: 'A' }))
      .toBe('Navigated to https://a.test/ — A')
    expect(formatNavigate({ status: 'error', final_url: '', title: '', reason: 'navigation blocked: ...' }))
      .toContain('Navigation error')
  })

  it('snapshot 含页面头、树与可见文本', () => {
    const text = formatSnapshot({
      page_title: 'P',
      url: 'https://a.test/',
      nodes: [{ ref: 'a0.0', role: 'heading', name: 'Hi', value: '', children: [] }],
      text: 'body text',
    })
    expect(text).toContain('Page: P')
    expect(text).toContain('[a0.0] heading Hi')
    expect(text).toContain('Visible text:\nbody text')
  })

  it('screenshot 带本地路径与非视觉模型提示（住户约束）', () => {
    const text = formatScreenshot({ image_path: 'C:/x/browser-1.png', note: 'n' })
    expect(text).toContain('C:/x/browser-1.png')
    expect(text).toContain('n')
  })

  it('截图提示按发起调用的模型定：无视觉 → 明说读不到、别重试（#24）', () => {
    expect(screenshotNote('blind')).toContain('does NOT accept images')
    expect(screenshotNote('blind')).toContain('retrying will not change that')
    expect(screenshotNote('blind')).toContain('browser_snapshot')
    expect(screenshotNote('sighted')).toContain('you can read it')
    expect(screenshotNote('unknown')).toContain('If the current model cannot see images')
  })

  it('tabs 列出序号/标题/URL', () => {
    expect(formatTabs({ tabs: [{ index: 0, url: 'https://a.test/', title: 'A' }] }))
      .toBe('[0] A — https://a.test/')
    expect(formatTabs({ tabs: [] })).toBe('no tabs')
  })
})

describe('cdpTreeToNodes：ignored 节点透明（第三轮人工测试：真实站点快照只剩 RootWebArea）', () => {
  it('把 ignored 包装层的子节点提到父节点下，不占深度；无子的 ignored 节点照样消失', () => {
    // root → (ignored div) → (ignored div) → link；再加一个真实 button。
    const raw = [
      { nodeId: 'r', role: { value: 'RootWebArea' }, childIds: ['w1', 'b'] },
      { nodeId: 'w1', parentId: 'r', ignored: true, role: { value: 'generic' }, childIds: ['w2'] },
      { nodeId: 'w2', parentId: 'w1', ignored: true, role: { value: 'generic' }, childIds: ['l', 'x'] },
      { nodeId: 'l', parentId: 'w2', role: { value: 'link' }, name: { value: '查看详情' } },
      { nodeId: 'x', parentId: 'w2', ignored: true, role: { value: 'none' } },
      { nodeId: 'b', parentId: 'r', role: { value: 'button' }, name: { value: 'Go' } },
    ]
    // maxDepth 2 = root + one level; the two ignored wrappers must not count.
    const out = cdpTreeToNodes(raw, 2)
    expect(out).toEqual([{
      ref: 'a0',
      role: 'RootWebArea',
      name: '',
      value: '',
      children: [
        { ref: 'a0.0', role: 'link', name: '查看详情', value: '', children: [] },
        { ref: 'a0.1', role: 'button', name: 'Go', value: '', children: [] },
      ],
    }])
    // The link sat two ignored levels down and was still admitted at depth 2.
    const refs = new Map<string, { role: string; name: string }>()
    collectRefs(out, refs)
    expect(refs.get('a0.0')).toEqual({ role: 'link', name: '查看详情' })
  })

  it('ignored 的根本身也透明', () => {
    const raw = [
      { nodeId: 'r', ignored: true, role: { value: 'generic' }, childIds: ['h'] },
      { nodeId: 'h', parentId: 'r', role: { value: 'heading' }, name: { value: 'Hi' } },
    ]
    expect(cdpTreeToNodes(raw, 3)).toEqual([{ ref: 'a0', role: 'heading', name: 'Hi', value: '', children: [] }])
  })
})

describe('firstVisibleMatch（第三轮人工测试：可见优先、快失败）', () => {
  type Fake = { id: string }
  const matchSet = (all: Fake[], visible: Fake[], attached = true) => ({
    first: () => ({
      ...(all[0] ?? { id: 'none' }),
      waitFor: async () => { if (!attached) throw new Error('Timeout') },
    }),
    filter: (options: { visible: boolean }) => ({
      count: async () => (options.visible ? visible : all).length,
      first: () => (options.visible ? visible : all)[0] as Fake,
    }),
    count: async () => all.length,
  })

  it('取第一个可见匹配，隐藏的重复卡片不算', async () => {
    const hidden = { id: 'page-1-card' }
    const shown = { id: 'page-2-card' }
    expect(await firstVisibleMatch(matchSet([hidden, shown], [shown]), 'text "查看详情"')).toBe(shown)
  })

  it('什么都没匹配到 → 按 attach 超时快速失败，报错指向 snapshot', async () => {
    await expect(firstVisibleMatch(matchSet([], [], false), 'role link named "DeepSeekGUI"', 5))
      .rejects.toThrow('no element matches role link named "DeepSeekGUI" (waited 5ms)')
  })

  it('匹配到了但全不可见 → 立即报错并给出数量与原因，不等满超时', async () => {
    const hidden = Array.from({ length: 213 }, (_, index) => ({ id: `card-${String(index)}` }))
    await expect(firstVisibleMatch(matchSet(hidden, []), 'selector ".project-detail-button"'))
      .rejects.toThrow('213 element(s) match selector ".project-detail-button" but none is visible')
  })

  it('默认 attach 窗口远短于操作超时', () => {
    expect(LOCATOR_ATTACH_TIMEOUT_MS).toBeLessThan(OPERATION_TIMEOUT_MS)
  })
})

describe('describeLocator', () => {
  it('按解析优先级描述定位器', () => {
    expect(describeLocator({ selector: '.a', text: 'x' })).toBe('selector ".a"')
    expect(describeLocator({ role: 'link', name: 'Go' })).toBe('role link named "Go"')
    expect(describeLocator({ role: 'link' })).toBe('role link')
    expect(describeLocator({ ref: 'a0.1' })).toBe('ref a0.1')
    expect(describeLocator({ text: '查看详情' })).toBe('text "查看详情"')
    expect(describeLocator({})).toBe('the locator')
  })
})

describe('callerSight（#24：从本步请求头 + 目录读发起模型的视觉能力）', () => {
  const agentWith = (config: { provider: string; model: string } | undefined) =>
    ({ session: { requestHeader: () => (config === undefined ? undefined : { config }) } }) as never
  const llmWith = (modalities: string[] | undefined) => ({
    resolveModelInfo: vi.fn(async () => ({ name: 'm', ...(modalities === undefined ? {} : { inputModalities: modalities }) })),
  })

  it('有 image 模态 → sighted；只有 text → blind；目录未声明 → unknown', async () => {
    for (const [modalities, expected] of [[['text', 'image'], 'sighted'], [['text'], 'blind'], [undefined, 'unknown']] as const) {
      const ctx = new Context()
      ctx.provide('llm', llmWith(modalities === undefined ? undefined : [...modalities]) as never)
      expect(await callerSight(ctx, agentWith({ provider: 'deepseek', model: 'x' }))).toBe(expected)
    }
  })

  it('没有 agent / 没有请求头 / 没有 llm / 查询失败 → unknown（不猜）', async () => {
    const ctx = new Context()
    expect(await callerSight(ctx, undefined)).toBe('unknown')
    ctx.provide('llm', { resolveModelInfo: vi.fn(async () => { throw new Error('nope') }) } as never)
    expect(await callerSight(ctx, agentWith(undefined))).toBe('unknown')
    expect(await callerSight(ctx, agentWith({ provider: 'deepseek', model: 'x' }))).toBe('unknown')
  })
})

describe('模型给的数字必须有边界（Infinity 和 1e9 是真的会出现的）', () => {
  it('缺省 / 非数字 / 非有限值 → 用默认值', () => {
    expect(boundedNumber(undefined, 5, 1, 20)).toBe(5)
    expect(boundedNumber('7', 5, 1, 20)).toBe(5)
    expect(boundedNumber(Number.NaN, 5, 1, 20)).toBe(5)
    expect(boundedNumber(Number.POSITIVE_INFINITY, 5, 1, 20)).toBe(5)
    expect(boundedNumber(Number.NEGATIVE_INFINITY, 5, 1, 20)).toBe(5)
  })

  it('超范围 → 收进边界，而不是拒绝调用', () => {
    expect(boundedNumber(1e9, 5, 1, 20)).toBe(20)
    expect(boundedNumber(-4, 5, 1, 20)).toBe(1)
  })

  it('正常值原样通过，小数取整', () => {
    expect(boundedNumber(8, 5, 1, 20)).toBe(8)
    expect(boundedNumber(8.9, 5, 1, 20)).toBe(8)
  })
})

describe('无障碍树的节点总数要封顶（深度封顶挡不住宽度）', () => {
  it('同一层的海量兄弟节点被截断在上限内', () => {
    // 一个 root 带 10000 个同级子节点：深度只有 1，深度上限完全不起作用。
    const wide = [
      { nodeId: 'root', role: { value: 'root' }, childIds: Array.from({ length: 10_000 }, (_, i) => `n${String(i)}`) },
      ...Array.from({ length: 10_000 }, (_, i) => ({
        nodeId: `n${String(i)}`, parentId: 'root', role: { value: 'listitem' }, name: { value: `item ${String(i)}` },
      })),
    ]
    const out = cdpTreeToNodes(wide, 10)
    const count = (nodes: readonly { children: readonly unknown[] }[]): number =>
      nodes.reduce((sum, node) => sum + 1 + count(node.children as readonly { children: readonly unknown[] }[]), 0)
    expect(count(out)).toBeLessThanOrEqual(A11Y_MAX_NODES)
    expect(count(out)).toBeGreaterThan(0)
  })

  it('小树不受影响（上限只是兜底）', () => {
    const out = cdpTreeToNodes(cdpFixture, 10)
    expect(out).toHaveLength(1)
  })

  it('上限本身是个正数，截图高度上限同理', () => {
    expect(A11Y_MAX_NODES).toBeGreaterThan(0)
    expect(SCREENSHOT_MAX_HEIGHT).toBeGreaterThan(0)
  })
})

describe('调试端口连不上时要说人话', () => {
  it('带上端口号、原始原因，以及重启会换一个端口这句关键提示', () => {
    const error = cdpConnectFailure(31337, new Error('connect ECONNREFUSED 127.0.0.1:31337'))
    expect(error.message).toContain('31337')
    expect(error.message).toContain('ECONNREFUSED')
    expect(error.message).toContain('Restarting')
  })

  it('非 Error 的原因也能安全展示', () => {
    expect(cdpConnectFailure(1234, 'boom').message).toContain('boom')
  })
})

describe('工具放弃等待时，页面必须已经停手', () => {
  // 一旦工具层判定超时，模型看到的就是"失败"。页面若还在动作，模型被告知的
  // 事和实际发生的事就对不上了——点提交按钮时这是最坏的一种错。
  it('单次页面操作的上限低于最小的工具预算', () => {
    expect(OPERATION_TIMEOUT_MS).toBeLessThan(STANDARD_BUDGET_MS)
  })

  it('给模型的导航超时上限留在导航预算之内', () => {
    expect(NAVIGATE_TIMEOUT_MAX_MS).toBeLessThan(NAVIGATE_BUDGET_MS)
  })

  it('给模型的等待上限留在等待预算之内', () => {
    expect(WAIT_MAX_MS).toBeLessThan(WAIT_BUDGET_MS)
  })

  it('模型传超大值时会被压回上限，而不是超出预算', () => {
    expect(boundedNumber(1e9, 30_000, 1_000, NAVIGATE_TIMEOUT_MAX_MS)).toBe(NAVIGATE_TIMEOUT_MAX_MS)
    expect(boundedNumber(1e9, 2_000, 0, WAIT_MAX_MS)).toBe(WAIT_MAX_MS)
  })

  it('每个预算都是正数（防止有人把某个值清零）', () => {
    for (const budget of [NAVIGATE_BUDGET_MS, WAIT_BUDGET_MS, STANDARD_BUDGET_MS, OPERATION_TIMEOUT_MS]) {
      expect(budget).toBeGreaterThan(0)
    }
  })
})
