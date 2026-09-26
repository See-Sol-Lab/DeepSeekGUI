// @vitest-environment jsdom
/**
 * 删除会话（住户 2026-09-22）：官方 0.1.7 的会话行菜单没有删除，我们把它
 * 加回那条菜单。这份 spec 钉住三件事：只对已归档的行出现、没有桌面控制桥
 * 就完全不出现（外部浏览器里删不了盘上的数据）、以及删除失败必须看得见。
 * @module @see-sol-lab/deepseekgui-workbench/tests/session-delete
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeleteSessionDialog, DeleteSessionMenuItem } from '../src/client/session-delete.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof zh, params?: Record<string, string | number>) => {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}) as never

function mount(options: { archived: boolean; deleteSession?: ((id: string) => Promise<void>) | null }) {
  const setMenuOpen = vi.fn()
  const deleteSession = options.deleteSession === undefined ? vi.fn(async () => undefined) : options.deleteSession
  const useWorkspaces = ((select: (snapshot: unknown) => unknown) =>
    select({ archivedSessionIds: options.archived ? ['s1'] : [] })) as never
  render(
    <>
      <DeleteSessionMenuItem
        sessionId={'s1' as never}
        displayTitle="打个招呼"
        useMenuOpenState={(() => [true, setMenuOpen]) as never}
        useWorkspaces={useWorkspaces}
        deleteSession={deleteSession}
        t={t}
      />
      <DeleteSessionDialog deleteSession={deleteSession} t={t} />
    </>,
  )
  return { deleteSession, setMenuOpen }
}

describe('DeleteSessionMenuItem', () => {
  it('只对已归档的会话出现：归档是「我不要它了」，删除是同一条路的终点', () => {
    mount({ archived: false })
    expect(screen.queryByText(zh['sessionDelete.menu'])).toBeNull()
    cleanup()
    mount({ archived: true })
    expect(screen.getByText(zh['sessionDelete.menu'])).toBeTruthy()
  })

  it('没有桌面控制桥（外部浏览器打开同一个 harness）时一行都不给', () => {
    mount({ archived: true, deleteSession: null })
    expect(screen.queryByText(zh['sessionDelete.menu'])).toBeNull()
  })

  it('点一下先收起菜单并问一句，确认之后才真删', async () => {
    const { deleteSession, setMenuOpen } = mount({ archived: true })
    fireEvent.click(screen.getByText(zh['sessionDelete.menu']))
    expect(setMenuOpen).toHaveBeenCalledWith(false)
    expect(await screen.findByText(zh['sessionDelete.warning'])).toBeTruthy()
    expect(deleteSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh['sessionDelete.action'] }))
    await waitFor(() => { expect(deleteSession).toHaveBeenCalledWith('s1') })
    // 成功后对话框收起：行随会话列表消失，这里不记「删过谁」。
    await waitFor(() => { expect(screen.queryByText(zh['sessionDelete.warning'])).toBeNull() })
  })

  it('删除失败时对话框留着，原因写在上面', async () => {
    const deleteSession = vi.fn(async () => { throw new Error('Harness 未运行') })
    mount({ archived: true, deleteSession })
    fireEvent.click(screen.getByText(zh['sessionDelete.menu']))
    fireEvent.click(await screen.findByRole('button', { name: zh['sessionDelete.action'] }))
    expect((await screen.findByRole('alert')).textContent).toContain('Harness 未运行')
    expect(screen.getByText(zh['sessionDelete.warning'])).toBeTruthy()
  })

  it('取消不删', async () => {
    const { deleteSession } = mount({ archived: true })
    fireEvent.click(screen.getByText(zh['sessionDelete.menu']))
    fireEvent.click(await screen.findByRole('button', { name: zh['sessionDelete.cancel'] }))
    await waitFor(() => { expect(screen.queryByText(zh['sessionDelete.warning'])).toBeNull() })
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
