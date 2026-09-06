/**
 * `deepseekgui.tools` namespace dictionaries: tool-result card copy (B5-P5).
 * The zh dictionary is the key-set source of truth; en mirrors it exactly.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Row lifecycle states (visually hidden status copy for the color dots).
  'row.running': '执行中',
  'row.succeeded': '成功',
  'row.failed': '失败',
  'row.stopped': '已中断',
  // Git/pr card titles (short labels; the wire tool name stays on the row).
  'title.gitStatus': 'Git 状态',
  'title.gitDiff': 'Git 差异',
  'title.gitStage': 'Git 暂存',
  'title.gitUnstage': 'Git 取消暂存',
  'title.gitRevert': 'Git 还原',
  'title.gitCommit': 'Git 提交',
  'title.gitPushPreview': '推送预览',
  'title.gitPush': 'Git 推送',
  'title.prAvailability': 'PR 可用性',
  'title.prExisting': 'PR 查重',
  'title.prCreate': '创建 PR',
  'title.browser': '浏览器',
  // Expansion disclosure sections.
  'section.output': '完整输出',
  'section.arguments': '调用参数',
  'summary.noOutput': '（无文本输出）',
  'row.binary': '（二进制）',
  'changes.counts': '已暂存 {staged} · 未暂存 {unstaged} · 未跟踪 {untracked} · 冲突 {conflict}',
  'diff.stat': '{files} 个文件 · +{added} −{deleted}',
  'list.more': '（其余 {count} 项）',
  // Human-input form labels (B5-P5): opened from the current card.
  'form.commitAction': '以新消息提交已暂存内容…',
  'form.pushAction': '推送分支…',
  'form.prAction': '为该分支创建 PR…',
  'form.send': '发送给助手',
  'form.commitTitle': '提交更改',
  'form.commitMessageLabel': '提交信息（助手将先 git_stage 必要路径再 git_commit）',
  'form.commitMessagePlaceholder': 'feat: 描述这次提交…',
  'form.pushTitle': '推送分支',
  'form.remoteLabel': '远端',
  'form.localBranchLabel': '本地分支',
  'form.remoteBranchLabel': '远端分支',
  'form.prTitleLabel': 'PR 标题',
  'form.prTitlePlaceholder': 'PR 标题…',
  'form.prBodyLabel': 'PR 描述',
  'form.prBodyPlaceholder': 'PR 描述…',
  'form.baseLabel': '目标分支（base）',
  'form.headLabel': '来源分支（head）',
  'form.draftLabel': '先创建为草稿',
  'form.sendHint': '将作为一条消息发送给助手执行；写操作仍会弹出官方审批（审批理由含此处内容）。',
  // Agent instructions composed by the forms (model-visible user messages).
  'instruction.commit': '请提交当前更改：先把必要路径加入暂存（git_stage），再执行 git_commit。提交信息（用户已在卡片上确认）：\n{message}',
  'instruction.push': '请执行 git_push：remote={remote}，localBranch={localBranch}，remoteBranch={remoteBranch}。',
  'instruction.pr': '请执行 pr_create：\ntitle={title}\nbody={body}\nbase={base}\nhead={head}\ndraft={draft}',
  'instruction.draftYes': '是',
  'instruction.draftNo': '否',
} as const

/** The tools namespace key union. */
export type ToolsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'row.running': 'Running',
  'row.succeeded': 'Succeeded',
  'row.failed': 'Failed',
  'row.stopped': 'Stopped',
  'title.gitStatus': 'Git status',
  'title.gitDiff': 'Git diff',
  'title.gitStage': 'Git stage',
  'title.gitUnstage': 'Git unstage',
  'title.gitRevert': 'Git revert',
  'title.gitCommit': 'Git commit',
  'title.gitPushPreview': 'Push preview',
  'title.gitPush': 'Git push',
  'title.prAvailability': 'PR availability',
  'title.prExisting': 'PR lookup',
  'title.prCreate': 'Create PR',
  'title.browser': 'Browser',
  'section.output': 'Full output',
  'section.arguments': 'Arguments',
  'summary.noOutput': '(no text output)',
  'row.binary': '(binary)',
  'changes.counts': 'staged {staged} · unstaged {unstaged} · untracked {untracked} · conflict {conflict}',
  'diff.stat': '{files} files · +{added} −{deleted}',
  'list.more': '(+{count} more)',
  'form.commitAction': 'Commit the staged content with a new message…',
  'form.pushAction': 'Push a branch…',
  'form.prAction': 'Create a PR for this branch…',
  'form.send': 'Send to assistant',
  'form.commitTitle': 'Commit changes',
  'form.commitMessageLabel': 'Commit message (the assistant stages the needed paths with git_stage, then runs git_commit)',
  'form.commitMessagePlaceholder': 'feat: describe this commit…',
  'form.pushTitle': 'Push branch',
  'form.remoteLabel': 'Remote',
  'form.localBranchLabel': 'Local branch',
  'form.remoteBranchLabel': 'Remote branch',
  'form.prTitleLabel': 'PR title',
  'form.prTitlePlaceholder': 'PR title…',
  'form.prBodyLabel': 'PR body',
  'form.prBodyPlaceholder': 'PR body…',
  'form.baseLabel': 'Base branch',
  'form.headLabel': 'Head branch',
  'form.draftLabel': 'Create as draft first',
  'form.sendHint': 'Sent to the assistant as one message; writes still raise the official approval prompt (its reason carries this content).',
  'instruction.commit': 'Commit the current changes: first stage the needed paths with git_stage, then run git_commit. Commit message (confirmed by the user on the card):\n{message}',
  'instruction.push': 'Run git_push: remote={remote}, localBranch={localBranch}, remoteBranch={remoteBranch}.',
  'instruction.pr': 'Run pr_create:\ntitle={title}\nbody={body}\nbase={base}\nhead={head}\ndraft={draft}',
  'instruction.draftYes': 'yes',
  'instruction.draftNo': 'no',
} satisfies Record<ToolsKey, string>

/** The tool-result card namespace registered by this plugin. */
export const NS_TOOLS = 'deepseekgui.tools'
