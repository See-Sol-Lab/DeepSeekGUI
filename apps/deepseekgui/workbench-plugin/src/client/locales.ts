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
  'sessionDelete.menu': '删除会话',
  'sessionDelete.title': '删除这个会话？',
  'sessionDelete.desc': '「{title}」的对话记录和日志会从磁盘上删除。',
  'sessionDelete.warning': '删除后无法恢复。',
  'sessionDelete.action': '删除',
  'sessionDelete.cancel': '取消',
  'sessionDelete.close': '关闭',
  'sessionDelete.pending': '正在删除…',
  // Settings → 已归档的会话（住户 2026-09-23 要回来的设置页）。
  'archived.nav': '已归档的会话',
  'archived.hint': '归档的会话不显示在侧栏分组里，对话记录和所在工作区都保留。',
  'archived.empty': '还没有归档过的会话。在侧栏会话的菜单里选「归档」，它就会收到这里。',
  'archived.restoreOpen': '恢复并打开',
  'archived.ungrouped': '未分组',
  'archived.deleting': '正在删除；如果会话还在回复，会等这一轮回复和工具执行结束。',
  'archived.failed': '操作失败：',
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
  'sessionDelete.menu': 'Delete session',
  'sessionDelete.title': 'Delete this session?',
  'sessionDelete.desc': 'The conversation and logs of “{title}” are erased from disk.',
  'sessionDelete.warning': 'This cannot be undone.',
  'sessionDelete.action': 'Delete',
  'sessionDelete.cancel': 'Cancel',
  'sessionDelete.close': 'Close',
  'sessionDelete.pending': 'Deleting…',
  'archived.nav': 'Archived sessions',
  'archived.hint': 'Archived sessions are hidden from the sidebar groups; their conversation and workspace are kept.',
  'archived.empty': 'No sessions are archived yet. Choose “Archive” in a session’s sidebar menu to put it here.',
  'archived.restoreOpen': 'Restore and open',
  'archived.ungrouped': 'Ungrouped',
  'archived.deleting': 'Deleting; if the session is still replying, deletion waits for its current reply and tool work to finish.',
  'archived.failed': 'Action failed: ',
} satisfies Record<WorkbenchKey, string>
