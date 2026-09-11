/**
 * Compatibility View（打包态）：切到官方原生界面之后 Harness 必须仍是「运行中」。
 *
 * 2026-09-11 第一轮人工测试 #1：0.1.5 起 compat 模式一条产品 overlay 都不带，
 * 而 page-load 阶段等的那个 settle 标记是皮肤插件打的——于是每次切换都在
 * 30s 后判失败、回退 Workbench，用户看到官方页面配着"启动失败"胶囊。这条
 * 用例走用户真正够得着的路径（汉堡菜单 → 官方原生界面 → 确认），然后盯胶囊。
 * @module @see-sol-lab/deepseekgui/tests-e2e/compatibility-view
 */
import { type ElectronApplication } from 'playwright-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isolationRoot as sharedIsolationRoot, launchPackaged as launch, packagedExists, stubDialogs } from './fixtures.ts'
import {
  CHROME_URL_PREFIX,
  COMP_URL_PREFIX,
  clickChromeButton,
  ensureCleanStage,
  evalInView,
  shutdownApp,
  waitForChromeElement,
  waitForCompMount,
} from './chrome-driver.ts'

const isolationRoot = (suffix: string): string => sharedIsolationRoot(`dsh-compat-${suffix}-`, '兼容视图')

/** 胶囊文字（Chrome view 的 #status-text）。 */
async function pillText(app: ElectronApplication): Promise<string> {
  try {
    return await evalInView<string>(app, CHROME_URL_PREFIX, 'document.getElementById("status-text")?.textContent ?? ""')
  } catch {
    return ''
  }
}

describe.runIf(packagedExists)('Compatibility View（打包态）', () => {
  let app: ElectronApplication | undefined

  beforeEach(async () => {
    await ensureCleanStage()
  })

  afterEach(async () => {
    if (app !== undefined) {
      await shutdownApp(app)
      app = undefined
    }
  })

  it('切到官方原生界面后 Harness 仍为运行中，菜单项翻成「返回 Workbench」（人工测试 #1）', async () => {
    const temp = isolationRoot('switch')
    const running = await launch(temp)
    app = running
    // 运行中切换会先问一次（与重启同杀伤力）；stub 默认回 0 = 继续。
    await stubDialogs(running)
    await expect.poll(() => pillText(running), { timeout: 60_000 }).toMatch(/运行中|Running/u)
    await clickChromeButton(running, 'hamburger')
    await waitForChromeElement(running, 'menu-compatibility')
    await clickChromeButton(running, 'menu-compatibility')
    // 切换 = 一次 restart（停止中 → 启动中 → 运行中）。两种形态加载的是同一个
    // 官方页面 URL，所以"页面已挂载"分不出新旧：必须先看到胶囊离开运行中，
    // 再等它回来——否则下面全在对着还没被替换掉的 Workbench 页面断言。
    await expect.poll(() => pillText(running), { timeout: 30_000 }).not.toMatch(/运行中|Running/u)
    // 重启走完：胶囊回到运行中——而不是 30s 后的"启动失败"（回退 Workbench
    // 也算失败，所以两种终态都等，再判是哪一种）。
    await expect.poll(() => pillText(running), { timeout: 120_000 }).toMatch(/运行中|Running|失败|failed/iu)
    expect(await pillText(running)).toMatch(/运行中|Running/u)
    await waitForCompMount(running, 120_000)
    // 菜单项现在指回 Workbench：这是 compat 模式生效的可见证据。
    const command = await evalInView<string>(
      running,
      CHROME_URL_PREFIX,
      'document.getElementById("menu-compatibility")?.dataset.command ?? ""',
    )
    expect(command).toBe('open-workbench')
    // 官方页面上没有我们的皮肤样式：overlay 一条都不带，皮肤插件也不在。
    const hasSkin = await evalInView<boolean>(
      running,
      COMP_URL_PREFIX,
      'document.getElementById("deepseekgui-skin") !== null',
    ).catch(() => false)
    expect(hasSkin).toBe(false)
  })
})
