/**
 * harness-auth 测试：launch token 解析与 browser-auth cookie 交换的
 * fail-closed 语义。fake fetch 注入，零网络。
 * @module @see-sol-lab/deepseekgui/tests/harness-auth
 */

import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { exchangeSessionCookie, parseLaunchToken, readHarnessOutput } from '../src/harness-auth.ts'

it('extracts and redacts launch credentials across every byte boundary', () => {
  const token = 'SYNTHETIC_abcdefghijklmnopqrstuvwxyz'
  const line = `dsh web: http://127.0.0.1:43121/?token=${token}\n`
  for (let split = 0; split < line.length; split++) {
    const input = new PassThrough()
    const tokens: string[] = []
    const logs: string[] = []
    const reader = readHarnessOutput(input, value => tokens.push(value), value => logs.push(value))
    input.write(line.slice(0, split))
    expect(tokens).toEqual([])
    input.end(line.slice(split))
    expect(tokens).toEqual([token])
    expect(logs.join('')).not.toContain(token)
    expect(logs.join('')).toContain('token=<redacted>')
    reader.close()
  }
})

describe('parseLaunchToken', () => {
  it('解析服务 stdout 的 launch URL 行', () => {
    expect(parseLaunchToken('dsh web: http://127.0.0.1:43121/?token=nQK1lwYx1M_8lpHc4YUZPYOz5_CKVwc4yBGUfjoNKsc')).toBe(
      'nQK1lwYx1M_8lpHc4YUZPYOz5_CKVwc4yBGUfjoNKsc',
    )
  })

  it('非 launch 行返回 null', () => {
    expect(parseLaunchToken('[deepseekgui] events stream: connecting')).toBeNull()
    expect(parseLaunchToken('')).toBeNull()
  })

  it('畸形 URL 返回 null（fail closed）', () => {
    expect(parseLaunchToken('dsh web: not a url')).toBeNull()
  })
})

describe('exchangeSessionCookie', () => {
  it('303 + set-cookie → 返回 cookie 头值', async () => {
    const seen: string[] = []
    const cookie = await exchangeSessionCookie('http://127.0.0.1:43121', 'tok1', async (url, init) => {
      seen.push(`${init.method} ${url}`)
      return {
        status: 303,
        headers: {
          get: (name: string) => name === 'set-cookie'
            ? 'dsh-auth-abc=xyz; Max-Age=2592000; Path=/; Expires=Fri, 01 Jan 2027 00:00:00 GMT; HttpOnly; SameSite=Strict'
            : null,
        },
      }
    })
    expect(cookie).toBe('dsh-auth-abc=xyz')
    expect(seen).toEqual(['GET http://127.0.0.1:43121/?token=tok1'])
  })

  it('非 303 状态（401 等）返回 null', async () => {
    const cookie = await exchangeSessionCookie('http://127.0.0.1:43121', 'tok1', async () => ({
      status: 401,
      headers: { get: () => null },
    }))
    expect(cookie).toBeNull()
  })

  it('无 set-cookie 返回 null', async () => {
    const cookie = await exchangeSessionCookie('http://127.0.0.1:43121', 'tok1', async () => ({
      status: 303,
      headers: { get: () => null },
    }))
    expect(cookie).toBeNull()
  })

  it('网络失败返回 null（fail closed）', async () => {
    const cookie = await exchangeSessionCookie('http://127.0.0.1:43121', 'tok1', async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(cookie).toBeNull()
  })
})
