/**
 * D39 控制桥：设置插件与 browser-plugin 与桌面之间唯一的本机回环通道。
 *
 * compat view 刻意无 preload（安全边界，不破），设置插件跑在官方页面里，
 * 唯一能走的通道就是这条回环 HTTP——与目录选择桥同一个模式：端口只绑
 * 127.0.0.1、凭证随进程一次性生成、经我们自己加载的页面 URL 下发。命令
 * 进的是与 Chrome 菜单**同一个** parseControlCommand + runCommand 出口：
 * 没有第二事实源，也没有第二套权限判断。
 *
 * **两把钥匙是这个模块的要害。** pane 通道的凭证经 env 交给我们 spawn 的
 * DSH 子进程，而那个进程里跑的正是 agent——它读得到自己的环境变量。共用
 * 一把钥匙等于把整个桌面命令面（quit、导出诊断、反馈外发、切 profile）
 * 交到 agent 手里；分开之后 pane token 只能开 pane 这一扇门。
 *
 * 凭证不对、路径不对，一律回同一个 404：不给探测者任何可区分的信号。
 *
 * pane 那条路由的具体行为（开面板、设代理、收起）经注入面传入——那些要
 * 摸 WebContentsView 句柄，属于入口。这个模块只负责「谁能进、进哪扇门」。
 * @module @see-sol-lab/deepseekgui/control-bridge
 */

import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { parseControlCommand, parseModelSinceParam, type DesktopControlCommand, type DesktopControlModel } from './control-model.ts'

/** pane 路由的请求体上限：那是几个短字段，没有合法的大载荷。 */
const PANE_BODY_MAX_BYTES = 16 * 1024
/** 命令的请求体上限：容纳两份各 20 万字符的记忆原文与草稿（含 JSON 转义），超长直接掐。 */
const COMMAND_BODY_MAX_BYTES = 3 * 1024 * 1024

/** 一次回复：状态码 + JSON 体。 */
export interface ControlBridgeReply {
  readonly status: number
  readonly body: Record<string, unknown>
}

/** 桥要用到的宿主能力。 */
export interface ControlBridgeDeps {
  /** 允许的页面来源（CORS）。 */
  readonly appOrigin: string
  /** 现算的控制模型。 */
  readonly buildModel: () => DesktopControlModel
  /** 执行一条已解析的命令。 */
  readonly runCommand: (command: DesktopControlCommand) => Promise<void>
  /** 脱敏（错误回给页面之前过一遍）。 */
  readonly redact: (text: string) => string
  /**
   * 处理一次 pane 请求。摸 WebContentsView 的部分留在入口，这里只把已解析
   * 的请求体递过去。
   */
  readonly handlePaneRequest: (body: Record<string, unknown>) => Promise<ControlBridgeReply>
  /** pane 通道的地址与凭证写进这里（必须在 spawn DSH 之前）。 */
  readonly env: NodeJS.ProcessEnv
}

/** 起好的桥。 */
export interface ControlBridge {
  /** 监听端口。 */
  readonly port: number
  /** 命令通道凭证：随页面 URL 下发，绝不进子进程环境。 */
  readonly controlToken: string
  /** pane 通道凭证：经 env 进子进程，只能开 pane 这一扇门。 */
  readonly paneToken: string
  /** 关停（测试用；生产里进程退出即可，服务器已 unref）。 */
  readonly close: () => void
}

/** 读完请求体，超限即掐断。 */
async function readBody(
  request: NodeJS.ReadableStream & { destroy: () => void },
  limit: number,
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  return new Promise((resolve) => {
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) { request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null)
      } catch {
        resolve(null)
      }
    })
    request.on('error', () => { resolve(null) })
    // 超限 destroy 之后既没有 'end' 也没有 'error'，只剩 'close'：不接它这个
    // promise 就永远悬着。resolve 之后再 resolve 是空操作，所以不必去重。
    request.on('close', () => { resolve(null) })
  })
}

