/**
 * 更新测试的共享本机 mock server 与 HTTP 注入面（P11 从 update-runner.spec.ts
 * 提取，供 update-flow.spec.ts 复用）：只监听 127.0.0.1 随机端口，不访问
 * 公网、无凭据、无模型。
 * @module @see-sol-lab/deepseekgui/tests/update-mock
 */

import { get } from 'node:http'
import { createServer, type Server } from 'node:http'
import type { HttpGet, UpdateAsset, UpdateManifest } from '../src/update-service.ts'

/** 本机 mock server：按 URL 返回预设响应；记录请求路径。 */
export async function startMock(
  routes: Map<string, { status: number; body: Buffer | (() => Buffer) }>,
): Promise<{ url: string; close: () => void; requests: string[] }> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '')
    const route = routes.get(req.url ?? '')
    if (route === undefined) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(route.status, { 'content-type': 'application/octet-stream' })
    res.end(typeof route.body === 'function' ? route.body() : route.body)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server failed to bind')
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    requests,
    close: () => {
      server.close()
    },
  }
}

/** node:http.get 的 HttpGet 注入面（本机 mock；HttpGet 不限定协议）。 */
export const httpGet: HttpGet = (url, callback) => {
  const request = get(url, (response) => {
    callback({
      statusCode: response.statusCode,
      on: (event, fn) => {
        response.on(event, (...args) => {
          fn(...(args as unknown[]))
        })
      },
    })
  })
  return {
    on: (event, fn) => {
      request.on(event, (...args) => {
        fn(...(args as unknown[]))
      })
    },
    destroy: () => {
      request.destroy()
    },
  }
}

/**
 * 把 https 降到 http 的本机注入面：产品只接受 HTTPS 资产 URL（由
 * update-service 的解析器把关，见其单测），而本机 mock 只说 http。这个替身
 * 只存在于测试里，让同一份**已解析** manifest 走完下载；产品侧 main 用的是
 * `https.get`，不受影响。
 * @param url - 请求 URL。
 * @param callback - 响应回调。
 * @returns 请求句柄（与 {@link httpGet} 相同）。
 */
export const httpGetLocal: HttpGet = (url, callback) => httpGet(url.replace(/^https:/u, 'http:'), callback)

/** 组装一个测试用 manifest（release notes 固定）。 */
export function manifestFor(version: string, asset: UpdateAsset): UpdateManifest {
  return { latestVersion: version, releaseNotes: 'test notes', assets: [asset] }
}
