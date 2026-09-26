/**
 * Release 链接的安全闸（B7-P2 的幸存者）。
 *
 * B7-P2 曾在这里放一整套受限 Markdown 解析器，把 release notes 渲染进更新
 * 面板；R10（2026-09-14 人工验收）改为「新功能」跳外部 Release 页后解析器
 * 整体退役，只留这一个双消费者（更新面板的发布页链接与 control-model 的
 * releasePageUrl 判定）都在用的安全函数。
 * 纯模块：不依赖 DOM 也不依赖 Node。
 * @module @see-sol-lab/deepseekgui/release-notes
 */

/**
 * 只有 https 且不带凭据的绝对 URL 才成为可点链接；其余（http、页内锚点、
 * javascript:、相对路径）降级为文本。
 * @param href - 链接目标原文。
 * @returns 规范化后的 URL，或 null。
 */
export function safeReleaseLink(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  if (href.length > 2048) return null
  return url.toString()
}
