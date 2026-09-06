/** `deepseekgui.workbench` namespace dictionaries: desktop-action controls. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'actions.bridge.error': '无法连接 DeepSeekGUI 桌面控制通道',
  'status.idle': '未运行',
  'status.stopping': '正在停止',
  'status.starting': '正在启动',
  'status.switching': '正在切换',
  'status.recovering': '正在恢复',
  'status.running': '运行中',
  'status.recovered': '已恢复',
  'status.failed': '启动失败',
} as const

/** The workbench namespace key union. */
export type WorkbenchKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'actions.bridge.error': 'Cannot reach the DeepSeekGUI desktop control channel',
  'status.idle': 'Not running',
  'status.stopping': 'Stopping',
  'status.starting': 'Starting',
  'status.switching': 'Switching',
  'status.recovering': 'Recovering',
  'status.running': 'Running',
  'status.recovered': 'Recovered',
  'status.failed': 'Start failed',
} satisfies Record<WorkbenchKey, string>
