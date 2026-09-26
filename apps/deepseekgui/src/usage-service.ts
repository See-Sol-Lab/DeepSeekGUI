/**
 * 「用量与余额」页的取数口径（B7-P3）：取数计划、官方响应判定、以及聚合成展示值。
 *
 * 数据来自开放平台的私有接口（`platform.deepseek.com/api/v0/…`）。2026-09-25 起由
 * 主进程带官方账号的平台令牌直接请求（usage-fetch.ts），令牌不进任何页面；
 * 这里把原始响应聚合成 {@link UsageView}，设置页只拿聚合值。
 * 纯模块：不依赖 Electron，时间与时区经参数传入，聚合与判定可在 Node 里
 * 用模拟响应逐分支测。
 * @module @see-sol-lab/deepseekgui/usage-service
 */

/** 开放平台 origin。 */
export const USAGE_ORIGIN = 'https://platform.deepseek.com'
/** 官方用量页（页面底部「更多详情」的目标，交给系统浏览器）。 */
export const USAGE_PAGE_URL = `${USAGE_ORIGIN}/usage`
/** 接口路径前缀（相对 origin）。 */
export const USAGE_API_PREFIX = '/api/v0/'
/** 单次窗口请求的上限（天）；官方 35 天返回 INVALID_PARAM、31 天成功。 */
export const USAGE_WINDOW_MAX_DAYS = 31
/** 热力图覆盖的天数（含今天）。 */
export const USAGE_HEATMAP_DAYS = 60
/** 页内单个响应正文带回主进程的上限（字符）；接口异常时绝不把整页 HTML 搬回来。 */
export const USAGE_BODY_MAX = 2_000_000
/** 页内每个 fetch 的超时（毫秒）。 */
export const USAGE_FETCH_TIMEOUT_MS = 15_000

const SECONDS_PER_DAY = 86_400

/** 一次刷新里的请求键：五个请求各一键，聚合按键取值。 */
export type UsageRequestKey = 'summary' | 'amount30' | 'cost30' | 'amountPrev' | 'amountToday'

/** 一个时间窗（unix 秒，闭区间由官方接口解释）。 */
export interface UsageWindow {
  readonly start: number
  readonly end: number
}

/** 一次刷新的取数计划：窗口全部在主进程算好，页内脚本只照单发请求。 */
export interface UsageFetchPlan {
  /** 时区偏移（秒），官方接口用它对齐日界；本地日界也按它算。 */
  readonly tz: number
  /** 计划生成时刻（unix 秒）。 */
  readonly now: number
  /** 今天 0 点（unix 秒）。 */
  readonly todayStart: number
  /** 最近 30 天（含今天）——消费情况的唯一数据源，7 天/今天由它切片。 */
  readonly window30: UsageWindow
  /** 热力图第二页：第 31–60 天，紧接 window30 之前、不重叠。 */
  readonly windowPrev: UsageWindow
  /** 今天：start/end 同一天时官方自动按小时分桶，给今天更精确的值。 */
  readonly windowToday: UsageWindow
}

/** 页内脚本带回的单个响应：HTTP 状态 + 原文（超限截断）。 */
export interface UsageRawResponse {
  readonly status: number
  readonly body: string | null
}

/** 页内脚本的返回值。 */
export type UsageScriptResult =
  /** 该 origin 的 localStorage 没有 userToken：没登录过或已登出。 */
  | { readonly kind: 'no-token' }
  /** 五个请求的原始响应（网络层失败的键缺省）。 */
  | { readonly kind: 'responses'; readonly responses: Partial<Record<UsageRequestKey, UsageRawResponse>> }

/** 一笔金额：币种 + 十进制字符串，原样来自官方，绝不经浮点。 */
export interface UsageMoney {
  readonly currency: string
  readonly amount: string
}

/** 一个时段的消费情况。 */
export interface UsageWindowView {
  /** 该时段消费金额，按币种分列（十进制字符串相加，保留原有小数位）。 */
  readonly costs: readonly UsageMoney[]
  readonly requests: number
  /** Token 总数 = 缓存命中 + 缓存未命中 + 输出。 */
  readonly tokens: number
  /** 缓存命中率 = 命中 / (命中 + 未命中)；没有输入 token 时为 null。 */
  readonly cacheHitRate: number | null
}

/** 热力图一格：本地日期与当天 token 总数。 */
export interface UsageHeatmapDay {
  /** `YYYY-MM-DD`（按计划的 tz）。 */
  readonly date: string
  readonly tokens: number
}