/**
 * 起控制桥，并把 pane 通道的地址与凭证写进给定环境。
 * @param deps - 宿主能力与要写入的环境。
 * @returns 端口与两把凭证。
 */
export async function startControlBridge(deps: ControlBridgeDeps): Promise<ControlBridge> {
  const controlToken = randomUUID()
  const paneToken = randomUUID()
  const corsHeaders = {
    'access-control-allow-origin': deps.appOrigin,
    'access-control-allow-headers': 'content-type, x-deepseekgui-control-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  }
  const server: Server = createServer((request, response) => {
    const reply = (status: number, body: Record<string, unknown>): void => {
      if (response.destroyed || response.writableEnded) return
      const json = JSON.stringify(body)
      response.writeHead(status, { 'content-type': 'application/json', ...corsHeaders })
      response.end(json)
    }
    const handle = async (): Promise<void> => {
      // 预检放行（自定义 header 会触发 preflight；preflight 不带凭证）。
      if (request.method === 'OPTIONS') {
        response.writeHead(204, corsHeaders)
        response.end()
        return
      }
      // 凭证或路径不对一律同一个 404：不给探测者可区分信号（picker 桥同则）。
      // 两条通道各自一把钥匙：pane 路由认 paneToken，其余认 controlToken。
      const paneRoute = request.method === 'POST' && request.url === '/control/browser-pane'
      if (request.headers['x-deepseekgui-control-token'] !== (paneRoute ? paneToken : controlToken)) {
        reply(404, { error: 'not found' })
        return
      }
      if (request.method === 'GET' && request.url !== undefined && request.url.startsWith('/control/model')) {
        // 条件拉取。`?since=<revision>` 时内容未变只回小包
        // `{ revision, changed: false }`；无 since 或已变化回全量模型。
        const since = parseModelSinceParam(new URL(request.url, 'http://127.0.0.1').searchParams.get('since'))
        const model = deps.buildModel()
        if (since !== undefined && since === model.revision) {
          reply(200, { revision: model.revision, changed: false })
          return
        }
        reply(200, { revision: model.revision, changed: true, model })
        return
      }
      if (paneRoute) {
        const body = await readBody(request, PANE_BODY_MAX_BYTES)
        if (body === null) { reply(400, { error: 'invalid JSON' }); return }
        const answer = await deps.handlePaneRequest(body)
        reply(answer.status, answer.body)
        return
      }
      if (request.method === 'POST' && request.url === '/control/command') {
        const body = await readBody(request, COMMAND_BODY_MAX_BYTES)
        if (body === null) { reply(400, { error: 'invalid JSON' }); return }
        const command = parseControlCommand('command' in body ? body.command : null)
        if (command === null) { reply(400, { error: 'unknown command' }); return }
        await deps.runCommand(command)
        reply(200, { ok: true, model: deps.buildModel() })
        return
      }
      reply(404, { error: 'not found' })
    }
    void handle().catch((error: unknown) => { reply(500, { error: deps.redact(String(error instanceof Error ? error.message : error)) }) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  /* v8 ignore next 3 -- listening 之后 address() 必为 AddressInfo */
  if (address === null || typeof address === 'string') {
    throw new Error('control bridge failed to report a listening address')
  }
  // 桥地址 + **pane 专用**凭证经 env 注入我们自己 spawn 的 DSH 子进程
  // （dsh-service 的 inheritedEnv 透传 process.env），browser-plugin 由此
  // 找到 pane 通道。只进子进程环境，不落盘、不进任何窗口。
  deps.env.DEEPSEEKGUI_BROWSER_BRIDGE = `127.0.0.1:${String(address.port)}#${paneToken}`
  // 桥不该拖住退出：它没有要 flush 的状态，进程该走就走。
  server.unref()
  return { port: address.port, controlToken, paneToken, close: () => { server.close() } }
}
