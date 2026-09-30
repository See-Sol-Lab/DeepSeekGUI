/**
 * 开发者模式（住户 2026-09-29）：设置 → 通用里的一行，官方上报的总开关。
 *
 * 关（默认）是 DeepSeekGUI 的版本：会话日志、插件清单和反馈记录都不上传。开是
 * DeepSeek Harness 的官方默认：使用官方模型时整段会话记录（在已有会话里继续时
 * 连同开启前尚未上传的部分）和已启用插件的名称与版本随请求上传，提交反馈或评分
 * 时截至当时的会话记录上传到遥测服务。另一类「桌面产品统计」官方只在自己的桌面
 * 端采集，这里不接。
 *
 * 真源在桌面主进程的 UI state，只在启动 Harness 时生效，所以切换经控制桥的
 * `developer-mode-set` 并重启 Harness。Harness 在跑时主进程先弹「会打断工作」
 * 的确认；用户取消则值不变，这一行显示的就是命令应答里的值，不自作主张翻过去。
 *
 * 只在 DeepSeekGUI 自己开的窗口里存在（控制桥在页面 URL query 里）。它同时
 * 顶替官方 `ui-settings-session-log` 那一行（组合里已关掉），两个开关不会打架。
 */
import { useEffect, useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ControlBridgeClient } from './bridge.ts'

/** 注入面：控制桥。默认从页面 URL 读，测试可以塞一个假的。 */
export interface DeveloperModeInjected {
  /** 桌面控制桥；null = 这个页面不是 DeepSeekGUI 开的窗口。 */
  bridge: ControlBridgeClient | null
}

/** 设置行的 props。 */
export type DeveloperModeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'deepseekgui.workbench'>
  & DeveloperModeInjected

/** 与官方「通用」页其他行一致的版式（官方行用 CSS 模块，这里写同样的数值）。 */
const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 24,
  padding: '16px 0',
  borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
} as const
const titleStyle = { fontSize: 14, lineHeight: '20px' } as const
const descriptionStyle = {
  marginTop: 4,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
} as const

/**
 * 读出错误的可读文字。
 * @param reason - 捕获到的值。
 * @returns 文字。
 */
function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * 开发者模式那一行：说明写在开关旁边，切换经桌面主进程。
 * @param props - 控制桥与文案座位。
 * @returns 设置行；不是 DeepSeekGUI 窗口时不渲染。
 */
export function DeveloperModeRow({ bridge, t }: DeveloperModeRowProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (bridge === null) return undefined
    let live = true
    bridge.model().then((fetched) => {
      if (live && fetched.changed) setEnabled(fetched.model.developerMode === true)
    }).catch((reason: unknown) => {
      if (live) setError(messageOf(reason))
    })
    return () => { live = false }
  }, [bridge])
  if (bridge === null) return null
  const toggle = (next: boolean): void => {
    setBusy(true)
    setError(null)
    // 应答里的值才是真值：用户在确认框里取消时，它仍是旧值。
    bridge.run({ type: 'developer-mode-set', enabled: next }).then((model) => {
      setEnabled(model.developerMode === true)
    }).catch((reason: unknown) => {
      setError(messageOf(reason))
    }).finally(() => {
      setBusy(false)
    })
  }
  return (
    <div style={rowStyle}>
      <div>
        <div style={titleStyle}>{t('developerMode.title')}</div>
        <div style={descriptionStyle}>{t('developerMode.off')}</div>
        <div style={descriptionStyle}>{t('developerMode.on')}</div>
        <div style={descriptionStyle}>{t('developerMode.restart')}</div>
        {busy && <div role="status" style={descriptionStyle}>{t('developerMode.pending')}</div>}
        {error !== null && <div role="alert" style={descriptionStyle}>{error}</div>}
      </div>
      <Switch
        checked={enabled === true}
        disabled={busy || enabled === null}
        label={t('developerMode.title')}
        onChange={toggle}
      />
    </div>
  )
}
