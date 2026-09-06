/**
 * dsh 0.1.2 launch-token 支持：解析服务 stdout 里的一次性 token，并用它
 * 交换官方 browser-auth 会话 cookie（B5-P2）。token 永不落日志/诊断/持久
 * 配置——只活在这个模块的调用链里。
 * @module @see-sol-lab/deepseekgui/harness-auth
 */

import { createInterface, type Interface } from 'node:readline'
import type { Readable } from 'node:stream'
import { redactSecrets } from './redact.ts'

/**
 * Read complete launch lines before extracting credentials or emitting logs.
 * @param input - Harness stdout.
 * @param onToken - Receives the complete launch credential in memory only.
 * @param log - Receives redacted lines, including their newline.
 * @returns the reader, closed automatically when stdout ends.
 */
export function readHarnessOutput(input: Readable, onToken: (token: string) => void, log: (line: string) => void): Interface {
  const lines = createInterface({ input, crlfDelay: Infinity })
  lines.on('line', (line) => {
    const token = parseLaunchToken(line)
    if (token !== null) onToken(token)
    log(`${redactSecrets(line)}\n`)
  })
  return lines
}

/** 可注入的 fetch 面（Node 全局 fetch 满足）。 */
type AuthFetch = (
  url: string,
  init: { method: string; redirect: 'manual' },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>

/**
 * 从 dsh 服务 stdout 的一行里解析 launch token。服务在启动时打印
 * `dsh web: http://127.0.0.1:<port>/?token=<token>`；行内其它内容一律忽略。
 * @param line - stdout 的一行（可能带行尾空白）。
 * @returns token 值；行内没有 launch URL 时返回 null。
 */
export function parseLaunchToken(line: string): string | null {
  const match = /dsh web: (\S+)/u.exec(line)
  if (match === null) return null
  try {
    return new URL(match[1] ?? '').searchParams.get('token')
  } catch {
    return null
  }
}

/**
 * 用 launch token 交换官方 browser-auth 会话 cookie：`GET /?token=<t>` 由
 * 服务 303 重定向并 set-cookie（HttpOnly；SameSite=Strict）。此后所有 /api
 * 调用（含 HTTP 与页面内 WebSocket）都带这个 cookie。
 * @param baseUrl - 服务基址（http://127.0.0.1:<port>）。
 * @param token - parseLaunchToken 得到的 token。
 * @param fetchImpl - fetch 实现（测试注入 fake）。
 * @returns cookie 头值（name=value）；交换失败（非 303、无 set-cookie、
 * 网络错误）返回 null——调用方按「服务未鉴权」处理（fail closed）。
 */
export async function exchangeSessionCookie(
  baseUrl: string,
  token: string,
  fetchImpl: AuthFetch,
): Promise<string | null> {
  let response: { status: number; headers: { get(name: string): string | null } }
  try {
    response = await fetchImpl(`${baseUrl}/?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      redirect: 'manual',
    })
  } catch {
    return null
  }
  if (response.status !== 303) return null
  const setCookie = response.headers.get('set-cookie')
  if (setCookie === null) return null
  return setCookie.split(';', 1)[0] ?? null
}
