/**
 * 「用量与余额」的取数口径（B7-P3）：计划窗口、页内脚本、官方响应判定、
 * 十进制金额与聚合。全部用模拟响应，不联网、不碰任何 token。
 * @module @see-sol-lab/deepseekgui/tests/usage-service
 */

import { describe, expect, it } from 'vitest'
import {
  addDecimalStrings,
  dayStartOf,
  decimalIsPositive,
  interpretUsageResult,
  judgeUsageResponse,
  localDateOf,
  planUsageFetch,
  usageRequestPaths,
  usageViewOf,
  USAGE_HEATMAP_DAYS,
  USAGE_WINDOW_MAX_DAYS,
  type UsageFetchPlan,
  type UsageRawResponse,
  type UsageRequestKey,
} from '../src/usage-service.ts'

const TZ = 28_800
const DAY = 86_400
/** 2026-09-13 03:40 +08:00。 */
const NOW_MS = Date.UTC(2026, 8, 12, 19, 40)
const NOW = Math.floor(NOW_MS / 1000)
/** 2026-09-13 00:00 +08:00。 */
const TODAY_START = Date.UTC(2026, 8, 12, 16, 0) / 1000

/** 官方成功包裹。 */
function ok(bizData: unknown): UsageRawResponse {
  return { status: 200, body: JSON.stringify({ code: 0, msg: '', data: { biz_code: 0, biz_msg: '', biz_data: bizData } }) }
}

function summaryBiz(over: Record<string, unknown> = {}): unknown {
  return {
    normal_wallets: [{ currency: 'CNY', balance: '9.887654', token_estimation: '0' }],
    bonus_wallets: [{ currency: 'CNY', balance: '0.000000', token_estimation: '0' }],
    total_costs: [{ currency: 'CNY', amount: '640.11' }],
    ...over,
  }
}

/** amount 桶：按「距今天几天」给 [请求, 命中, 未命中, 输出]。 */
function amountBiz(days: Record<number, [number, number, number, number]>, bucket = DAY, timeOf?: (offset: number) => number): unknown {
  const buckets = Object.entries(days).map(([offset, [request, hit, miss, response]]) => ({
    time: timeOf === undefined ? TODAY_START - Number(offset) * DAY : timeOf(Number(offset)),
    usage: { REQUEST: request, RESPONSE_TOKEN: response, PROMPT_CACHE_HIT_TOKEN: hit, PROMPT_CACHE_MISS_TOKEN: miss },
  }))
  return {
    start: 0, end: 0, bucket, models: ['deepseek-v4-flash'],
    series: [{ api_key: { tracking_id: 'k1', name: 'default', sensitive_id: 'sk-***', valid: true }, model: 'deepseek-v4-flash', buckets }],
  }
}

/** cost 桶：按币种 → 距今天几天 → 十进制字符串。 */
function costBiz(byCurrency: Record<string, Record<number, string>>): unknown {
  return {
    data: Object.entries(byCurrency).map(([currency, days]) => ({
      currency,
      series: [{
        api_key: { tracking_id: 'k1', name: 'default', sensitive_id: 'sk-***', valid: true },
        model: 'deepseek-v4-flash',
        buckets: Object.entries(days).map(([offset, cost]) => ({ time: TODAY_START - Number(offset) * DAY, cost })),
      }],
    })),
  }
}

function plan(): UsageFetchPlan {
  return planUsageFetch(NOW_MS, TZ)
}

/** 一套「正常账户」的五个响应；调用方按键覆盖。 */
type ResponseOverrides = Partial<Record<UsageRequestKey, UsageRawResponse | undefined>>

function normalResponses(over: ResponseOverrides = {}): Partial<Record<UsageRequestKey, UsageRawResponse>> {
  const base: Partial<Record<UsageRequestKey, UsageRawResponse | undefined>> = {
    summary: ok(summaryBiz()),
    amount30: ok(amountBiz({ 0: [3, 300, 100, 50], 1: [10, 1000, 200, 100], 6: [1, 10, 10, 10], 7: [5, 50, 50, 50], 29: [2, 20, 0, 20] })),
    cost30: ok(costBiz({ CNY: { 0: '0.10', 1: '1.25', 6: '0.05', 7: '0.60', 29: '0.30' } })),
    amountPrev: ok(amountBiz({ 30: [4, 40, 40, 40], 59: [6, 60, 0, 60] })),
    amountToday: ok(amountBiz({ 0: [4, 400, 100, 80] }, 3600, () => TODAY_START + 2 * 3600)),
    ...over,
  }
  const result: Partial<Record<UsageRequestKey, UsageRawResponse>> = {}
  for (const [key, value] of Object.entries(base)) if (value !== undefined) result[key as UsageRequestKey] = value
  return result
}