/** 聚合后的展示值（设置页只拿这个）。 */
export interface UsageData {
  /** 充值余额，可多币种。 */
  readonly balances: readonly UsageMoney[]
  /** 赠金余额，只保留 > 0 的钱包。 */
  readonly bonus: readonly UsageMoney[]
  /** 累计消费，按币种。 */
  readonly totalCosts: readonly UsageMoney[]
  readonly today: UsageWindowView
  readonly days7: UsageWindowView
  readonly days30: UsageWindowView
  /** 60 格，最早的一天在前。 */
  readonly heatmap: readonly UsageHeatmapDay[]
}

/** 取不到数据时的原因（面板按原因给不同提示，都不显示旧值）。 */
export type UsageUnavailableReason = 'network' | 'timeout' | 'format' | 'no-session'

/** 一次刷新的结论。 */
export type UsageOutcome =
  | { readonly kind: 'ready'; readonly data: UsageData }
  /** 没登录 / token 失效（40002 或 HTTP 401）。 */
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'unavailable'; readonly reason: UsageUnavailableReason }

/**
 * 「用量与余额」页的状态（控制模型的一部分；main 单处持有）。
 * ready 之外的状态一律不带数据：不把旧值当实时值显示。
 */
export interface UsageView {
  readonly status: 'idle' | 'loading' | 'ready' | 'signed-out' | 'unavailable'
  /** unavailable 时的原因；其余为 null。 */
  readonly reason: UsageUnavailableReason | null
  /** 上次成功刷新的时刻（ISO）；ready 时存在。 */
  readonly fetchedAt: string | null
  /** ready 时存在。 */
  readonly data: UsageData | null
  /** 手动刷新是否处于限频冷却期（面板据此把按钮变灰）。 */
  readonly cooling: boolean
  readonly usagePageUrl: string
}

/**
 * 面板状态的默认形态。
 * @param overrides - 要改的字段。
 * @returns 完整的 UsageView。
 */
export function usageViewOf(overrides: Partial<UsageView> = {}): UsageView {
  return {
    status: 'idle',
    reason: null,
    fetchedAt: null,
    data: null,
    cooling: false,
    usagePageUrl: USAGE_PAGE_URL,
    ...overrides,
  }
}

/**
 * 按 tz 取某时刻所在天的 0 点（unix 秒）。
 * @param seconds - unix 秒。
 * @param tz - 时区偏移（秒）。
 * @returns 当天 0 点。
 */
export function dayStartOf(seconds: number, tz: number): number {
  return Math.floor((seconds + tz) / SECONDS_PER_DAY) * SECONDS_PER_DAY - tz
}

/**
 * 按 tz 把 unix 秒格式化成 `YYYY-MM-DD`。
 * @param seconds - unix 秒。
 * @param tz - 时区偏移（秒）。
 * @returns 本地日期。
 */
export function localDateOf(seconds: number, tz: number): string {
  return new Date((seconds + tz) * 1000).toISOString().slice(0, 10)
}

/**
 * 生成一次刷新的取数计划：30 天（含今天）一窗、之前 30 天一窗（两窗相接、
 * 不重叠、各 ≤ 31 天），再加今天一窗（小时级）。
 *
 * 官方接口要求 `start`/`end` 都落在按 tz 对齐的日界上——`end` 用当前时刻
 * 会整条拒绝为 INVALID_PARAM（2026-09-13 真实登录态实测）；区间按半开
 * `[start, end)` 解释，所以「含今天」的窗口 end 是明天 0 点，相邻两窗共享
 * 端点也不会重复计入。
 * @param nowMs - 当前时刻（毫秒）。
 * @param tz - 时区偏移（秒）。
 * @returns 计划。
 */
export function planUsageFetch(nowMs: number, tz: number): UsageFetchPlan {
  const now = Math.floor(nowMs / 1000)
  const todayStart = dayStartOf(now, tz)
  const tomorrowStart = todayStart + SECONDS_PER_DAY
  const start30 = todayStart - 29 * SECONDS_PER_DAY
  const startPrev = todayStart - (USAGE_HEATMAP_DAYS - 1) * SECONDS_PER_DAY
  return {
    tz,
    now,
    todayStart,
    window30: { start: start30, end: tomorrowStart },
    windowPrev: { start: startPrev, end: start30 },
    windowToday: { start: todayStart, end: tomorrowStart },
  }
}

/**
 * 计划里每个请求的路径（相对 origin，含查询串）。
 * @param plan - 取数计划。
 * @returns 键 → 路径。
 */
