/**
 * 「用量与余额」执行面（B7-P3）：三个触发点共用一条刷新、限频、进行中的
 * 接管与陈旧结果丢弃（切账户旧请求晚到）、超时/无 session 的降级、失败不留
 * 旧值。取数经注入替身，不联网、不碰 Electron。
 * @module @see-sol-lab/deepseekgui/tests/usage-control
 */

import { describe, expect, it } from 'vitest'
import { createUsageControl, USAGE_NO_SESSION_ERROR, USAGE_TIMEOUT_ERROR, type UsageControlDeps } from '../src/usage-control.ts'
import type { UsageFetchPlan, UsageRawResponse, UsageScriptResult } from '../src/usage-service.ts'

const TZ = 28_800
const DAY = 86_400
const TODAY_START = Date.UTC(2026, 8, 12, 16, 0) / 1000

function ok(bizData: unknown): UsageRawResponse {
  return { status: 200, body: JSON.stringify({ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: bizData } }) }
}

/** 一套正常响应；balance 可换，用来区分「账户 A / 账户 B」。 */
function account(balance: string): UsageScriptResult {
  const amount = (tokens: number): unknown => ({
    start: 0, end: 0, bucket: DAY, models: [],
    series: [{ api_key: { tracking_id: 'k', name: 'n', sensitive_id: '*', valid: true }, model: 'm',
      buckets: [{
        time: TODAY_START,
        usage: { REQUEST: 1, RESPONSE_TOKEN: tokens, PROMPT_CACHE_HIT_TOKEN: 0, PROMPT_CACHE_MISS_TOKEN: 0 },
      }] }],
  })
  return {
    kind: 'responses',
    responses: {
      summary: ok({ normal_wallets: [{ currency: 'CNY', balance, token_estimation: '0' }], bonus_wallets: [], total_costs: [{ currency: 'CNY', amount: '1' }] }),
      amount30: ok(amount(10)),
      cost30: ok({ data: [] }),
      amountPrev: ok(amount(0)),
      amountToday: ok(amount(10)),
    },
  }
}

interface Harness {
  deps: UsageControlDeps
  clock: { now: number }
  calls: { plan: UsageFetchPlan; signal: AbortSignal; resolve: (result: UsageScriptResult) => void; reject: (error: Error) => void }[]
  broadcasts: number
}

