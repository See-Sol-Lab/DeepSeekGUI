/**
 * 「用量与余额」的执行面（B7-P3）：单一状态机，持有面板状态，串起
 * 计划 → 页内取数 → 判定聚合 → 广播。
 *
 * 刷新只有三个触发点（打开本页 / 冷启动 / 手动），这里不设定时器、不常驻：
 * 每次刷新是一次有界的异步过程，结束即释放。限频与陈旧结果丢弃都在这里：
 * 冷却期内的重复触发直接忽略；一次刷新拿到的结果只有在它仍是最新一轮时
 * 才写进状态——切账户后晚到的旧响应不会盖住新的。
 *
 * 取数本身经注入面 {@link UsageControlDeps.execute} 进入内置浏览器的登录
 * session；本模块不依赖 Electron。
 * @module @see-sol-lab/deepseekgui/usage-control
 */

import {
  interpretUsageResult,
  planUsageFetch,
  usageViewOf,
  type UsageFetchPlan,
  type UsageScriptResult,
  type UsageView,
} from './usage-service.ts'

/** 刷新的触发点；四者之外没有别的入口（sign-in = 登录窗导航/关闭，R6）。 */
export type UsageRefreshTrigger = 'open' | 'startup' | 'manual' | 'sign-in'

/** 执行面要用到的宿主能力。 */
export interface UsageControlDeps {
  /**
   * 在内置浏览器登录 session 里执行一次取数。抛错表示网络/超时/没有可用
   * session（错误的 `name` 为 `'TimeoutError'` 时归为 timeout，`'NoSessionError'`
   * 归为 no-session，`'FormatError'` 归为 format，其余归为 network）。`signal`
   * 中止时结果会被丢弃，实现应尽快释放资源。
   */
  readonly execute: (plan: UsageFetchPlan, signal: AbortSignal) => Promise<UsageScriptResult>
  /** 当前时刻（毫秒）。 */
  readonly now: () => number
  /** 时区偏移（秒）；官方接口按它对齐日界。 */
  readonly tzOffsetSeconds: () => number
  /** 两次刷新之间的最短间隔（毫秒）；冷却期内的触发被忽略。 */
  readonly cooldownMs: number
  /** 事实变化后推送控制模型。 */
  readonly broadcast: () => void
}

/** 「用量与余额」执行面。 */
export interface UsageControl {
  /** 面板状态。 */
  readonly view: () => UsageView
  /**
   * 触发一次刷新。冷却期内、或已有一次刷新在跑时忽略（返回 false）；
   * 否则开始一轮并在结束后广播。
   */
  readonly refresh: (trigger: UsageRefreshTrigger) => Promise<boolean>
  /** 停止进行中的刷新并释放；之后的 refresh 仍可用。 */
  readonly dispose: () => void
}

/** 错误名 → 不可用原因（execute 的实现按此约定命名错误）。 */
export const USAGE_TIMEOUT_ERROR = 'TimeoutError'
export const USAGE_NO_SESSION_ERROR = 'NoSessionError'
export const USAGE_FORMAT_ERROR = 'FormatError'

/**
 * 建一个「用量与余额」执行面。
 * @param deps - 宿主能力。
 * @returns 执行面。
 */
export function createUsageControl(deps: UsageControlDeps): UsageControl {
  let view: UsageView = usageViewOf()
  /** 每开始一轮加一；结果只在轮次仍相同时写入。 */
  let generation = 0
  /** 进行中的那一轮的中止器；没有进行中的刷新时为 null。 */
  let inFlight: AbortController | null = null
  /** 上一轮结束的时刻（毫秒）；冷却期从它算。 */
  let settledAt: number | null = null
  /** 进行中那一轮的开始时刻（毫秒）。 */
  let startedAt = 0

  const cooling = (): boolean => settledAt !== null && deps.now() - settledAt < deps.cooldownMs

  const refresh = async (trigger: UsageRefreshTrigger): Promise<boolean> => {
    if (inFlight !== null) {
      // 进行中：打开页面/冷启动一律不重发；手动刷新只有在这一轮已经跑了
      // 超过一个冷却期（慢/卡住、或用户刚切了账户）时才接管——中止旧轮，
      // 旧结果因轮次落后被丢弃。冷却期内连点仍然只算一次。
      if (trigger !== 'manual' || deps.now() - startedAt < deps.cooldownMs) return false
      inFlight.abort()
      inFlight = null
    }
    if (cooling()) {
      // 面板据 cooling 把按钮变灰；这里只更新那个标志，不改数据。
      if (!view.cooling) {
        view = { ...view, cooling: true }
        deps.broadcast()
      }
      return false
    }
    generation += 1
    const round = generation
    const controller = new AbortController()
    inFlight = controller
    startedAt = deps.now()
    // loading 保留上一次的数据与时刻：面板按 fetchedAt 如实标注「上次刷新」，
    // 不冒充实时；失败或未登录时整体清空。
    view = { ...view, status: 'loading', reason: null, cooling: false }
    deps.broadcast()
    const plan = planUsageFetch(deps.now(), deps.tzOffsetSeconds())
    let next: UsageView
    try {
      const result = await deps.execute(plan, controller.signal)
      if (round !== generation || controller.signal.aborted) return true
      const outcome = interpretUsageResult(plan, result)
      next = outcome.kind === 'ready'
        ? usageViewOf({ status: 'ready', fetchedAt: new Date(deps.now()).toISOString(), data: outcome.data })
        : outcome.kind === 'signed-out'
          ? usageViewOf({ status: 'signed-out' })
          : usageViewOf({ status: 'unavailable', reason: outcome.reason })
    } catch (error) {
      if (round !== generation || controller.signal.aborted) return true
      const name = error instanceof Error ? error.name : ''
      next = usageViewOf({ status: 'unavailable', reason: reasonOfError(name) })
    } finally {
      if (inFlight === controller) inFlight = null
    }
    settledAt = deps.now()
    view = next
    deps.broadcast()
    return true
  }

  return {
    view: () => ({ ...view, cooling: view.status === 'loading' ? false : cooling() }),
    refresh,
    dispose: () => {
      generation += 1
      if (inFlight === null) return
      inFlight.abort()
      inFlight = null
      // 被中止的那一轮不会再结算：不能让状态停在「刷新中」。只在退出路径上
      // 调用，所以不广播——那时没有人在读模型。
      view = usageViewOf()
    },
  }
}

/** execute 抛出的错误名 → 面板原因。 */
function reasonOfError(name: string): 'timeout' | 'no-session' | 'format' | 'network' {
  if (name === USAGE_TIMEOUT_ERROR) return 'timeout'
  if (name === USAGE_NO_SESSION_ERROR) return 'no-session'
  if (name === USAGE_FORMAT_ERROR) return 'format'
  return 'network'
}