export function usageRequestPaths(plan: UsageFetchPlan): Record<UsageRequestKey, string> {
  const query = (window: UsageWindow): string => `?start=${String(window.start)}&end=${String(window.end)}&tz=${String(plan.tz)}`
  return {
    summary: `${USAGE_API_PREFIX}users/get_user_summary`,
    amount30: `${USAGE_API_PREFIX}usage/by_api_key/amount${query(plan.window30)}`,
    cost30: `${USAGE_API_PREFIX}usage/by_api_key/cost${query(plan.window30)}`,
    amountPrev: `${USAGE_API_PREFIX}usage/by_api_key/amount${query(plan.windowPrev)}`,
    amountToday: `${USAGE_API_PREFIX}usage/by_api_key/amount${query(plan.windowToday)}`,
  }
}

// ---- 官方响应判定 ----

/** 官方包裹：`{code, msg, data:{biz_code, biz_msg, biz_data}}`；错误也可能 HTTP 200 + code:0 + msg:INVALID_PARAM——只认 biz_data。 */
type Envelope = { code?: unknown; msg?: unknown; data?: { biz_code?: unknown; biz_msg?: unknown; biz_data?: unknown } | null }

/** 单个响应的判定结果。 */
export type UsageResponseVerdict =
  | { readonly kind: 'ok'; readonly bizData: unknown }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'format' }
  | { readonly kind: 'missing' }

/** 官方「缺 token / token 失效」业务码。 */
const CODE_MISSING_TOKEN = 40002

/**
 * 判定一个原始响应：401 或业务码 40002 → 未登录；HTTP 200 + code 0 且
 * `data.biz_data` 存在 → 成功；其余（含 INVALID_PARAM、非 JSON、改版）→ format。
 * @param raw - 页内带回的响应；缺省表示网络层失败。
 * @returns 判定。
 */
export function judgeUsageResponse(raw: UsageRawResponse | undefined): UsageResponseVerdict {
  if (raw === undefined) return { kind: 'missing' }
  if (raw.status === 401) return { kind: 'signed-out' }
  if (raw.body === null) return { kind: 'format' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.body)
  } catch {
    return { kind: 'format' }
  }
  if (!isRecord(parsed)) return { kind: 'format' }
  const envelope = parsed as Envelope
  if (envelope.code === CODE_MISSING_TOKEN) return { kind: 'signed-out' }
  if (raw.status !== 200 || envelope.code !== 0) return { kind: 'format' }
  const data = envelope.data
  if (!isRecord(data) || data.biz_data === undefined || data.biz_data === null) return { kind: 'format' }
  return { kind: 'ok', bizData: data.biz_data }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---- 十进制字符串 ----

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/u

/**
 * 两个十进制字符串相加，保留两者中较长的小数位；任一非法就抛错（由调用方
 * 归为 format）。用 BigInt 做，绝不经浮点。
 * @param a - 加数。
 * @param b - 加数。
 * @returns 和。
 */
export function addDecimalStrings(a: string, b: string): string {
  const left = parseDecimal(a)
  const right = parseDecimal(b)
  const scale = Math.max(left.scale, right.scale)
  const sum = left.units * 10n ** BigInt(scale - left.scale) + right.units * 10n ** BigInt(scale - right.scale)
  return formatDecimal(sum, scale)
}

/**
 * 十进制字符串是否严格大于 0（赠金「>0 才附注」用）。
 * @param text - 十进制字符串。
 * @returns 是否为正。
 */
export function decimalIsPositive(text: string): boolean {
  return parseDecimal(text).units > 0n
}

/**
 * 十进制字符串是否合法（官方金额字段的形状检查）。
 * @param text - 候选。
 * @returns 是否匹配 `-?digits(.digits)?`。
 */
export function isDecimalString(text: unknown): text is string {
  return typeof text === 'string' && DECIMAL.test(text)
}

function parseDecimal(text: string): { units: bigint; scale: number } {
  const match = DECIMAL.exec(text)
  if (match === null) throw new UsageFormatError(`not a decimal string: ${JSON.stringify(text)}`)
  const fraction = match[3] ?? ''
  const units = BigInt(`${match[2] ?? '0'}${fraction}`) * (match[1] === '-' ? -1n : 1n)
  return { units, scale: fraction.length }
}

function formatDecimal(units: bigint, scale: number): string {
  const negative = units < 0n
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  const fraction = digits.slice(digits.length - scale)
  return `${negative ? '-' : ''}${whole}${scale > 0 ? `.${fraction}` : ''}`
}

// ---- 聚合 ----

interface AmountBucket {
  time: number
  request: number
  hit: number
  miss: number
  response: number
}

interface CostBucket {
  time: number
  currency: string
  cost: string
}

