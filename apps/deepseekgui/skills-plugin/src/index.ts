// DeepSeekGUI 技能管理器插件的 Host 面（B7-P4/P5）：宿主侧没有工作——
// 技能库的读取、审阅、落盘、项目选择与过滤 provider 全部在
// `@deepseek-ai/dsh-skill-manager` 服务里（由 web-app bundle 挂载），这个包
// 只带浏览器侧的设置分区与项目管理视图。保留一个空的 apply 是 loader 行的
// 最小形状。
import type { Context } from '@deepseek-ai/cordis'

/** Host entry: nothing to register on this side. */
export function apply(_ctx: Context): void {}
