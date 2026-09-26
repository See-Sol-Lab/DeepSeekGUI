/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  reject: '拒绝',
  allowOnce: '允许一次',
  'danger.title': '危险操作：请你来判断',
  'danger.system': '要改动 Windows 系统文件或系统设置',
  'danger.apps': '要改动电脑上已安装程序的本体（Program Files、ProgramData 等）',
  'danger.gui': '要改动 DeepSeekGUI 自己的程序或源代码',
  'danger.elevated': 'DeepSeekGUI 正以管理员身份运行，这次操作不受 Windows 保护',
  'danger.git': '这次操作会改动 .git（版本历史），默认只读',
  'danger.hint': '助手已暂停，等你决定。看不懂这次操作要做什么，就选「拒绝」。',
  'danger.allow': '我了解风险，允许这一次',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  reject: 'Reject',
  allowOnce: 'Allow once',
  'danger.title': 'Dangerous action: your decision',
  'danger.system': 'It would change Windows system files or settings',
  'danger.apps': 'It would change installed program files (Program Files, ProgramData, …)',
  'danger.gui': "It would change DeepSeekGUI's own program or source code",
  'danger.elevated': 'DeepSeekGUI is running as administrator; Windows does not protect this action',
  'danger.git': 'It would change .git (version history), which is read-only by default',
  'danger.hint': 'The assistant is paused until you decide. If you are not sure what this does, reject it.',
  'danger.allow': 'I understand the risk, allow once',
} satisfies Record<ApprovalKey, string>