/** 可控时钟 + 手动结算的 execute 替身。 */
function harness(cooldownMs = 5000): Harness {
  const state: Harness = {
    clock: { now: Date.UTC(2026, 8, 12, 19, 40) },
    calls: [],
    broadcasts: 0,
    deps: {
      execute: (plan, signal) => new Promise<UsageScriptResult>((resolve, reject) => {
        state.calls.push({ plan, signal, resolve, reject })
      }),
      now: () => state.clock.now,
      tzOffsetSeconds: () => TZ,
      cooldownMs,
      broadcast: () => { state.broadcasts += 1 },
    },
  }
  return state
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

function namedError(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

describe('createUsageControl', () => {
  it('打开页面触发一次刷新：loading → ready，带 fetchedAt 与聚合数据，广播两次', async () => {
    const hz = harness()
    const control = createUsageControl(hz.deps)
    expect(control.view().status).toBe('idle')
    const started = control.refresh('open')
    expect(control.view().status).toBe('loading')
    expect(hz.calls).toHaveLength(1)
    expect(hz.calls[0]?.plan.tz).toBe(TZ)
    hz.calls[0]?.resolve(account('9.88'))
    expect(await started).toBe(true)
    const view = control.view()
    expect(view.status).toBe('ready')
    expect(view.fetchedAt).toBe(new Date(hz.clock.now).toISOString())
    expect(view.data?.balances).toEqual([{ currency: 'CNY', amount: '9.88' }])
    expect(hz.broadcasts).toBe(2)
  })

  it('冷却期内的再次触发被忽略（连点只发一次）；冷却过后再发', async () => {
    const hz = harness(5000)
    const control = createUsageControl(hz.deps)
    const first = control.refresh('open')
    hz.calls[0]?.resolve(account('1'))
    await first
    expect(await control.refresh('manual')).toBe(false)
    expect(await control.refresh('open')).toBe(false)
    expect(hz.calls).toHaveLength(1)
    expect(control.view().cooling).toBe(true)
    hz.clock.now += 5001
    expect(control.view().cooling).toBe(false)
    const second = control.refresh('manual')
    expect(hz.calls).toHaveLength(2)
    hz.calls[1]?.resolve(account('2'))
    await second
    expect(control.view().data?.balances[0]?.amount).toBe('2')
  })

  it('进行中：打开/冷启动不重发；手动在冷却期内也不重发', async () => {
    const hz = harness(5000)
    const control = createUsageControl(hz.deps)
    void control.refresh('open')
    expect(await control.refresh('open')).toBe(false)
    expect(await control.refresh('startup')).toBe(false)
    expect(await control.refresh('manual')).toBe(false)
    expect(hz.calls).toHaveLength(1)
  })

  it('切账户旧请求晚到：慢请求期间手动刷新接管，旧结果被丢弃、新结果生效', async () => {
    const hz = harness(5000)
    const control = createUsageControl(hz.deps)
    const first = control.refresh('open')
    hz.clock.now += 6000
    const second = control.refresh('manual')
    expect(hz.calls).toHaveLength(2)
    expect(hz.calls[0]?.signal.aborted).toBe(true)
    // 旧账户 A 的响应晚到。
    hz.calls[0]?.resolve(account('1.11'))
    await first
    expect(control.view().status).toBe('loading')
    hz.calls[1]?.resolve(account('2.22'))
    await second
    expect(control.view().data?.balances[0]?.amount).toBe('2.22')
    expect(control.view().status).toBe('ready')
  })

  it('旧请求在新一轮已结算之后才回来：同样丢弃', async () => {
    const hz = harness(5000)
    const control = createUsageControl(hz.deps)
    const first = control.refresh('open')
    hz.clock.now += 6000
    const second = control.refresh('manual')
    hz.calls[1]?.resolve(account('2.22'))
    await second
    hz.calls[0]?.resolve(account('1.11'))
    await first
    expect(control.view().data?.balances[0]?.amount).toBe('2.22')
  })

  it('刷新中保留上一次的数据与时刻；失败后清空、不显示旧值', async () => {
    const hz = harness(0)
    const control = createUsageControl(hz.deps)
    const first = control.refresh('open')
    hz.calls[0]?.resolve(account('1'))
    await first
    const second = control.refresh('manual')
    expect(control.view().status).toBe('loading')
    expect(control.view().data?.balances[0]?.amount).toBe('1')
    expect(control.view().fetchedAt).not.toBeNull()
    hz.calls[1]?.reject(namedError('NetworkError'))
    await second
    expect(control.view()).toMatchObject({ status: 'unavailable', reason: 'network', data: null, fetchedAt: null })
  })

  it('超时 / 无 session / 格式 三种错误名各归各的原因；未登录与格式改版来自判定层', async () => {
    const hz = harness(0)
    const control = createUsageControl(hz.deps)
    const cases: [Error | UsageScriptResult, Record<string, unknown>][] = [
      [namedError(USAGE_TIMEOUT_ERROR), { status: 'unavailable', reason: 'timeout' }],
      [namedError(USAGE_NO_SESSION_ERROR), { status: 'unavailable', reason: 'no-session' }],
      [namedError('FormatError'), { status: 'unavailable', reason: 'format' }],
      [{ kind: 'no-token' }, { status: 'signed-out', reason: null, data: null }],
      [{ kind: 'responses', responses: { summary: { status: 401, body: '' } } }, { status: 'signed-out' }],
      [{ kind: 'responses', responses: {} }, { status: 'unavailable', reason: 'network' }],
    ]
    for (const [input, expected] of cases) {
      const round = control.refresh('manual')
      const call = hz.calls[hz.calls.length - 1]
      if (input instanceof Error) call?.reject(input)
      else call?.resolve(input)
      await round
      expect(control.view()).toMatchObject(expected)
    }
  })

  it('dispose 中止进行中的刷新并丢弃其结果', async () => {
    const hz = harness(0)
    const control = createUsageControl(hz.deps)
    const first = control.refresh('startup')
    control.dispose()
    expect(hz.calls[0]?.signal.aborted).toBe(true)
    hz.calls[0]?.resolve(account('3.33'))
    await first
    await tick()
    expect(control.view().status).toBe('idle')
    expect(control.view().data).toBeNull()
  })
})