describe('planUsageFetch（三窗口）', () => {
  it('30 天窗含今天；第二页紧接其前、半开不重叠；端点全部日界对齐、各窗不超过 31 天', () => {
    const p = plan()
    expect(p.todayStart).toBe(TODAY_START)
    // 官方要求 start/end 都是按 tz 的日界（end 用当前时刻会 INVALID_PARAM，
    // 2026-09-13 真实联通实测）；区间半开，「含今天」的 end = 明天 0 点。
    expect(p.window30).toEqual({ start: TODAY_START - 29 * DAY, end: TODAY_START + DAY })
    expect(p.windowPrev).toEqual({ start: TODAY_START - 59 * DAY, end: TODAY_START - 29 * DAY })
    expect(p.windowToday).toEqual({ start: TODAY_START, end: TODAY_START + DAY })
    expect(p.windowPrev.end).toBe(p.window30.start)
    for (const window of [p.window30, p.windowPrev, p.windowToday]) {
      expect((window.start + TZ) % DAY).toBe(0)
      expect((window.end + TZ) % DAY).toBe(0)
      expect((window.end - window.start) / DAY).toBeLessThanOrEqual(USAGE_WINDOW_MAX_DAYS)
    }
    expect(USAGE_HEATMAP_DAYS).toBe(60)
  })

  it('日界按 tz 对齐；本地日期格式化跟着 tz 走', () => {
    expect(dayStartOf(NOW, TZ)).toBe(TODAY_START)
    expect(localDateOf(NOW, TZ)).toBe('2026-09-13')
    expect(localDateOf(NOW, 0)).toBe('2026-09-12')
  })

  it('请求路径带 start/end/tz，五个键各一条', () => {
    const paths = usageRequestPaths(plan())
    expect(paths.summary).toBe('/api/v0/users/get_user_summary')
    expect(paths.amount30).toBe(`/api/v0/usage/by_api_key/amount?start=${String(TODAY_START - 29 * DAY)}&end=${String(TODAY_START + DAY)}&tz=28800`)
    expect(paths.cost30.startsWith('/api/v0/usage/by_api_key/cost?start=')).toBe(true)
    expect(paths.amountPrev).toContain(`start=${String(TODAY_START - 59 * DAY)}&end=${String(TODAY_START - 29 * DAY)}`)
    expect(paths.amountToday).toContain(`start=${String(TODAY_START)}&end=${String(TODAY_START + DAY)}`)
  })
})

describe('judgeUsageResponse（官方包裹判定）', () => {
  it('200 + code 0 + biz_data → ok', () => {
    expect(judgeUsageResponse(ok({ a: 1 }))).toEqual({ kind: 'ok', bizData: { a: 1 } })
  })

  it('401 或业务码 40002 → signed-out', () => {
    expect(judgeUsageResponse({ status: 401, body: '{"code":401}' })).toEqual({ kind: 'signed-out' })
    expect(judgeUsageResponse({ status: 200, body: JSON.stringify({ code: 40002, msg: 'Missing Token', data: null }) })).toEqual({ kind: 'signed-out' })
  })

  it('平台防护拦下（202 / 403 / 429，或回来一页 HTML）→ blocked，不当成改版', () => {
    expect(judgeUsageResponse({ status: 202, body: 'challenge' })).toEqual({ kind: 'blocked' })
    expect(judgeUsageResponse({ status: 202, body: null })).toEqual({ kind: 'blocked' })
    expect(judgeUsageResponse({ status: 403, body: '{"code":403}' })).toEqual({ kind: 'blocked' })
    expect(judgeUsageResponse({ status: 429, body: '' })).toEqual({ kind: 'blocked' })
    expect(judgeUsageResponse({ status: 200, body: '  <html>waf</html>' })).toEqual({ kind: 'blocked' })
  })

  it('200 + code 0 + INVALID_PARAM（无 biz_data）→ format；非 JSON / 非对象 / 500 → format；缺响应 → missing', () => {
    expect(judgeUsageResponse({ status: 200, body: JSON.stringify({ code: 0, msg: 'INVALID_PARAM', data: { biz_code: 1, biz_msg: 'bad', biz_data: null } }) })).toEqual({ kind: 'format' })
    expect(judgeUsageResponse({ status: 200, body: 'not json' })).toEqual({ kind: 'format' })
    expect(judgeUsageResponse({ status: 200, body: '[1,2]' })).toEqual({ kind: 'format' })
    expect(judgeUsageResponse({ status: 500, body: JSON.stringify({ code: 0, data: { biz_data: {} } }) })).toEqual({ kind: 'format' })
    expect(judgeUsageResponse({ status: 200, body: null })).toEqual({ kind: 'format' })
    expect(judgeUsageResponse(undefined)).toEqual({ kind: 'missing' })
  })
})

