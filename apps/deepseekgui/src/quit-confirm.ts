/**
 * 显式退出确认的运行中会话感知：P7-F 给 B2-P2 的退出门铃加一个数字。
 *
 * 铁律（规格 §7）：
 * - 信号只来自官方 RPC（session.list 的 running 位），绝不自己维护第
 *   二份会话状态；
 * - 查询有硬超时（1500ms）：查询失败/超时立刻降级回诚实的旧文案，
 *   绝不变成"退不出去"或"卡住"；
 * - 宁可说得弱，不可说得假——running 位不足以证明"在跑工具"时只说
 *   "正在执行的会话数"，绝不夸大；
 * - 只显示数量，绝不显示会话内容/正文（隐私边界）。
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/quit-confirm
 */

import type { HarnessApi } from './harness-api.ts'
import type { ChromeStrings } from './chrome/view-model.ts'

/**
 * 查询当前正在执行的会话数。任何失败（网络、超时、响应形状不符）都
 * 返回 null——调用方降级为模糊文案，查询失败绝不能阻塞退出。
 * @param api - 官方 RPC 客户端（session.list）。
 * @returns 正在执行（running）的会话数；查不到为 null。
 */
export async function queryRunningSessionCount(api: HarnessApi): Promise<number | null> {
  try {
    const list = await api.sessionList()
    return list.items.filter(item => item.running).length
  } catch {
    return null
  }
}

/**
 * 三态文案：查得到且 N>0 → 实数；查得到且 N=0 → 不吓唬人；查不到 →
 * 退回 B2-P2 的诚实旧文案。文案全部来自 view-model 字典（唯一文案
 * 权威），本函数只做形态选择与 {count} 替换。
 * @param count - 正在执行的会话数；null = 查不到。
 * @param dict - 文案字典。
 * @returns 确认框 detail 文案。
 */
export function quitConfirmDetail(count: number | null, dict: ChromeStrings): string {
  if (count === null) return dict['quit.confirm.unknown'] ?? 'quit.confirm.unknown'
  if (count === 0) return dict['quit.confirm.idle'] ?? 'quit.confirm.idle'
  const template = count === 1 ? (dict['quit.confirm.running.one'] ?? dict['quit.confirm.running'] ?? 'quit.confirm.running')
    : (dict['quit.confirm.running'] ?? 'quit.confirm.running')
  return template.replace('{count}', String(count))
}

/**
 * 安装确认的 detail（B6-P6）：安装说明 + 运行中任务事实。
 *
 * 安装会停掉 Harness，正在执行的工作会被中断，所以运行中的任务必须先让
 * 用户看见再选择——绝不在后台强退。查不到数量时只说"可能正在执行"
 * （沿用 quit 的诚实降级），没有运行任务时不额外吓唬人。
 * @param count - 正在执行的会话数；null = 查不到。
 * @param dict - 文案字典。
 * @param version - 已验证安装包的版本。
 * @returns 安装确认框的 detail 文案。
 */
export function installConfirmDetail(count: number | null, dict: ChromeStrings, version: string): string {
  const base = (dict['dialog.install-confirm.detail'] ?? 'dialog.install-confirm.detail').replace('{version}', version)
  // 「没有运行中的任务」这一态不额外吓唬人，所以先返回；剩下两态与退出
  // 确认的文案逐字相同，交给同一个函数说，免得两处各自漂移。
  if (count === 0) return base
  return `${base}\n\n${quitConfirmDetail(count, dict)}`
}
