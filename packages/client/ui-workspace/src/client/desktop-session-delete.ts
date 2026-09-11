/**
 * 归档会话的删除通道（DeepSeekGUI）。
 *
 * 官方 harness 里「删除会话」这件事一层都没有：session-persistence 只追加
 * 不删除，workspace registry 管的是一个归档 id 集合，所以归档只是把会话从
 * 侧边栏藏起来，磁盘上一个字节都没少。莉莉丝 2026-09-10 人工验收要的是
 * 归档列表里能真删掉不要的对话，唯一摸得到 Home 文件系统的是 DeepSeekGUI
 * 的主进程，所以这条通道走它的回环控制桥。
 *
 * 桥的地址与一次性凭证在页面 URL 的 query 里（`deepseekgui-control=
 * <port>.<token>`），只有 DeepSeekGUI 自己开的窗口才有——用外部浏览器打开
 * 同一个 harness，这里返回 null，垃圾桶按钮就不会出现。这正是想要的：删盘
 * 上的数据是桌面宿主的权限，不是任何能连上 harness 的页面的权限。
 *
 * 这里重写了一份桥的解析与调用（workbench-plugin 里有同样的十几行），
 * 而不是跨包 import：这个包不该依赖 DeepSeekGUI 的产品插件。等上游哪天
 * 有了正规的会话删除 RPC，把 `readSessionDeleter` 的实现换成那一行就行，
 * 用它的组件一个字都不用改。
 */

/** 一次删除：解析成功就删，失败抛错——调用方要能看见失败。 */
export type SessionDeleter = (sessionId: string) => Promise<void>

/**
 * 读出当前页面能用的会话删除通道。
 *
 * @returns 删除函数，或 null——当前页面不是 DeepSeekGUI 开的。
 */
export function readSessionDeleter(): SessionDeleter | null {
  if (typeof window === 'undefined') return null
  const match = /[?&]deepseekgui-control=([^&#]+)/.exec(window.location.search)
  if (match === null) return null
  const value = decodeURIComponent(match[1] ?? '')
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const port = value.slice(0, dot)
  const token = value.slice(dot + 1)
  return async (sessionId: string): Promise<void> => {
    const response = await fetch(`http://127.0.0.1:${port}/control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-deepseekgui-control-token': token },
      body: JSON.stringify({ command: { type: 'session-delete', sessionId } }),
    })
    if (response.ok) return
    const body = await response.json().catch(() => ({})) as { error?: unknown }
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
  }
}
