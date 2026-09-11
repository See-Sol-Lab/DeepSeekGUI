/**
 * 目录选择桥：把官方 `host.pickDirectory` 落到宿主自己的系统对话框上（P8-D11）。
 *
 * 官方 native picker 在 Windows 上起的是 koffi 驱动的 COM 子进程，而它继承的
 * `process.execPath` 在打包态是 DeepSeekGUI.exe——worker 于是落在 Electron 的
 * Node realm 里 FATAL 崩溃，用户点「选择工作区」、选完目录，得到的是
 * "win32 folder dialog worker exited before reporting a result"，工作区根本
 * 选不了。我们的 picker 插件（overlay 里换掉官方那一行）不碰 koffi，改为请
 * 宿主弹一次系统对话框：弹对话框本来就是宿主的原生能力，而「怎么向用户要一个
 * 路径」本就是宿主的职责——官方只负责拿到路径之后做什么。
 *
 * 这条桥只对本机、且只对持有本次运行凭证的调用者开放：端口绑 127.0.0.1，
 * 凭证随进程一次性生成，仅经环境变量交给我们自己 spawn 的 DSH。没有凭证，
 * 本机其它进程借不到这个端点在用户屏幕上弹窗。
 *
 * 对话框本身经注入面传入，所以这个模块不依赖 Electron，可以在单测里起真实
 * 回环服务器验证凭证与路径策略。
 * @module @see-sol-lab/deepseekgui/picker-bridge
 */

import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'

/** 目录选择桥的路径；插件侧从环境变量拿到完整 URL，这里只是它的尾巴。 */
export const PICKER_BRIDGE_PATH = '/pick'

/** 系统对话框的返回形态（与 Electron 的 showOpenDialog 结果同形）。 */
export interface DirectoryPickResult {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

/** 桥要用的宿主能力；全部注入，模块自己不认识 Electron。 */
export interface PickerBridgeDeps {
  /**
   * 弹一次系统目录对话框。
   * @param title - 对话框标题（已按当前语言选好）。
   */
  readonly pickDirectory: (title: string) => Promise<DirectoryPickResult>
  /** 当前是否中文界面。 */
  readonly zh: () => boolean
  /**
   * 端点与凭证写进这里。必须在 spawn DSH 之前完成——子进程从环境继承它们。
   */
  readonly env: NodeJS.ProcessEnv
}

/** 起好的桥：地址、凭证与关停入口（关停只在测试里用得上）。 */
export interface PickerBridge {
  readonly endpoint: string
  readonly token: string
  readonly close: () => void
}

/**
 * 起目录选择桥，并把端点与凭证写进给定环境。
 * @param deps - 宿主能力与要写入的环境。
 * @returns 端点就绪（环境变量已写入）后 resolve。
 */
export async function startDirectoryPickerBridge(deps: PickerBridgeDeps): Promise<PickerBridge> {
  const token = randomUUID()
  const server: Server = createServer((request, response) => {
    const reply = (status: number, body: Record<string, unknown>): void => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    // 路径不对、凭证不对，一律回同一个 404：不给探测者任何可区分的信号。
    if (request.method !== 'POST' || request.url !== PICKER_BRIDGE_PATH) {
      reply(404, { error: 'not found' })
      return
    }
    if (request.headers['x-deepseekgui-picker-token'] !== token) {
      reply(404, { error: 'not found' })
      return
    }
    // 明确的标题有两个作用：用户看得懂自己在选什么（系统默认只写"打开"），
    // 而验收侧也才分得清这个对话框是 DeepSeekGUI 弹的、还是别处来的。
    void Promise.resolve().then(() => deps.pickDirectory(deps.zh() ? '选择工作区目录' : 'Select Workspace Directory')).then(
      (result) => {
        const chosen = result.canceled ? null : result.filePaths[0] ?? null
        // 诊断（S12）：桥这一端是链路上唯一知道"系统对话框到底返回了什么"
        // 的地方。工作区建不起来时，先分清是这里就没拿到路径，还是拿到了
        // 而官方那边没接。
        console.error(`[deepseekgui] picker bridge: ${result.canceled ? 'cancelled' : `picked ${String(result.filePaths.length)} path(s)`}`)
        reply(200, { path: chosen })
      },
      (error: unknown) => {
        // 对话框自身失败必须说出来：静默回 null 会被官方读成"用户取消了"，
        // 那是把故障伪装成用户意图，和 D12 那类静默失败同形。
        reply(500, { error: String(error instanceof Error ? error.message : error) })
      },
    ).catch((error: unknown) => { console.error('[deepseekgui] picker response failed:', error) })
  })
  // 端口 0 = 由系统分配；只绑回环，不对外可达。
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  /* v8 ignore next 3 -- listening 之后 address() 必为 AddressInfo */
  if (address === null || typeof address === 'string') {
    throw new Error('picker bridge failed to report a listening address')
  }
  const endpoint = `http://127.0.0.1:${String(address.port)}${PICKER_BRIDGE_PATH}`
  deps.env.DEEPSEEKGUI_PICKER_ENDPOINT = endpoint
  deps.env.DEEPSEEKGUI_PICKER_TOKEN = token
  // 桥不该拖住退出：它没有要 flush 的状态，进程该走就走。
  server.unref()
  return { endpoint, token, close: () => { server.close() } }
}
