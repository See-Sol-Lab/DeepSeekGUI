/**
 * 目录选择桥测试：真的起回环服务器，真的发请求。
 *
 * 这条桥能在用户屏幕上弹系统对话框，所以「谁能让它弹」就是它的全部安全
 * 面：凭证不对、路径不对、方法不对，都必须回同一个 404，不给探测者任何
 * 可区分的信号。对话框本身注入成假的，所以测试不会真弹窗。
 * @module @see-sol-lab/deepseekgui/tests/picker-bridge
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDirectoryPickerBridge, type DirectoryPickResult, type PickerBridge } from '../src/picker-bridge.ts'

let open: PickerBridge | null = null
afterEach(() => {
  open?.close()
  open = null
  vi.restoreAllMocks()
})

/** 起一座桥，对话框返回给定结果（或抛出）。 */
async function bridge(answer: DirectoryPickResult | Error) {
  const env: NodeJS.ProcessEnv = {}
  const pickDirectory = vi.fn(async (_title: string) => {
    if (answer instanceof Error) throw answer
    return answer
  })
  const started = await startDirectoryPickerBridge({ pickDirectory, zh: () => true, env })
  open = started
  return { started, env, pickDirectory }
}

/** 往桥上发一次请求。 */
async function call(started: PickerBridge, init: { token?: string; method?: string; path?: string } = {}) {
  const url = init.path === undefined ? started.endpoint : started.endpoint.replace('/pick', init.path)
  return fetch(url, {
    method: init.method ?? 'POST',
    headers: init.token === undefined ? {} : { 'x-deepseekgui-picker-token': init.token },
  })
}

describe('startDirectoryPickerBridge', () => {
  it('把端点与凭证写进给定环境，绑在回环上', async () => {
    const { started, env } = await bridge({ canceled: true, filePaths: [] })
    // DSH 子进程从环境继承它们，所以写入必须在 start 返回前完成。
    expect(env.DEEPSEEKGUI_PICKER_ENDPOINT).toBe(started.endpoint)
    expect(env.DEEPSEEKGUI_PICKER_TOKEN).toBe(started.token)
    expect(started.endpoint.startsWith('http://127.0.0.1:')).toBe(true)
  })

  it('凭证对时弹一次对话框并回选中的路径', async () => {
    const { started, pickDirectory } = await bridge({ canceled: false, filePaths: ['D:\\projects\\novel'] })
    const response = await call(started, { token: started.token })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: 'D:\\projects\\novel' })
    expect(pickDirectory).toHaveBeenCalledWith('选择工作区目录')
  })

  it('用户取消时回 null 而不是错误——取消不是故障', async () => {
    const { started } = await bridge({ canceled: true, filePaths: [] })
    const response = await call(started, { token: started.token })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: null })
  })

  it('对话框自身失败时回 500，绝不伪装成用户取消', async () => {
    // 静默回 null 会被官方读成「用户取消了」，那是把故障说成用户意图。
    const { started } = await bridge(new Error('COM worker died'))
    const response = await call(started, { token: started.token })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'COM worker died' })
  })

  it('凭证不对、路径不对、方法不对，都回同一个 404，且一次都不弹窗', async () => {
    const { started, pickDirectory } = await bridge({ canceled: false, filePaths: ['/x'] })
    const wrongToken = await call(started, { token: 'not-the-token' })
    const noToken = await call(started)
    const wrongPath = await call(started, { token: started.token, path: '/pickd' })
    const wrongMethod = await call(started, { token: started.token, method: 'GET' })
    for (const response of [wrongToken, noToken, wrongPath, wrongMethod]) {
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not found' })
    }
    // 关键：被拒的请求绝不能已经把对话框弹出来了。
    expect(pickDirectory).not.toHaveBeenCalled()
  })

  it('每次起桥都换一个凭证', async () => {
    const first = await bridge({ canceled: true, filePaths: [] })
    const firstToken = first.started.token
    first.started.close()
    const second = await bridge({ canceled: true, filePaths: [] })
    expect(second.started.token).not.toBe(firstToken)
  })

  it('英文界面用英文标题', async () => {
    const env: NodeJS.ProcessEnv = {}
    const pickDirectory = vi.fn(async (_title: string) => ({ canceled: true, filePaths: [] }))
    const started = await startDirectoryPickerBridge({ pickDirectory, zh: () => false, env })
    open = started
    await call(started, { token: started.token })
    expect(pickDirectory).toHaveBeenCalledWith('Select Workspace Directory')
  })
})
