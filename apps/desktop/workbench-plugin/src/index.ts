// DeepSeekGUI Workbench 插件的 Host 面（B5-P7）：除浏览器侧 UI 外，承载
// DeepSeekGUI 记忆的装配注入——两份扁平 memory.md（全局用户编辑/模型只读、
// 项目内模型经普通 fs 工具维护）加行为契约，经官方 system-prompt seam 在
// 每次会话开窗时注入一次，内容随 Session log 可追溯。注册逻辑与纯文本
// 构建见 session-memory.ts。
import type { Context } from '@deepseek-ai/cordis'
import { anchorHiddenConsole } from './console-anchor.ts'
import { registerMemoryContext } from './session-memory.ts'

/** Required Host services: the system-prompt registry. */
export const inject = ['systemPrompt']

/**
 * Host entry: anchor a hidden console for tool children (D21, Windows) and
 * register the DeepSeekGUI memory context contribution.
 * @param ctx - plugin host context.
 */
export function apply(ctx: Context): void {
  // Before the first tool child spawns: with no console of its own, the
  // Electron-hosted Harness would hand every sandboxed pwsh a fresh visible
  // window. Outcome is diagnostic only; a failure changes nothing else.
  void anchorHiddenConsole()
  registerMemoryContext(ctx)
}