describe('十进制字符串', () => {
  it('相加保留最长小数位、不经浮点；0 是真实值', () => {
    expect(addDecimalStrings('0.10', '0.2')).toBe('0.30')
    expect(addDecimalStrings('9.887654', '0.112346')).toBe('10.000000')
    expect(addDecimalStrings('0', '0.000000')).toBe('0.000000')
    expect(addDecimalStrings('1', '2')).toBe('3')
    expect(addDecimalStrings('-1.5', '0.25')).toBe('-1.25')
    expect(decimalIsPositive('0.000000')).toBe(false)
    expect(decimalIsPositive('0.000001')).toBe(true)
  })

  it('非法金额抛错（调用方归为 format）', () => {
    expect(() => addDecimalStrings('1e3', '1')).toThrow()
    expect(() => addDecimalStrings('NaN', '1')).toThrow()
  })
})

describe('interpretUsageResult（聚合）', () => {
  it('正常账户：余额/累计消费原样、三个时段切片正确、今天优先用小时级请求', () => {
    const outcome = interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses() })
    expect(outcome.kind).toBe('ready')
    if (outcome.kind !== 'ready') return
    const data = outcome.data
    expect(data.balances).toEqual([{ currency: 'CNY', amount: '9.887654' }])
    expect(data.bonus).toEqual([])
    expect(data.totalCosts).toEqual([{ currency: 'CNY', amount: '640.11' }])
    // 今天：小时级请求给请求数与 token（4 请求，400+100+80），费用来自 30 天 cost 桶（0.10）。
    expect(data.today).toEqual({ costs: [{ currency: 'CNY', amount: '0.10' }], requests: 4, tokens: 580, cacheHitRate: 400 / 500 })
    // 7 天：今天 + 1 天前 + 6 天前（7 天前不算）。
    expect(data.days7.requests).toBe(3 + 10 + 1)
    expect(data.days7.tokens).toBe((300 + 100 + 50) + (1000 + 200 + 100) + (10 + 10 + 10))
    expect(data.days7.costs).toEqual([{ currency: 'CNY', amount: '1.40' }])
    expect(data.days7.cacheHitRate).toBeCloseTo((300 + 1000 + 10) / (300 + 100 + 1000 + 200 + 10 + 10), 10)
    // 30 天：全部五桶。
    expect(data.days30.requests).toBe(3 + 10 + 1 + 5 + 2)
    expect(data.days30.costs).toEqual([{ currency: 'CNY', amount: '2.30' }])
  })

  it('小时级请求缺失或失败时，今天退回 30 天桶里的当天值', () => {
    const outcome = interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ amountToday: undefined }) })
    expect(outcome.kind).toBe('ready')
    if (outcome.kind !== 'ready') return
    expect(outcome.data.today).toEqual({ costs: [{ currency: 'CNY', amount: '0.10' }], requests: 3, tokens: 450, cacheHitRate: 300 / 400 })
    const broken = interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ amountToday: { status: 200, body: 'not json' } }) })
    expect(broken.kind).toBe('ready')
  })

  it('零余额是真实值；赠金 > 0 才出现；多币种全部保留', () => {
    const responses = normalResponses({
      summary: ok(summaryBiz({
        normal_wallets: [{ currency: 'CNY', balance: '0.000000', token_estimation: '0' }, { currency: 'USD', balance: '12.5', token_estimation: '0' }],
        bonus_wallets: [{ currency: 'CNY', balance: '3.00', token_estimation: '0' }, { currency: 'USD', balance: '0', token_estimation: '0' }],
        total_costs: [{ currency: 'CNY', amount: '0' }, { currency: 'USD', amount: '7.25' }],
      })),
      cost30: ok(costBiz({ CNY: { 0: '0.10' }, USD: { 0: '0.02', 1: '0.03' } })),
    })
    const outcome = interpretUsageResult(plan(), { kind: 'responses', responses })
    expect(outcome.kind).toBe('ready')
    if (outcome.kind !== 'ready') return
    expect(outcome.data.balances).toEqual([{ currency: 'CNY', amount: '0.000000' }, { currency: 'USD', amount: '12.5' }])
    expect(outcome.data.bonus).toEqual([{ currency: 'CNY', amount: '3.00' }])
    expect(outcome.data.totalCosts).toEqual([{ currency: 'CNY', amount: '0' }, { currency: 'USD', amount: '7.25' }])
    expect(outcome.data.days30.costs).toEqual([{ currency: 'CNY', amount: '0.10' }, { currency: 'USD', amount: '0.05' }])
    expect(outcome.data.today.costs).toEqual([{ currency: 'CNY', amount: '0.10' }, { currency: 'USD', amount: '0.02' }])
  })

  it('没有 token / 任一响应 401 / 40002 → signed-out（不管其它响应多正常）', () => {
    expect(interpretUsageResult(plan(), { kind: 'no-token' })).toEqual({ kind: 'signed-out' })
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ summary: { status: 401, body: '' } }) })).toEqual({ kind: 'signed-out' })
    expect(interpretUsageResult(plan(), {
      kind: 'responses',
      responses: normalResponses({ cost30: { status: 200, body: JSON.stringify({ code: 40002, msg: 'Missing Token', data: null }) } }),
    })).toEqual({ kind: 'signed-out' })
  })

  it('必需响应缺失 → network；INVALID_PARAM / 改版 / 金额非十进制 → format', () => {
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ amount30: undefined }) }))
      .toEqual({ kind: 'unavailable', reason: 'network' })
    expect(interpretUsageResult(plan(), {
      kind: 'responses',
      responses: normalResponses({ amount30: { status: 200, body: JSON.stringify({ code: 0, msg: 'INVALID_PARAM', data: { biz_code: 1, biz_data: null } }) } }),
    })).toEqual({ kind: 'unavailable', reason: 'format' })
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ summary: ok({ wallets: [] }) }) }))
      .toEqual({ kind: 'unavailable', reason: 'format' })
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ cost30: ok(costBiz({ CNY: { 0: '1e-3' } })) }) }))
      .toEqual({ kind: 'unavailable', reason: 'format' })
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ summary: ok(summaryBiz({ normal_wallets: [{ currency: 'CNY', balance: 9.88 }] })) }) }))
      .toEqual({ kind: 'unavailable', reason: 'format' })
  })

  it('任一必需接口被平台防护拦下 → blocked（优先于 format，提示过几分钟再刷新）', () => {
    expect(interpretUsageResult(plan(), { kind: 'responses', responses: normalResponses({ summary: { status: 202, body: '<html></html>' } }) }))
      .toEqual({ kind: 'unavailable', reason: 'blocked' })
    expect(interpretUsageResult(plan(), {
      kind: 'responses',
      responses: normalResponses({ amount30: { status: 202, body: 'x' }, cost30: ok(costBiz({ CNY: { 0: '1e-3' } })) }),
    })).toEqual({ kind: 'unavailable', reason: 'blocked' })
  })

  it('热力图 60 格、最早在前、两页在第 30/31 天边界处正确拼接，重叠日以 30 天页为准', () => {
    const responses = normalResponses({
      amount30: ok(amountBiz({ 0: [1, 10, 0, 0], 29: [1, 290, 0, 0] })),
      // 第二页把第 29 天也报了一遍（重叠）和第 30、59 天。
      amountPrev: ok(amountBiz({ 29: [9, 9999, 0, 0], 30: [1, 300, 0, 0], 59: [1, 590, 0, 0] })),
    })
    const outcome = interpretUsageResult(plan(), { kind: 'responses', responses })
    expect(outcome.kind).toBe('ready')
    if (outcome.kind !== 'ready') return
    const heatmap = outcome.data.heatmap
    expect(heatmap).toHaveLength(60)
    expect(heatmap[0]).toEqual({ date: localDateOf(TODAY_START - 59 * DAY, TZ), tokens: 590 })
    expect(heatmap[29]).toEqual({ date: localDateOf(TODAY_START - 30 * DAY, TZ), tokens: 300 })
    expect(heatmap[30]).toEqual({ date: localDateOf(TODAY_START - 29 * DAY, TZ), tokens: 290 })
    expect(heatmap[59]).toEqual({ date: '2026-09-13', tokens: 10 })
    expect(heatmap.filter(day => day.tokens === 0)).toHaveLength(56)
    // 第二页那些没桶的日子不会被凭空造出来，日期序列连续。
    for (let index = 1; index < heatmap.length; index += 1) {
      expect(new Date(heatmap[index]?.date ?? '').getTime() - new Date(heatmap[index - 1]?.date ?? '').getTime()).toBe(DAY * 1000)
    }
  })
})

describe('usageViewOf', () => {
  it('默认 idle、无数据、带官方两个地址', () => {
    expect(usageViewOf()).toEqual({
      status: 'idle', reason: null, fetchedAt: null, data: null, cooling: false,
      usagePageUrl: 'https://platform.deepseek.com/usage',
    })
  })
})
