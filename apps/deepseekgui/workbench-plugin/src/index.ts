// DeepSeekGUI Workbench 插件的 Host 面（B5-P7）：除浏览器侧 UI 外，承载
// DeepSeekGUI 记忆的装配注入——两份扁平 memory.md（全局用户编辑/模型只读、
// 项目内模型经普通 fs 工具维护）加行为契约，经官方 system-prompt seam 在
// 每次会话开窗时注入一次，内容随 Session log 可追溯。注册逻辑与纯文本
// 构建见 session-memory.ts。
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { anchorHiddenConsole } from './console-anchor.ts'
import { registerMemoryContext } from './session-memory.ts'
import { registerModelSight } from './model-sight.ts'

/** Required Host services: the system-prompt registry. */
export const inject = ['systemPrompt']

/**
 * Host entry: anchor a hidden console for tool children (D21, Windows),
 * register the DeepSeekGUI memory context contribution, and — once the LLM
 * runtime is up — the per-step "can this model see images" note (#24).
 * @param ctx - plugin host context.
 */
export function apply(ctx: Context): void {
  // Before the first tool child spawns: with no console of its own, the
  // Electron-hosted Harness would hand every sandboxed pwsh a fresh visible
  // window. Outcome is diagnostic only; a failure changes nothing else.
  void anchorHiddenConsole()
  registerMemoryContext(ctx)
  // Optional dependency: memory injection must not wait for the LLM runtime
  // (compositions and tests without one still get the memory section).
  ctx.inject(['llm'], (llmCtx) => { registerModelSight(llmCtx, llmCtx.llm) })
}
