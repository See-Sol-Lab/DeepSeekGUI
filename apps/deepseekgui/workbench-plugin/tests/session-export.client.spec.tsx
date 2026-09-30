// @vitest-environment jsdom
/**
 * B8-P1 会话导出的页面组件：钉住四件事——不是 DeepSeekGUI 窗口就一行不
 * 给、勾选项默认不勾、成功显示保存路径、失败对话框留着并把原因写出来；
 * 用户在另存为里点取消是正常路径，安静关掉不报错。待导出槽位是模块级
 * 状态，每个用例结束前都把对话框收起来，避免串进下一个用例。
 * @module @see-sol-lab/deepseekgui-workbench/tests/session-export
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ExportSessionDialog, ExportSessionMenuItem, type SessionExportOutcome } from '../src/client/session-export.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** 与 locale 座位同一套替换规则：{name} → 值。 */
function tt(key: keyof typeof zh, params?: Record<string, string | number>): string {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

const t = tt as never

const outcome = (canceled: boolean, path: string | null): SessionExportOutcome => ({ canceled, path })
const SAVED = 'C:\\Users\\u\\Downloads\\调试导出-20260928-1502.md'

function mount(exporter: ((sessionId: string, includeDetails: boolean) => Promise<SessionExportOutcome>) | null) {
  const setMenuOpen = vi.fn()
  render(
    <>
      <ExportSessionMenuItem
        sessionId={'s1' as never}
        displayTitle="调试导出"
        useMenuOpenState={(() => [true, setMenuOpen]) as never}
        exporter={exporter}
        t={t}
      />
      <ExportSessionDialog exporter={exporter} t={t} />
    </>,
  )
  return { setMenuOpen }
}

/** 点菜单项打开对话框；返回后对话框已挂上。 */
async function openDialog() {
  fireEvent.click(screen.getByText(zh['sessionExport.menu']))
  await screen.findByText(tt('sessionExport.desc', { title: '调试导出' }))
}

/** 收尾：把还开着的对话框收起来，槽位回到空。角上的关闭钮与页脚「取消」同名，取页脚那个。 */
async function closeDialog() {
  const done = screen.queryByRole('button', { name: zh['sessionExport.done'] })
  const cancels = screen.queryAllByRole('button', { name: zh['sessionExport.cancel'] })
  fireEvent.click(done ?? cancels[cancels.length - 1] as HTMLElement)
  await waitFor(() => { expect(screen.queryByText(tt('sessionExport.desc', { title: '调试导出' }))).toBeNull() })
}

describe('ExportSessionMenuItem', () => {
  it('没有桌面控制桥（外部浏览器打开同一个 harness）时一行都不给', () => {
    mount(null)
    expect(screen.queryByText(zh['sessionExport.menu'])).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('对所有会话出现：导出只读，不挑归档状态', () => {
    mount(vi.fn(async () => outcome(false, SAVED)))
    expect(screen.getByText(zh['sessionExport.menu'])).toBeTruthy()
  })

  it('点一下收起菜单并打开对话框', async () => {
    const { setMenuOpen } = mount(vi.fn(async () => outcome(false, SAVED)))
    fireEvent.click(screen.getByText(zh['sessionExport.menu']))
    expect(setMenuOpen).toHaveBeenCalledWith(false)
    expect(await screen.findByText(tt('sessionExport.desc', { title: '调试导出' }))).toBeTruthy()
    await closeDialog()
  })
})

describe('ExportSessionDialog', () => {
  it('勾选项默认不勾，且能切换', async () => {
    mount(vi.fn(async () => outcome(false, SAVED)))
    await openDialog()
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    await closeDialog()
  })

  it('导出中禁用按钮并显示进度，成功显示保存路径', async () => {
    let resolveExport: (() => void) | null = null
    const exporter = vi.fn((_id: string, _includeDetails: boolean) => new Promise<SessionExportOutcome>((resolve) => {
      resolveExport = () => resolve(outcome(false, SAVED))
    }))
    mount(exporter)
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: zh['sessionExport.action'] }))
    expect(exporter).toHaveBeenCalledWith('s1', false)
    expect(screen.getByRole('status').textContent).toBe(zh['sessionExport.pending'])
    expect(screen.getByRole('button', { name: zh['sessionExport.action'] }).hasAttribute('disabled')).toBe(true)
    resolveExport?.()
    await screen.findByText(tt('sessionExport.savedTo', { path: SAVED }))
    // 成功后按钮变「完成」，点一下对话框收起。
    fireEvent.click(screen.getByRole('button', { name: zh['sessionExport.done'] }))
    await waitFor(() => { expect(screen.queryByText(tt('sessionExport.savedTo', { path: SAVED }))).toBeNull() })
  })

  it('勾选后把开关带给桌面命令', async () => {
    const exporter = vi.fn(async () => outcome(false, SAVED))
    mount(exporter)
    await openDialog()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: zh['sessionExport.action'] }))
    await waitFor(() => { expect(exporter).toHaveBeenCalledWith('s1', true) })
    await closeDialog()
  })

  it('失败时对话框留着，原因写在上面，可以再点导出', async () => {
    const exporter = vi.fn(async () => { throw new Error('Harness 未运行') })
    mount(exporter)
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: zh['sessionExport.action'] }))
    expect((await screen.findByRole('alert')).textContent).toContain('Harness 未运行')
    expect(screen.getByRole('button', { name: zh['sessionExport.action'] })).toBeTruthy()
    await closeDialog()
  })

  it('用户在另存为里点取消：安静关掉，不报错', async () => {
    const exporter = vi.fn(async () => outcome(true, null))
    mount(exporter)
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: zh['sessionExport.action'] }))
    await waitFor(() => { expect(screen.queryByText(tt('sessionExport.desc', { title: '调试导出' }))).toBeNull() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('「取消」按钮直接收起对话框，不发起导出', async () => {
    const exporter = vi.fn(async () => outcome(false, SAVED))
    mount(exporter)
    await openDialog()
    const cancels = screen.getAllByRole('button', { name: zh['sessionExport.cancel'] })
    fireEvent.click(cancels[cancels.length - 1] as HTMLElement)
    await waitFor(() => { expect(screen.queryByText(tt('sessionExport.desc', { title: '调试导出' }))).toBeNull() })
    expect(exporter).not.toHaveBeenCalled()
  })
})
