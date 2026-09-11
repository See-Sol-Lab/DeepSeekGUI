/**
 * `deepseekgui.notify` namespace dictionaries: desktop-notification copy
 * assembled by the B5-P6 web-side event consumer. The zh dictionary is the
 * key-set source of truth; en mirrors it exactly.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'kind.approval.title': '需要审批',
  'kind.question.title': '助手在询问',
  'kind.job.completed.title': '后台工作完成',
  'kind.job.failed.title': '后台工作失败',
  // Body fragment for a pending approval: tool · reason/说明（可能为空）。
  'body.approval': '{tool} · {reason}',
  'body.approval.noReason': '{tool}（无说明）',
  // Body fragment for a pending question: 首问文本（可能为空时退化为计数）。
  'body.question': '{first}',
  'body.question.empty': '（共 {count} 个问题）',
  // Body fragment for a job transition: label · kind。
  'body.job': '{label} · {kind}',
} as const

/** The notify namespace key union. */
export type NotifyKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'kind.approval.title': 'Approval needed',
  'kind.question.title': 'Assistant is asking',
  'kind.job.completed.title': 'Background job finished',
  'kind.job.failed.title': 'Background job failed',
  'body.approval': '{tool} · {reason}',
  'body.approval.noReason': '{tool} (no reason given)',
  'body.question': '{first}',
  'body.question.empty': '({count} questions)',
  'body.job': '{label} · {kind}',
} satisfies Record<NotifyKey, string>

/** The desktop-notification namespace registered by this plugin. */
export const NS_NOTIFY = 'deepseekgui.notify'