/** 官方响应形状不符（改版、字段缺失、金额非十进制）：一律归为 unavailable/format。 */
export class UsageFormatError extends Error {}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UsageFormatError(`${key} is not a number`)
  return value
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new UsageFormatError(`${key} is not a string`)
  return value
}

/** `usage/by_api_key/amount` 的 biz_data → 扁平的桶列表（跨 key、跨模型合并，首版不细分）。 */
function amountBuckets(bizData: unknown): AmountBucket[] {
  if (!isRecord(bizData) || !Array.isArray(bizData.series)) throw new UsageFormatError('amount.series missing')
  const buckets: AmountBucket[] = []
  for (const series of bizData.series) {
    if (!isRecord(series) || !Array.isArray(series.buckets)) throw new UsageFormatError('amount.series[] malformed')
    for (const bucket of series.buckets) {
      if (!isRecord(bucket) || !isRecord(bucket.usage)) throw new UsageFormatError('amount bucket malformed')
      const usage = bucket.usage
      buckets.push({
        time: numberField(bucket, 'time'),
        request: numberField(usage, 'REQUEST'),
        hit: numberField(usage, 'PROMPT_CACHE_HIT_TOKEN'),
        miss: numberField(usage, 'PROMPT_CACHE_MISS_TOKEN'),
        response: numberField(usage, 'RESPONSE_TOKEN'),
      })
    }
  }
  return buckets
}

/** `usage/by_api_key/cost` 的 biz_data → 扁平的按币种桶列表。 */
function costBuckets(bizData: unknown): CostBucket[] {
  if (!isRecord(bizData) || !Array.isArray(bizData.data)) throw new UsageFormatError('cost.data missing')
  const buckets: CostBucket[] = []
  for (const group of bizData.data) {
    if (!isRecord(group) || !Array.isArray(group.series)) throw new UsageFormatError('cost.data[] malformed')
    const currency = stringField(group, 'currency')
    for (const series of group.series) {
      if (!isRecord(series) || !Array.isArray(series.buckets)) throw new UsageFormatError('cost.series[] malformed')
      for (const bucket of series.buckets) {
        if (!isRecord(bucket)) throw new UsageFormatError('cost bucket malformed')
        const cost = stringField(bucket, 'cost')
        if (!isDecimalString(cost)) throw new UsageFormatError('cost is not a decimal string')
        buckets.push({ time: numberField(bucket, 'time'), currency, cost })
      }
    }
  }
  return buckets
}

/** `users/get_user_summary` 的 biz_data → 钱包与累计消费。 */
function summaryOf(bizData: unknown): Pick<UsageData, 'balances' | 'bonus' | 'totalCosts'> {
  if (!isRecord(bizData)) throw new UsageFormatError('summary malformed')
  const wallets = (key: string, field: 'balance' | 'amount'): UsageMoney[] => {
    const list = bizData[key]
    if (!Array.isArray(list)) throw new UsageFormatError(`summary.${key} missing`)
    return list.map((entry) => {
      if (!isRecord(entry)) throw new UsageFormatError(`summary.${key}[] malformed`)
      const currency = stringField(entry, 'currency')
      const amount = entry[field]
      if (!isDecimalString(amount)) throw new UsageFormatError(`summary.${key}[].${field} is not a decimal string`)
      return { currency, amount }
    })
  }
  return {
    balances: wallets('normal_wallets', 'balance'),
    bonus: wallets('bonus_wallets', 'balance').filter(money => decimalIsPositive(money.amount)),
    totalCosts: wallets('total_costs', 'amount'),
  }
}

/** 把落在窗口内的 amount 桶与 cost 桶聚合成一个时段的消费情况。 */
function windowView(amounts: readonly AmountBucket[], costs: readonly CostBucket[], window: UsageWindow): UsageWindowView {
  let requests = 0
  let hit = 0
  let miss = 0
  let response = 0
  for (const bucket of amounts) {
    if (bucket.time < window.start || bucket.time > window.end) continue
    requests += bucket.request
    hit += bucket.hit
    miss += bucket.miss
    response += bucket.response
  }
  const byCurrency = new Map<string, string>()
  for (const bucket of costs) {
    if (bucket.time < window.start || bucket.time > window.end) continue
    byCurrency.set(bucket.currency, addDecimalStrings(byCurrency.get(bucket.currency) ?? '0', bucket.cost))
  }
  const input = hit + miss
  return {
    costs: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
    requests,
    tokens: hit + miss + response,
    cacheHitRate: input === 0 ? null : hit / input,
  }
}

