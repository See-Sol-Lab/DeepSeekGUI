/**
 * Self-drawn tray menu 的窄 preload：只暴露具名 deepseekGUITray API。菜单
 * 行经 main 推送（带位置 id），激活只回传 id——动作从不跨 IPC，main 用 id
 * 反查模板自己的 action。sandbox: true 下 preload 必须是 CommonJS。
 * @module @see-sol-lab/deepseekgui/chrome/tray-preload
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('deepseekGUITray', {
  /** 订阅菜单推送：每次托盘打开都会推一份新的行与主题。 */
  onMenu: (listener: (payload: unknown) => void): void => {
    ipcRenderer.on('deepseekgui-tray:menu', (_event: unknown, payload: unknown) => { listener(payload) })
  },
  /** 页面量好自己的高度后告诉 main，由 main 定位并显示窗口。 */
  reportSize: (height: number): void => { ipcRenderer.send('deepseekgui-tray:size', height) },
  /** 激活一行（位置 id）。 */
  activate: (id: string): void => { ipcRenderer.send('deepseekgui-tray:activate', id) },
  /** 关闭菜单（Esc / 点空白）。 */
  close: (): void => { ipcRenderer.send('deepseekgui-tray:close') },
})
