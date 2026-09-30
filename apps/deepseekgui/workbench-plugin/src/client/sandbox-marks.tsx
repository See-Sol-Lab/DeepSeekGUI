/**
 * 清理沙箱标记（住户 2026-09-29）：设置 → 通用里的一行。
 *
 * Windows 上 DeepSeek 在沙箱里改过的文件夹，会被加上一组权限标记（其中的
 * Low 标签会让从那里启动的程序以低完整性运行，Electron 之类因此起不来）。
 * 新版在命令用完后自动收回；这一行给旧版本留下的、或崩溃没来得及收回的
 * 标记一个手动出口。
 *
 * 点按钮经控制桥发 `sandbox-clean-marks`：主进程弹系统「选择文件夹」（页面
 * 传不进路径），再交给 Harness 的沙箱提供方清理——它知道哪些命令还在用那个
 * 文件夹，这时答「正在使用」而不动。结果读命令应答里 `sandboxClean`，nonce
 * 比点击前大的才算这一次的。
 *
 * 只在 DeepSeekGUI 自己开的 Windows 窗口里存在。
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ControlBridgeClient, SandboxCleanSnapshot } from './bridge.ts'
import { button } from './memory/styles.ts'

/** 注入面：控制桥与平台。默认从页面读，测试可以塞假的。 */
export interface SandboxMarksInjected {
  /** 桌面控制桥；null = 这个页面不是 DeepSeekGUI 开的窗口。 */
  bridge: ControlBridgeClient | null
  /** 是否 Windows（沙箱标记只在 Windows 上存在）。 */
  windows: boolean
}

/** 设置行的 props。 */
export type SandboxMarksRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'deepseekgui.workbench'>
  & SandboxMarksInjected

/** 与开发者模式那一行同一套版式。 */
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
 * 把一次结果写成给人看的一句话。
 * @param result - 应答里的结果。
 * @param t - 文案。
 * @returns 那句话；取消时为 null（安静关掉）。
 */
function outcomeText(result: SandboxCleanSnapshot, t: SandboxMarksRowProps['t']): string | null {
  const inherited = result.root !== null && result.path !== null && result.root !== result.path
  switch (result.status) {
    case 'canceled': return null
    case 'cleaned': return `${t(inherited ? 'sandboxMarks.cleanedInherited' : 'sandboxMarks.cleaned')}${result.root ?? ''}`
    case 'clean': return `${t('sandboxMarks.clean')}${result.path ?? ''}`
    case 'busy': return `${t('sandboxMarks.busy')}${result.root ?? ''}`
    case 'unsupported': return t('sandboxMarks.unsupported')
  }
}

/**
 * 「清理沙箱标记」那一行：说明写在按钮旁边，选文件夹和清理都经桌面主进程。
 * @param props - 控制桥、平台与文案座位。
 * @returns 设置行；不是 DeepSeekGUI 的 Windows 窗口时不渲染。
 */
export function SandboxMarksRow({ bridge, windows, t }: SandboxMarksRowProps) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (bridge === null || !windows) return null
  const clean = (): void => {
    setBusy(true)
    setOutcome(null)
    setError(null)
    bridge.run({ type: 'sandbox-clean-marks' }).then((model) => {
      const result = model.sandboxClean
      setOutcome(result === undefined || result === null ? null : outcomeText(result, t))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      setBusy(false)
    })
  }
  return (
    <div style={rowStyle}>
      <div>
        <div style={titleStyle}>{t('sandboxMarks.title')}</div>
        <div style={descriptionStyle}>{t('sandboxMarks.description')}</div>
        {busy && <div role="status" style={descriptionStyle}>{t('sandboxMarks.pending')}</div>}
        {outcome !== null && <div role="status" style={descriptionStyle}>{outcome}</div>}
        {error !== null && <div role="alert" style={descriptionStyle}>{error}</div>}
      </div>
      <button type="button" style={{ ...button, flexShrink: 0 }} disabled={busy} onClick={clean}>
        {t('sandboxMarks.action')}
      </button>
    </div>
  )
}