/**
 * 把一次刷新的原始响应聚合成结论。判定顺序：任一响应说未登录 → signed-out；
 * summary / amount30 / cost30 / amountPrev 任一缺失或格式不对 → unavailable；
 * amountToday 可缺（缺了就用 30 天桶里今天那一桶）。
 * @param plan - 生成这些响应的计划（切片窗口从它来）。
 * @param result - 页内脚本返回值。
 * @returns 结论。
 */
export function interpretUsageResult(plan: UsageFetchPlan, result: UsageScriptResult): UsageOutcome {
  if (result.kind === 'no-token') return { kind: 'signed-out' }
  const verdicts = {
    summary: judgeUsageResponse(result.responses.summary),
    amount30: judgeUsageResponse(result.responses.amount30),
    cost30: judgeUsageResponse(result.responses.cost30),
    amountPrev: judgeUsageResponse(result.responses.amountPrev),
    amountToday: judgeUsageResponse(result.responses.amountToday),
  }
  if (Object.values(verdicts).some(verdict => verdict.kind === 'signed-out')) return { kind: 'signed-out' }
  const required = [verdicts.summary, verdicts.amount30, verdicts.cost30, verdicts.amountPrev]
  if (required.some(verdict => verdict.kind === 'missing')) return { kind: 'unavailable', reason: 'network' }
  if (required.some(verdict => verdict.kind === 'format')) return { kind: 'unavailable', reason: 'format' }
  try {
    const summary = summaryOf(bizDataOf(verdicts.summary))
    const amount30 = amountBuckets(bizDataOf(verdicts.amount30))
    const cost30 = costBuckets(bizDataOf(verdicts.cost30))
    const amountPrev = amountBuckets(bizDataOf(verdicts.amountPrev))
    const amountToday = verdicts.amountToday.kind === 'ok' ? amountBuckets(verdicts.amountToday.bizData) : null
    const days7: UsageWindow = { start: plan.todayStart - 6 * SECONDS_PER_DAY, end: plan.now }
    const todayFromDays = windowView(amount30, cost30, plan.windowToday)
    // 今天：小时级请求成功就用它的请求数 / token（更精确），费用仍来自 30 天的 cost 桶。
    const today: UsageWindowView = amountToday === null
      ? todayFromDays
      : { ...windowView(amountToday, [], plan.windowToday), costs: todayFromDays.costs }
    return {
      kind: 'ready',
      data: {
        ...summary,
        today,
        days7: windowView(amount30, cost30, days7),
        days30: windowView(amount30, cost30, plan.window30),
        heatmap: heatmapOf(plan, amount30, amountPrev),
      },
    }
  } catch (error) {
    if (error instanceof UsageFormatError) return { kind: 'unavailable', reason: 'format' }
    throw error
  }
}

function bizDataOf(verdict: UsageResponseVerdict): unknown {
  // interpretUsageResult 已保证必需项都是 ok；这里只做类型收窄。
  return verdict.kind === 'ok' ? verdict.bizData : undefined
}

/**
 * 60 格热力图：按本地日期归并两页 amount 桶（同一天出现在两页时以 30 天页为准），
 * 没有桶的日子记 0；固定 60 项、最早在前。
 * @param plan - 计划（决定日期范围与 tz）。
 * @param amount30 - 最近 30 天的桶。
 * @param amountPrev - 之前 30 天的桶。
 * @returns 60 格。
 */
export function heatmapOf(plan: UsageFetchPlan, amount30: readonly AmountBucket[], amountPrev: readonly AmountBucket[]): UsageHeatmapDay[] {
  const tokensByDate = new Map<string, number>()
  const fold = (buckets: readonly AmountBucket[], overwrite: boolean): void => {
    const seen = new Map<string, number>()
    for (const bucket of buckets) {
      const date = localDateOf(bucket.time, plan.tz)
      seen.set(date, (seen.get(date) ?? 0) + bucket.hit + bucket.miss + bucket.response)
    }
    for (const [date, tokens] of seen) {
      if (overwrite || !tokensByDate.has(date)) tokensByDate.set(date, tokens)
    }
  }
  // 30 天页先入、可覆盖；第二页只补它没有的日子。
  fold(amount30, true)
  fold(amountPrev, false)
  const days: UsageHeatmapDay[] = []
  for (let offset = USAGE_HEATMAP_DAYS - 1; offset >= 0; offset -= 1) {
    const date = localDateOf(plan.todayStart - offset * SECONDS_PER_DAY, plan.tz)
    days.push({ date, tokens: tokensByDate.get(date) ?? 0 })
  }
  return days
}
