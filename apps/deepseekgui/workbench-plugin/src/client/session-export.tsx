/**
 * 会话导出为 Markdown（B8-P1，2026-09-28 指令）：官方 0.1.7 的会话行菜单
 * 里有下载 ZIP 日志的入口，但没有给人读的导出。这一项加在同一条行菜单
 * 上，对**所有**会话出现——导出是只读动作，不挑会话状态。
 *
 * 渲染与落盘分在两侧：Harness 侧的 workbenchInspector/exportMarkdown 读
 * 权威会话记录并渲染（进行中的会话最新几条可能还没写盘）；桌面的
 * session-export-markdown 命令弹系统「另存为」并写盘。保存路径只能来自
 * 那个对话框，页面传不进路径——所以和删除一样，这一组组件只在
 * DeepSeekGUI 自己开的窗口里存在（控制桥在页面 URL query 里）。
 *
 * 菜单项点完菜单就没了，对话框因此挂在 shell.overlay 上：它要活得比它
 * 所在的那个菜单久。两者之间靠这个模块里的一个待导出槽位通信。
 */
import { useState, useSyncExternalStore } from 'react'
import {
  Button, Checkbox, IconDownloadOutlineRegular, MenuItemButton, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseControlBridge } from './bridge.ts'

/** 一次导出请求：对话框要显示会话标题，所以和 id 一起带上。 */
interface PendingExport {
  sessionId: SessionId
  title: string
}

let pending: PendingExport | null = null
const listeners = new Set<() => void>()

/** 待导出槽位：菜单项写、对话框读，同一个页面里只会有一个。 */
const pendingStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  snapshot(): PendingExport | null { return pending },
  set(next: PendingExport | null): void {
    pending = next
    for (const listener of listeners) listener()
  },
}

/** 一次导出的结果（桌面命令应答里的 `sessionExport`）。 */
export interface SessionExportOutcome {
  /** 用户在另存为对话框里点了取消。 */
  canceled: boolean
  /** 保存成功的绝对路径；取消为 null。 */
  path: string | null
}

/**
 * 导出通道：解析成功就能导出，失败抛错——调用方要能看见失败。
 * @param sessionId - 要导出的会话 id。
 * @param includeDetails - 是否包含工具调用与思考过程。
 * @returns 取消（canceled）或保存路径。
 */
export type SessionExporter = (sessionId: string, includeDetails: boolean) => Promise<SessionExportOutcome>

/**
 * 读出当前页面能用的会话导出通道。
 * @returns 导出函数；当前页面不是 DeepSeekGUI 开的时返回 null。
 */
export function readSessionExporter(): SessionExporter | null {
  if (typeof window === 'undefined') return null
  const address = parseControlBridge(window.location.search)
  if (address === null) return null
  return async (sessionId: string, includeDetails: boolean): Promise<SessionExportOutcome> => {
    const response = await fetch(`http://127.0.0.1:${address.port}/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': address.token },
      body: JSON.stringify({ command: { type: 'session-export-markdown', sessionId, includeDetails } }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown }
      throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
    }
    const body = await response.json().catch(() => ({})) as {
      model?: { sessionExport?: { canceled?: unknown; path?: unknown } }
    }
    const outcome = body.model?.sessionExport
    // 命令应答的模型里必须带着这次导出的结果；形状不符按失败处理。
    if (outcome === undefined || typeof outcome.canceled !== 'boolean'
      || (outcome.path !== null && typeof outcome.path !== 'string')) {
      throw new Error('session export: the desktop returned no result')
    }
    return { canceled: outcome.canceled, path: outcome.path }
  }
}

/** 注入面：导出通道本身。默认从页面 URL 读桥，测试可以塞一个假的。 */
export interface ExportSessionInjected {
  /** 导出一个会话；null = 这个页面导不了（不是 DeepSeekGUI 窗口）。 */
  exporter: SessionExporter | null
}

/** 行菜单项的 props。 */
export type ExportSessionMenuItemProps =
  PropsRuntime<'sidebar.workspaces.session.menu.item'>
  & PropsLocale<'deepseekgui.workbench'>
  & ExportSessionInjected

/**
 * 行菜单项：对所有会话出现；导出只读，不挑归档状态。
 * @param props - 行的 owner 份额、菜单开合状态、文案座位与导出通道。
 * @returns 菜单里的一行；不适用时不渲染。
 */
export function ExportSessionMenuItem({
  sessionId, displayTitle, useMenuOpenState, exporter, t,
}: ExportSessionMenuItemProps) {
  const [, setMenuOpen] = useMenuOpenState()
  if (exporter === null) return null
  return (
    <MenuItemButton
      icon={<IconDownloadOutlineRegular size={14} />}
      onSelect={() => {
        setMenuOpen(false)
        pendingStore.set({ sessionId, title: displayTitle })
      }}
    >
      {t('sessionExport.menu')}
    </MenuItemButton>
  )
}

/** 导出对话框的 props。 */
export type ExportSessionDialogProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<'deepseekgui.workbench'>
  & ExportSessionInjected

/**
 * shell.overlay 上的导出对话框：没有待导出的会话时什么都不渲染。
 * @param props - 文案座位与导出通道。
 * @returns 打开的对话框，或 null。
 */
export function ExportSessionDialog({ exporter, t }: ExportSessionDialogProps) {
  const request = useSyncExternalStore(pendingStore.subscribe, pendingStore.snapshot, pendingStore.snapshot)
  if (request === null || exporter === null) return null
  return <ExportForm key={request.sessionId} request={request} exporter={exporter} t={t} />
}

/** 一次请求的对话框：空闲 → 导出中 → 成功 / 失败；取消随它一起消失。 */
function ExportForm({ request, exporter, t }: {
  request: PendingExport
  exporter: SessionExporter
  t: ExportSessionDialogProps['t']
}) {
  const [includeDetails, setIncludeDetails] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (exporting) return
    pendingStore.set(null)
  }
  const run = () => {
    setExporting(true)
    setError(null)
    exporter(request.sessionId, includeDetails).then((outcome) => {
      setExporting(false)
      // 用户在另存为里点了取消：正常路径，安静关掉，不报错。
      if (outcome.canceled) {
        pendingStore.set(null)
        return
      }
      setSavedPath(outcome.path)
    }).catch((reason: unknown) => {
      // 失败时对话框留着，原因写在上面，可以再点导出。
      setExporting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('sessionExport.cancel')}
      title={t('sessionExport.title')}
      description={t('sessionExport.desc', { title: request.title })}
      footer={savedPath === null ? (
        <>
          <Button variant="outline" disabled={exporting} onClick={close}>{t('sessionExport.cancel')}</Button>
          <Button variant="outline" disabled={exporting} onClick={run}>{t('sessionExport.action')}</Button>
        </>
      ) : (
        <Button variant="outline" onClick={close}>{t('sessionExport.done')}</Button>
      )}
    >
      {savedPath === null && (
        <Checkbox
          checked={includeDetails}
          onChange={setIncludeDetails}
          disabled={exporting}
          label={t('sessionExport.includeDetails')}
        />
      )}
      {exporting && <div role="status">{t('sessionExport.pending')}</div>}
      {savedPath !== null && (
        <div role="status" style={{ wordBreak: 'break-all' }}>{t('sessionExport.savedTo', { path: savedPath })}</div>
      )}
      {error !== null && <div role="alert">{error}</div>}
    </Modal>
  )
}
