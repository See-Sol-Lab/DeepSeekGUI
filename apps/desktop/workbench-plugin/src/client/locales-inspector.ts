/**
 * `deepseekgui.inspector` namespace dictionaries: the four DeepSeekGUI
 * conversation views (Changes / Git / Worktree / Memory) that sit beside the
 * official Chat and Trajectory tabs (D5, 2026-09-06). The zh dictionary is
 * the key-set source of truth.
 *
 * Product rule (D10): the Git and Worktree views only display. Every write
 * (commit, push, branch, worktree) goes back to the conversation, where the
 * assistant asks first and the official approval gate applies.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // View tab labels beside 对话 / 轨迹.
  'view.changes': '改动',
  'view.git': 'Git',
  'view.worktree': '并行工作区',
  'view.memory': '记忆',
  // Shared chrome.
  'common.refresh': '刷新',
  'common.loading': '正在读取…',
  'common.failed': '读取失败：',
  'common.openWorkspace': '打开资源管理器',
  'common.openWorkspaceTitle': '在资源管理器中打开整个工作区',
  'common.noDesktop': '当前不在 DeepSeekGUI 桌面窗口内，打开文件管理器不可用。',
  // Changes view (file level, this workspace).
  'changes.branch': '分支',
  'changes.clean': '工作区干净，助手没有改过任何文件',
  'changes.group.staged': '将提交',
  'changes.group.unstaged': '已改动、未选入提交',
  'changes.group.untracked': '新文件',
  'changes.group.conflict': '冲突',
  'changes.reveal': '定位',
  'changes.revealTitle': '在资源管理器中定位这个文件',
  'changes.copyPath': '复制路径',
  'changes.copied': '已复制',
  'changes.back': '返回改动列表',
  'changes.noPatch': '没有可显示的文本差异（文件可能为二进制）',
  'changes.scope': '只显示改了什么。要提交、丢弃或撤销，回到对话里告诉助手。',
  // Git view (repository level, display only).
  'git.head': '当前分支',
  'git.detached': '（游离 HEAD）',
  'git.unborn': '（还没有任何提交）',
  'git.upstream': '远端分支',
  'git.noUpstream': '这个分支还没有对应的远端分支（还没推送过）',
  'git.ahead': '本地比远端多 {count} 个提交',
  'git.behind': '本地比远端少 {count} 个提交',
  'git.inSync': '与远端一致',
  'git.remotes': '远端',
  'git.noRemotes': '这个仓库没有配置远端',
  'git.commits': '最近的提交',
  'git.noCommits': '还没有提交',
  'git.history': '本会话的提交 / 推送 / PR',
  'git.historyEmpty': '这个会话还没有提交、推送或 PR 操作',
  'git.scope': '只显示仓库现状和本会话做过什么。要提交、推送或建分支，回到对话里告诉助手，它会先问你再做。',
  // Worktree view (parallel work trees, display only).
  'worktree.only': '当前只有主工作区，没有并行工作区',
  'worktree.hint': '想让另一个助手在同一仓库里各干各的，可以在对话里说"开一个并行工作区"，它会在另一个文件夹里建一个新分支。',
  'worktree.current': '当前会话在这里',
  'worktree.branch': '分支',
  'worktree.changed': '{count} 个文件有改动',
  'worktree.clean': '没有改动',
  'worktree.overlap': '注意：{path} 在多个工作区里都被改了，合并时会撞车',
  'worktree.scope': '只显示有哪些并行工作区、各在哪个分支、改了什么。新建、合并、删除都回到对话里告诉助手。',
  // Memory view (project memory only; global memory lives in Settings).
  // D20 copy (莉莉丝 2026-09-06): what to record and what the person can do, first.
  'memory.title': '项目记忆',
  'memory.guide1': '记录这个项目的背景、已确认的决定和需要延续的信息，方便后续对话接着工作。',
  'memory.guide2': '你可以打开文件手动修改，也可以让助手整理。',
  'memory.empty': '当前项目还没有记忆',
  'memory.emptyHint': '助手在对话中遇到值得延续的信息时，会在项目文件夹里创建 {file}。',
  'memory.truncated': '记忆文件已超过 {max} 字，这里只显示前 {max} 字；完整内容请打开文件查看，也可以让助手精简。',
  'memory.open': '在文件管理器中打开',
  'memory.ask': '让助手整理记忆',
  'memory.askTitle': '让助手把这次对话里值得延续的内容总结进项目记忆，并整理过时或重复的条目。',
  'memory.prompt': '请整理本项目的记忆文件 {file}：先读现有内容（没有就新建）；把这个窗口到目前为止关于本项目的、值得延续的信息——项目背景、已确认的决定、约定、踩过的坑——提炼后合并进去；顺手去掉过时和重复的条目。写完后告诉我新增了什么、改了什么。',
  'memory.globalNav': '希望在不同项目中都记住的信息，可前往「设置 → 全局记忆」。',
  'memory.aboutTitle': '关于项目记忆',
  'memory.aboutLocation': '文件位置：{path}',
  'memory.aboutRoles': '与 AGENTS.md 的区别：AGENTS.md 是你写给助手的项目规矩——怎么做事；项目记忆是助手积累的事实——这个项目的具体情况。',
  'memory.aboutGit': '记忆文件在项目目录内，可能随项目一起提交；要不要加进 .gitignore 由你决定，DeepSeekGUI 不会替你改仓库文件。',
  'memory.createAgents': '为这个项目生成 AGENTS.md',
  'memory.createAgentsTitle': '把一份通用的项目协作指引写进项目文件夹；已有 AGENTS.md 时不会覆盖。',
  'memory.agentsExists': '项目已有 AGENTS.md。',
  'memory.openAgents': '打开 AGENTS.md',
  // Path click (D6): code spans that look like workspace paths.
  'paths.reveal': '在资源管理器中定位',
  // Row provenance annotation.
  'row.atTime': '{tool} · {time} · seq {seq}',
} as const

/** The inspector namespace key union. */
export type InspectorKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'view.changes': 'Changes',
  'view.git': 'Git',
  'view.worktree': 'Worktrees',
  'view.memory': 'Memory',
  'common.refresh': 'Refresh',
  'common.loading': 'Reading…',
  'common.failed': 'Read failed:',
  'common.openWorkspace': 'Open in file manager',
  'common.openWorkspaceTitle': 'Open the whole workspace in the system file manager',
  'common.noDesktop': 'Not inside a DeepSeekGUI desktop window: opening the file manager is unavailable.',
  'changes.branch': 'Branch',
  'changes.clean': 'Working tree clean; the assistant has not changed any file',
  'changes.group.staged': 'Will be committed',
  'changes.group.unstaged': 'Changed, not selected for commit',
  'changes.group.untracked': 'New files',
  'changes.group.conflict': 'Conflicts',
  'changes.reveal': 'Reveal',
  'changes.revealTitle': 'Reveal this file in the file manager',
  'changes.copyPath': 'Copy path',
  'changes.copied': 'Copied',
  'changes.back': 'Back to changes',
  'changes.noPatch': 'No text patch available (the file may be binary)',
  'changes.scope': 'Shows what changed. To commit, discard, or revert, tell the assistant in the conversation.',
  'git.head': 'Current branch',
  'git.detached': '(detached HEAD)',
  'git.unborn': '(no commits yet)',
  'git.upstream': 'Remote branch',
  'git.noUpstream': 'This branch has no remote branch yet (never pushed)',
  'git.ahead': 'Local is {count} commit(s) ahead of the remote',
  'git.behind': 'Local is {count} commit(s) behind the remote',
  'git.inSync': 'In sync with the remote',
  'git.remotes': 'Remotes',
  'git.noRemotes': 'This repository has no remote configured',
  'git.commits': 'Recent commits',
  'git.noCommits': 'No commits yet',
  'git.history': 'Commits / pushes / PRs in this session',
  'git.historyEmpty': 'No commit, push, or PR operation in this session yet',
  'git.scope': 'Shows the repository state and what this session did. To commit, push, or branch, tell the assistant in the conversation; it asks before acting.',
  'worktree.only': 'Only the main work tree; no parallel work trees',
  'worktree.hint': 'To let another assistant work on the same repository separately, ask in the conversation to "open a parallel work tree"; it creates a new branch in another folder.',
  'worktree.current': 'This session is here',
  'worktree.branch': 'Branch',
  'worktree.changed': '{count} file(s) changed',
  'worktree.clean': 'No changes',
  'worktree.overlap': 'Warning: {path} is changed in more than one work tree; merging will conflict',
  'worktree.scope': 'Shows which parallel work trees exist, their branches, and what changed. Creating, merging, and removing go through the conversation.',
  'memory.title': 'Project memory',
  'memory.guide1': 'Records this project\'s background, confirmed decisions, and anything later conversations should carry forward.',
  'memory.guide2': 'You can open the file and edit it yourself, or ask the assistant to tidy it.',
  'memory.empty': 'This project has no memory yet',
  'memory.emptyHint': 'When something worth carrying forward comes up in a conversation, the assistant creates {file} in the project folder.',
  'memory.truncated': 'The memory file exceeds {max} characters; only the first {max} are shown here. Open the file for the rest, or ask the assistant to condense it.',
  'memory.open': 'Open in file manager',
  'memory.ask': 'Ask the assistant to tidy the memory',
  'memory.askTitle': 'Ask the assistant to distill what this conversation established into the project memory and tidy stale or duplicate entries.',
  'memory.prompt': 'Tidy this project\'s memory file {file}: read what is there (create it if missing); distill what this window has established about the project so far — background, confirmed decisions, conventions, pitfalls — and merge it in; drop stale or duplicate entries along the way. When done, tell me what was added and what changed.',
  'memory.globalNav': 'Information to remember across projects goes under Settings → Global memory.',
  'memory.aboutTitle': 'About project memory',
  'memory.aboutLocation': 'File location: {path}',
  'memory.aboutRoles': 'Difference from AGENTS.md: AGENTS.md is the project rules you write for the assistant — how to work here. Project memory holds facts the assistant accumulated — what is actually true about this project.',
  'memory.aboutGit': 'The memory file lives inside the project directory and may be committed; whether to add it to .gitignore is your call — DeepSeekGUI never modifies your repository files.',
  'memory.createAgents': 'Generate AGENTS.md for this project',
  'memory.createAgentsTitle': 'Writes a generic project collaboration guide into the project folder; an existing AGENTS.md is never overwritten.',
  'memory.agentsExists': 'This project already has an AGENTS.md.',
  'memory.openAgents': 'Open AGENTS.md',
  'paths.reveal': 'Reveal in file manager',
  'row.atTime': '{tool} · {time} · seq {seq}',
} satisfies Record<InspectorKey, string>

/** The inspector namespace registered by this plugin. */
export const NS_INSPECTOR = 'deepseekgui.inspector'
