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
  'firstRun.aria': '首次使用引导',
  'firstRun.workspace': '先选一个文件夹作为工作区：助手只会在这个文件夹里读写。点下面的「选择工作区」开始。',
  'firstRun.model': '先在「设置 → 模型」里填好 DeepSeek API Key（第一次会弹出配置框）。',
  'firstRun.message': '在下面输入框里写下第一句话，说说你想让助手做什么。',
  'firstRun.waiting': '已经发出去了，等助手回复。',
  'firstRun.approval': '助手想执行 {tool}，需要你决定。「这次允许」只对这一条生效；「以后允许」会让它在这个工作区自动执行同类操作。',
  'firstRun.skip': '跳过',
  'firstRun.completed': '已完成',
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
  'firstRun.aria': 'First-run guide',
  'firstRun.workspace': 'Pick a folder as your workspace first: the assistant only reads and writes inside it. Choose workspace below to start.',
  'firstRun.model': 'Add your DeepSeek API key under Settings → Models (the setup box appears on first launch).',
  'firstRun.message': 'Write your first message below and describe what you want the assistant to do.',
  'firstRun.waiting': 'Sent — waiting for the assistant to reply.',
  'firstRun.approval': 'The assistant wants to run {tool} and needs your decision. "Allow once" covers this one call; "always allow" lets it run this kind of action in this workspace automatically.',
  'firstRun.skip': 'Skip',
  'firstRun.completed': 'Completed',
} satisfies Record<WorkbenchKey, string>
