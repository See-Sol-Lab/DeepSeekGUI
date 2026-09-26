/**
 * 「用量与余额」的取数：主进程带官方账号的平台令牌直接请求平台接口（住户
 * 2026-09-25 定：登录改走官方账号体系，用量页位置与样子不变）。
 *
 * 平台令牌来自 Host 推来的官方平台会话（见 desktop-account.ts），与官方 Host
 * 查余额同一种凭证、同一个请求头（`x-dsh-auth-token`，deepseek-account-platform 的
 * protocol.ts）。取代旧的「隐藏窗口 + 独立登录分区 + 页面里读 localStorage.userToken」：
 * 不再有第二次登录，令牌也不进任何页面。
 *
 * 返回形状与旧的页内脚本一致（{@link UsageScriptResult}），解析与展示不变。
 * @module @see-sol-lab/deepseekgui/usage-fetch
 */

import type { DesktopPlatformSession } from './desktop-account.ts'
import { platformClientHeaders, type PlatformLocale } from './platform-view.ts'
import {
  USAGE_BODY_MAX, USAGE_FETCH_TIMEOUT_MS, usageRequestPaths,
  type UsageFetchPlan, type UsageRawResponse, type UsageRequestKey, type UsageScriptResult,
} from './usage-service.ts'

/** 取数要用到的宿主能力。 */
export interface UsageFetchDeps {
  /** 当前平台会话；未登录为 null。 */
  readonly session: () => DesktopPlatformSession | null
  /** 内嵌 DSH 版本（身份头）。 */
  readonly version: string
  /** 平台语言。 */
  readonly locale: () => PlatformLocale
  /** HTTP（测试注入）。 */
  readonly fetch?: typeof fetch
}

/**
 * 请求一轮用量数据。
 * @param deps - 会话与身份。
 * @param plan - 取数计划。
 * @param signal - 调用方的中止信号。
 * @returns 各接口的原始响应；未登录为 no-token。单个请求的网络失败只让该键缺省。
 */
export async function fetchUsage(deps: UsageFetchDeps, plan: UsageFetchPlan, signal: AbortSignal): Promise<UsageScriptResult> {
  const session = deps.session()
  if (session === null) return { kind: 'no-token' }
  const send = deps.fetch ?? fetch
  const headers: Record<string, string> = {
    ...session.requestHeaders,
    ...platformClientHeaders(deps.version, deps.locale()),
    accept: 'application/json',
    'x-dsh-auth-token': session.token,
  }
  const paths = usageRequestPaths(plan)
  const responses: Partial<Record<UsageRequestKey, UsageRawResponse>> = {}
  for (const key of Object.keys(paths) as UsageRequestKey[]) {
    signal.throwIfAborted()
    try {
      const response = await send(new URL(paths[key], session.origin), {
        method: 'GET',
        headers,
        // 带着令牌绝不跟随跳转：跳到别处等于把令牌交出去。
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(USAGE_FETCH_TIMEOUT_MS)]),
      })
      let body: string | null
      try { body = (await response.text()).slice(0, USAGE_BODY_MAX) } catch { body = null }
      responses[key] = { status: response.status, body }
    } catch (error) {
      if (signal.aborted) throw error
      // 网络层失败或超时：该键缺省，由解析层按缺失判定。
    }
  }
  return { kind: 'responses', responses }
}
