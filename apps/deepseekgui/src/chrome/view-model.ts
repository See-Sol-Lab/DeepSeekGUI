/**
 * Desktop Chrome 的纯视图模型：中/英文案字典与 ControlModel → 展示事实
 * 的映射。不含任何 DOM 依赖，renderer 与单元测试共用（测试在 Node 环境
 * 直接断言映射结果）。
 *
 * D29（双语化）之后字典的组成：Chrome 菜单/状态区/更新面板的存活键，
 * main 侧原生对话框与托盘气泡的文案键（dialog.、fail.、error. 前缀键），以及
 * quit-confirm 的确认框键。D39 移居官方设置页的三个面板（Harness/插件/
 * 反馈）不再有对应键——它们的文案由 settings-plugin 的 STRINGS 字典承担。
 * @module @see-sol-lab/deepseekgui/chrome/view-model
 */

import type {
  DesktopControlModel,
  DesktopRuntimeStatus,
} from '../control-model.ts'

/** 文案字典（zh 简单静态字典；英文是非中文 locale 的 fallback）。 */
export interface ChromeStrings {
  readonly [key: string]: string
}

const ZH: ChromeStrings = {
  'menu.about': '关于 DeepSeekGUI',
  // B3-15（住户 2026-08-24 批准）：Harness 崩掉时，设置页随官方 web UI 一起
  // 不可达（它就住在 3080 里），主窗口原本一个重启入口都没有，只剩系统托盘。
  // 故障态恰恰最需要它，而 chrome 层是我们自己的 renderer，DSH 死了它还活着。
  'menu.plugin-recovery.restore': '恢复上次插件变更',
  'menu.plugin-recovery.open-profile': '打开 Profile 文件夹',
  'menu.restart-harness': '重启 Harness',
  'menu.terminal': 'DSH 终端',
  // 逃生门语义（2026-09-02 开发者定调）：官方 Web UI 是备份/诊断层——GUI 出问题时用户仍能用官方界面自助维护。
  'menu.compatibility': '官方原生界面',
  // D3（莉莉丝 2026-09-05）：已在官方原生界面时，同一菜单项变成回程票——
  // 用户不该被要求知道"切回去要去托盘右键"。
  'menu.workbench': '切回 DeepSeekGUI 界面',
  'menu.browser.show': '显示浏览器面板',
  'menu.browser.hide': '收起浏览器面板',
  'menu.update': '检查更新',
  'menu.hamburger.title': '菜单',
  'menu.aria': 'DeepSeekGUI 菜单',
  'update.panel.aria': '检查更新',
  'notice.details': '查看详情',
  'notice.ack': '知道了',
  'notice.recovery': '刚才的配置没有启动成功，DeepSeekGUI 已恢复到 {profile}。',
  'notice.recovery-interrupted': '上次的 Profile 切换没有完成，DeepSeekGUI 仍在使用 {profile}。',
  'quit.confirm.running': '有 {count} 个会话正在执行。退出会中断它们。',
  'quit.confirm.running.one': '有 1 个会话正在执行。退出会中断它。',
  'quit.confirm.idle': '当前没有正在执行的任务。退出会停止 Harness。',
  'quit.confirm.unknown': '退出 DeepSeekGUI 会停止 Harness，并中断当前正在执行的任务（如果有）。',
  // 「位置」把「哪种家」与「家在哪」合成一行：原先「Harness 主目录：托管模式」
  // 是标签问"目录"、值答"模式"，住户看了说读不通（P8-D17）。
  'action.back': '‹ 返回',
  'profiles.not-discovered': '（尚未发现，点击"刷新 Profiles"）',
  'profile.try': '尚未验证，可以尝试启动',
  // Home 形态标签：菜单状态区撤掉后（#14）只剩托盘的「当前 Profile」行在用。
  'info.home.managed': '托管模式',
  'info.home.existing': '已有目录',
  'status.idle': '未运行',
  'status.starting': '正在启动',
  'status.switching': '正在切换',
  'status.recovering': '正在恢复',
  'status.stopping': '正在停止',
  'status.running': '运行中',
  'status.recovered': '已恢复',
  'status.failed': '启动失败',
  'recovery.stage': '失败阶段',
  'recovery.message': '失败消息',
  'recovery.failed-target': '失败目标',
  'recovery.recovered-to': '恢复目标',
  'recovery.log': '诊断日志',
  'recovery.no-log': '（无；开发/smoke 模式查看终端输出）',
  // 括注官方原词：同一个 preset，官方设置里显示成 "Workspace Write"。用户在两处
  // 看到的必须能对上，否则会以为是两种不同的权限（P8-D17）。大小写照抄官方 UI。
  // 纯值，不带「权限：」前缀——它现在是状态区里「权限」那一行的值，标签由
  'diag.update': '更新',
  'update.title': '版本信息',
  'diag.update.unconfigured': '当前未配置公开更新通道',
  'diag.update.checking': '正在检查更新…',
  'diag.update.latest': '已是最新版本',
  'diag.update.available': '有新版本可用：{version}',
  'diag.update.downloading': '正在下载 {version}…',
  'diag.update.verified': '已下载并验证：{version}',
  'diag.update.failed': '检查更新失败',
  'diag.update.download': '下载',
  'diag.update.cancel-download': '取消下载',
  'diag.update.install': '安装更新',
  'diag.update.dismiss': '关闭提示',
  'diag.update.smart-screen': '当前版本未进行代码签名，Windows SmartScreen 可能提示"未知发布者"。',
  'feedback.notice.copied': 'issue 内容已复制到剪贴板，正在打开 GitHub 页面。粘贴后提交即可。',
  'feedback.notice.failed': '复制或打开浏览器失败：',
  'feedback.gateway.sending': '正在提交…',
  'feedback.gateway.sent': '已提交，谢谢反馈！',
  'feedback.gateway.sent-url': '已提交：',
  'feedback.gateway.exported': '反馈文件已导出（已打开所在文件夹），可通过 DeepSeekGUI 网站的反馈渠道发给我们。',
  'feedback.gateway.failed-exported': '直传暂时不可用，反馈文件已导出（已打开所在文件夹），可通过 DeepSeekGUI 网站的反馈渠道发给我们。',
  'feedback.gateway.export-failed': '导出反馈文件失败：',
  // ---- 原生对话框（D29：main 侧全部对话框文案的唯一权威，zh 与旧硬编码逐字一致） ----
  'dialog.ok': '确定',
  'dialog.cancel': '取消',
  'dialog.open-folder': '打开文件夹',
  'dialog.quit-short': '退出',
  'dialog.quit.title': '确定要退出 DeepSeekGUI 吗？',
  'dialog.harness-failed.title': 'Harness 操作失败',
  'dialog.rescue.title': '启动配置无法读取',
  'dialog.rescue.restore': '恢复默认设置',
  'dialog.rescue.open-config': '打开配置文件所在文件夹',
  'dialog.rescue.detail': '文件：{file}\n原因：{reason}\n\n选择「恢复默认设置」会先把损坏的文件原样备份为 .invalid-<时间戳>，再写入默认配置（托管模式 + web）。你的会话、凭据、Profiles 与插件不会被删除或改写。',
  'dialog.rescue-restore-failed.title': '恢复默认配置失败（原文件未改动）',
  // #25（莉莉丝 2026-09-11）：上次卸载选了"保留数据"，而数据目录早已搬到
  // AppData 之外——重装首启只问这一句，两个按钮都不删任何东西。
  'dialog.reclaim.title': '发现之前搬走的数据目录',
  'dialog.reclaim.detail': '{path}\n\n上次卸载时选择了保留数据，这个目录里还有你的会话、记忆与设置。接着用它，还是从一个新的空目录开始？\n\n两种选择都不会删除这个目录。',
  'dialog.reclaim.use': '接着用它',
  'dialog.reclaim.fresh': '从新目录开始',
  // 门铃文案（P8-D27 后的诚实版）：切换/重启/换 Home 打断的是进行中的这一轮，
  // 已落盘的会话仍在——「宁可说得弱，不可说得假」。
  'dialog.confirm.restart': '重启',
  'dialog.confirm.switch-restart': '切换并重启',
  'dialog.confirm.switch.title': '切换到 Profile {profile}？',
  'dialog.confirm.use-managed.title': '切换回托管 Harness Home？',
  'dialog.confirm.choose-existing.title': '接管这个 Harness Home，并启动 Profile {profile}？',
  'dialog.confirm.restart.title': '重启 Harness？',
  'dialog.confirm.switch.detail': '当前 Profile {profile} 正在运行，切换会重启 Harness。',
  'dialog.confirm.use-managed.detail': '切换回托管 Harness Home 会重启 Harness，当前正在执行的任务会中断。',
  'dialog.confirm.choose-existing.detail': '接管既有 Harness Home 会重启 Harness，当前正在执行的任务会中断。',
  'dialog.confirm.restart.detail': 'Harness 正在运行，重启会中断它。',
  'dialog.confirm.session-note': '正在进行的任务会中断；已保存的对话不会丢失。',
  'dialog.confirm.home-note': '换 Home 之后，原 Home 的历史会话留在原处，切回去仍能继续。',
  'dialog.confirm.resume-note': '重开后可以从会话列表继续。',
  'dialog.confirm.files-note': '磁盘上的 Profile、插件与配置不受影响。',
  'dialog.recovery.title': '恢复详情',
  'dialog.install-verify-failed.title': '安装包验证失败',
  'dialog.install-verify-failed.detail': '已下载的安装包与验证记录不符，已拒绝执行。请重新检查更新并下载。',
  'dialog.install-confirm.title': '退出 DeepSeekGUI 并开始安装更新？',
  'dialog.install-confirm.button': '安装并退出',
  'dialog.install-confirm.detail': '已验证的安装程序：DeepSeekGUI {version}\n确认后将停止 Harness、关闭窗口并启动安装程序。\n（Windows SmartScreen 可能提示"未知发布者"——当前版本尚未进行代码签名。）',
  'dialog.install-spawn-failed.title': '无法启动安装程序',
  'dialog.install-spawn-failed.detail': '安装程序未能启动；当前 DeepSeekGUI 保持可用，已下载的安装包仍保留，可稍后重试或从更新缓存目录手动运行。',
  'dialog.export-ok.title': '诊断包已导出',
  'dialog.export-ok.detail': '已导出到本地目录（绝不上传）：\n{dir}\n\n日志已经过凭据脱敏，用户路径已归一化为 <USER_HOME>。\n诊断崩溃转储（.dmp）可能包含本地路径与内存片段；公开发布前请先检查包内容。',
  'dialog.export-failed.title': '诊断包导出失败',
  'dialog.download.title': '下载 DeepSeekGUI {version}？',
  'dialog.download.button': '下载',
  'dialog.download.detail': '大小约 {size} MB，下载后可验证再安装。',
  'dialog.tray-balloon.title': 'DeepSeekGUI 仍在运行',
  'dialog.tray-balloon.content': '窗口已关闭，DeepSeekGUI 与 Harness 继续在系统托盘运行。点击托盘图标可重新打开，右键可退出。',
  'dialog.update-balloon.title': 'DeepSeekGUI {version} 可用',
  'dialog.update-balloon.content': '打开 DeepSeekGUI 菜单里的"检查更新"查看详情。',
  // ---- 启动失败（fail() 的 title/message；诊断出处经 {hint} 注入） ----
  'fail.missing-web.title': '缺少 Web UI 构建产物',
  'fail.missing-web.message': '未找到 {path}。请先在仓库根目录运行 pnpm run build，再启动 DeepSeekGUI。',
  'fail.launcher-invalid.title': '启动配置无效',
  'fail.launcher-invalid.message': '恢复默认后仍无法读取启动配置 {path}：{reason}',
  'fail.dsh-failed.title': 'DSH 服务启动失败',
  'fail.dsh-failed.message': '{stage}: {message}{hint}',
  // ---- main 直接弹给用户的错误消息（reportFailure 的 detail；③类） ----
  'error.plugin-busy': '已有一项插件操作在进行中；请先取消或等待其结束',
  'error.harness-booting': 'Harness 正在启动/切换中，请等状态变为运行中后再进行插件操作',
  'error.workspace-missing': '会话工作区目录不存在：{path}。请恢复该目录，或选择其他工作区。',
  'error.wt-launch': 'Windows Terminal 启动失败: {reason}',
  'error.wt-exit': 'Windows Terminal 异常退出（code={code}）',
  // ---- main 写入面板 message 字段的正常路径操作提示（D29 验收补漏；③类） ----
  'msg.update-install-cancelled': '安装已取消；已验证的安装包已保留，可再次安装',
  'msg.update-no-platform-asset': '更新清单里没有适用于当前平台的安装包（Linux 需要 .AppImage）。已停止，不会下载其他平台的包。',
  'msg.update-linux-manual': '安装包已下载并通过完整性校验。请退出 DeepSeekGUI 后手动替换当前的 AppImage；自动替换与重启行为留待实机验证。',
  'diag.update.auto-download.on': '自动下载更新：开（点击关闭）',
  'diag.update.auto-download.off': '自动下载更新：关（点击开启）',
  'menu.data': '数据位置…',
  'data.panel.aria': '数据位置',
  'data.title': '数据位置',
  'data.current': '当前数据目录：{path}',
  'data.existing': '当前使用的是你自己选择的 Harness 目录，DeepSeekGUI 不会搬动它。',
  'data.migrate': '迁移到其他位置…',
  'data.migrate.hint': '选择目标文件夹后，DeepSeekGUI 会把全部数据复制过去、逐项校验，然后请你**完全退出并重新打开应用**（不是托盘里的「重启 Harness」）；重开后确认新位置一切正常，才会提示你删掉旧的那份。',
  'data.awaitingRestart': '数据已复制到新位置并切换过去：{path}。请**完全退出 DeepSeekGUI 再重新打开**（菜单或托盘的「退出 DeepSeekGUI」）——只有整个应用重开才会核对新位置的数据是否完整；托盘里的「重启 Harness」只是重启后台服务，不是应用重启，也不会触发核对。在那之前旧位置的文件原样保留，不会删除任何东西。',
  'data.verifyFailed': '重启后核对发现 {count} 项数据对不上，已停止。旧位置的文件仍然完好：{path}。请不要删除旧位置的数据。',
  'data.pending': '数据已搬到新位置并核对正常。旧位置那份还占着 {size}，可以删掉了：{path}',
  'data.cleanup': '删除旧位置的数据',
  'dialog.migration.title': '选择新的数据位置',
  'dialog.migration.button': '迁移到这里',
  'error.migration-existing-home': '当前使用的是你选择的现有 Harness 目录，迁移只适用于 DeepSeekGUI 自己管理的数据目录。',
  'error.migration-source-missing': '当前数据目录不存在：{path}',
  'error.migration-busy': '数据目录正在迁移，请等迁移结束后再操作。',
  'error.migration-selection-changed': '选择目标期间 Home 或 Profile 已切换，请重新发起迁移。',
  'error.migration-same-as-source': '目标位置和当前数据目录相同：{path}',
  'error.migration-target-inside-source': '目标位置在当前数据目录内部：{path}',
  'error.migration-source-inside-target': '目标位置包含了当前数据目录，不能这样选：{path}',
  'error.migration-target-not-writable': '目标位置不可写：{path}',
  'error.migration-not-enough-space': '目标位置空间不足：{path}',
  'error.migration-target-not-empty': '目标位置已有其他内容，请换一个空文件夹：{path}',
  'error.migration-switch-failed': '新位置启动失败，已回到原来的位置。新位置的副本已删除：{path}',
  'error.migration-cleanup-partial': '有 {count} 项旧文件没能删除（可能正被占用）；清单已保留，下次启动还会提示。',
  'error.migration-not-verified': '这次迁移还没有经过重启核对，不能删除旧位置的数据。请先重启 DeepSeekGUI 完成核对。',
  'msg.update-verified-cached': '上次下载的安装包已验证，可直接安装',
  'msg.update-install-state-changed': '确认期间更新包或更新状态发生了变化，本次安装已取消，请重新确认。',
  'msg.update-verified': '下载并验证完成，可以安装',
  'msg.update-download-cancelled': '下载已取消',
  'msg.plugin-op-cancelled': '操作已取消；launcher selection 未改变。目标 Profile 可能处于未完成的中间状态，刷新可查看当前磁盘事实。',
}

const EN: ChromeStrings = {
  'menu.about': 'About DeepSeekGUI',
  'menu.plugin-recovery.restore': 'Undo Last Plugin Change',
  'menu.plugin-recovery.open-profile': 'Open Profile Folder',
  'menu.restart-harness': 'Restart Harness',
  'menu.terminal': 'DSH Terminal',
  'menu.compatibility': 'Official Web UI',
  'menu.workbench': 'Back to DeepSeekGUI',
  'menu.browser.show': 'Show Browser Panel',
  'menu.browser.hide': 'Hide Browser Panel',
  'menu.update': 'Check for Updates',
  'menu.hamburger.title': 'Menu',
  'menu.aria': 'DeepSeekGUI Menu',
  'update.panel.aria': 'Check for Updates',
  'notice.details': 'View details',
  'notice.ack': 'Got it',
  'notice.recovery': 'That configuration failed to launch. DeepSeekGUI has recovered to {profile}.',
  'notice.recovery-interrupted': 'The previous profile switch was interrupted. DeepSeekGUI is still using {profile}.',
  'quit.confirm.running': 'There are {count} sessions running. Quitting will interrupt them.',
  'quit.confirm.running.one': 'There is 1 session running. Quitting will interrupt it.',
  'quit.confirm.idle': 'No tasks are currently running. Quitting will stop Harness.',
  'quit.confirm.unknown': 'Quitting DeepSeekGUI will stop Harness and interrupt any task that is currently running.',
  'action.back': '‹ Back',
  'profiles.not-discovered': '(not discovered yet — click "Refresh Profiles")',
  'profile.try': 'Unverified — you can still try to launch',
  'info.home.managed': 'Managed',
  'info.home.existing': 'Existing',
  'status.idle': 'Not running',
  'status.starting': 'Starting',
  'status.switching': 'Switching',
  'status.recovering': 'Recovering',
  'status.stopping': 'Stopping',
  'status.running': 'Running',
  'status.recovered': 'Recovered',
  'status.failed': 'Boot failed',
  'recovery.stage': 'Failed stage',
  'recovery.message': 'Failure message',
  'recovery.failed-target': 'Failed target',
  'recovery.recovered-to': 'Recovered to',
  'recovery.log': 'Diagnostics log',
  'recovery.no-log': '(none; dev/smoke mode prints to the terminal)',
  'diag.update': 'Update',
  'update.title': 'Version Info',
  'diag.update.unconfigured': 'no public update channel is configured',
  'diag.update.checking': 'checking for updates…',
  'diag.update.latest': 'you are up to date',
  'diag.update.available': 'a new version is available: {version}',
  'diag.update.downloading': 'downloading {version}…',
  'diag.update.verified': 'downloaded and verified: {version}',
  'diag.update.failed': 'update check failed',
  'diag.update.download': 'Download',
  'diag.update.cancel-download': 'Cancel Download',
  'diag.update.install': 'Install Update',
  'diag.update.dismiss': 'Dismiss',
  'diag.update.smart-screen': 'this build is not code-signed; Windows SmartScreen may warn about the unknown publisher.',
  'feedback.notice.copied': 'The issue body was copied to the clipboard and the GitHub page is opening. Paste it there and submit.',
  'feedback.notice.failed': 'Copy or browser open failed: ',
  'feedback.gateway.sending': 'Submitting…',
  'feedback.gateway.sent': 'Submitted — thank you!',
  'feedback.gateway.sent-url': 'Submitted: ',
  'feedback.gateway.exported': 'Feedback file exported (folder opened). You can send it to us through the DeepSeekGUI website feedback channel.',
  'feedback.gateway.failed-exported': 'Direct submit is unavailable right now. The feedback file was exported (folder opened) — you can send it to us through the DeepSeekGUI website feedback channel.',
  'feedback.gateway.export-failed': 'Feedback file export failed: ',
  'dialog.ok': 'OK',
  'dialog.cancel': 'Cancel',
  'dialog.open-folder': 'Open Folder',
  'dialog.quit-short': 'Quit',
  'dialog.quit.title': 'Quit DeepSeekGUI?',
  'dialog.harness-failed.title': 'Harness operation failed',
  'dialog.rescue.title': 'Cannot read the launcher configuration',
  'dialog.rescue.restore': 'Restore Defaults',
  'dialog.rescue.open-config': 'Open Configuration Folder',
  'dialog.rescue.detail': 'File: {file}\nReason: {reason}\n\nChoosing "Restore Defaults" first backs up the corrupted file as .invalid-<timestamp>, then writes the default configuration (managed home + web). Your sessions, credentials, Profiles and plugins are not deleted or modified.',
  'dialog.rescue-restore-failed.title': 'Failed to restore defaults (original file unchanged)',
  'dialog.reclaim.title': 'A moved data folder was found',
  'dialog.reclaim.detail': '{path}\n\nThe last uninstall kept your data, and this folder still holds your sessions, memory and settings. Continue with it, or start from a new empty folder?\n\nNeither choice deletes this folder.',
  'dialog.reclaim.use': 'Continue with it',
  'dialog.reclaim.fresh': 'Start fresh',
  'dialog.confirm.restart': 'Restart',
  'dialog.confirm.switch-restart': 'Switch & Restart',
  'dialog.confirm.switch.title': 'Switch to Profile {profile}?',
  'dialog.confirm.use-managed.title': 'Switch back to the managed Harness Home?',
  'dialog.confirm.choose-existing.title': 'Take over this Harness Home and start Profile {profile}?',
  'dialog.confirm.restart.title': 'Restart Harness?',
  'dialog.confirm.switch.detail': 'Profile {profile} is currently running. Switching restarts Harness.',
  'dialog.confirm.use-managed.detail': 'Switching back to the managed Harness Home restarts Harness and interrupts running tasks.',
  'dialog.confirm.choose-existing.detail': 'Taking over an existing Harness Home restarts Harness and interrupts running tasks.',
  'dialog.confirm.restart.detail': 'Harness is running. Restarting interrupts it.',
  'dialog.confirm.session-note': 'Running tasks will be interrupted; saved conversations are not lost.',
  'dialog.confirm.home-note': 'After switching Home, conversations from the old Home stay there and resume when you switch back.',
  'dialog.confirm.resume-note': 'After restarting, continue from the conversation list.',
  'dialog.confirm.files-note': 'Profiles, plugins and configuration on disk are not affected.',
  'dialog.recovery.title': 'Recovery Details',
  'dialog.install-verify-failed.title': 'Installer verification failed',
  'dialog.install-verify-failed.detail': 'The downloaded installer does not match the verification record and was refused. Check for updates again and download.',
  'dialog.install-confirm.title': 'Quit DeepSeekGUI and install the update?',
  'dialog.install-confirm.button': 'Install & Quit',
  'dialog.install-confirm.detail': 'Verified installer: DeepSeekGUI {version}\nAfter confirming, Harness stops, the window closes and the installer starts.\n(Windows SmartScreen may warn about an unknown publisher — this build is not code-signed.)',
  'dialog.install-spawn-failed.title': 'Could not start the installer',
  'dialog.install-spawn-failed.detail': 'The installer could not start. DeepSeekGUI remains usable and the downloaded installer is kept — retry later or run it manually from the update cache folder.',
  'dialog.export-ok.title': 'Diagnostics bundle exported',
  'dialog.export-ok.detail': 'Exported to a local folder (never uploaded):\n{dir}\n\nLogs are credential-redacted and user paths are normalized to <USER_HOME>.\nCrash dumps (.dmp) may contain local paths and memory fragments. Review the bundle before sharing it publicly.',
  'dialog.export-failed.title': 'Failed to export the diagnostics bundle',
  'dialog.download.title': 'Download DeepSeekGUI {version}?',
  'dialog.download.button': 'Download',
  'dialog.download.detail': 'About {size} MB. After downloading, it is verified before installation.',
  'dialog.tray-balloon.title': 'DeepSeekGUI is still running',
  'dialog.tray-balloon.content': 'The window is closed. DeepSeekGUI and Harness keep running in the system tray. Click the tray icon to reopen, or right-click to quit.',
  'dialog.update-balloon.title': 'DeepSeekGUI {version} is available',
  'dialog.update-balloon.content': 'Open "Check for Updates" in the DeepSeekGUI menu for details.',
  'fail.missing-web.title': 'Missing Web UI build',
  'fail.missing-web.message': 'Could not find {path}. Run pnpm run build at the repository root, then start DeepSeekGUI.',
  'fail.launcher-invalid.title': 'Invalid launcher configuration',
  'fail.launcher-invalid.message': 'Cannot read the launcher configuration at {path} even after restoring defaults: {reason}',
  'fail.dsh-failed.title': 'DSH service failed to start',
  'fail.dsh-failed.message': '{stage}: {message}{hint}',
  'error.plugin-busy': 'A plugin operation is already in progress. Cancel it or wait for it to finish.',
  'error.harness-booting': 'Harness is starting or switching. Wait until it is running before plugin operations.',
  'error.workspace-missing': 'The session workspace folder does not exist: {path}. Restore the folder or pick another workspace.',
  'error.wt-launch': 'Windows Terminal failed to start: {reason}',
  'error.wt-exit': 'Windows Terminal exited abnormally (code={code})',
  'msg.update-install-cancelled': 'Installation cancelled. The verified installer is kept and can be installed again.',
  'msg.update-no-platform-asset': 'The update manifest has no installer for this platform (Linux needs an .AppImage). Nothing was downloaded.',
  'msg.update-linux-manual': 'The installer was downloaded and passed the integrity check. Quit DeepSeekGUI and replace the current AppImage manually; automatic replacement and restart are left for on-device verification.',
  'diag.update.auto-download.on': 'Auto-download updates: on (click to turn off)',
  'diag.update.auto-download.off': 'Auto-download updates: off (click to turn on)',
  'menu.data': 'Data location…',
  'data.panel.aria': 'Data location',
  'data.title': 'Data location',
  'data.current': 'Current data folder: {path}',
  'data.existing': 'You are using your own Harness folder; DeepSeekGUI never moves it.',
  'data.migrate': 'Move to another location…',
  'data.migrate.hint': 'Pick a destination folder. DeepSeekGUI copies everything, verifies each item, then asks you to quit the app completely and open it again (not "Restart Harness" in the tray). Only after that restart confirms the new location is intact does it offer to delete the old copy.',
  'data.awaitingRestart': 'Your data was copied to the new location and DeepSeekGUI now points at it: {path}. Quit DeepSeekGUI completely (Quit DeepSeekGUI from the menu or tray) and open it again — only a full restart of the app checks that everything arrived intact. "Restart Harness" in the tray only restarts the background service; it is not an app restart and does not run that check. Until then the old files are kept exactly as they were; nothing is deleted.',
  'data.verifyFailed': 'After the restart, {count} item(s) did not match, so the move stopped here. The old location is still intact: {path}. Do not delete it.',
  'data.pending': 'Your data is now at the new location and verified. The old copy still takes up {size} and can be deleted: {path}',
  'data.cleanup': 'Delete the data at the old location',
  'dialog.migration.title': 'Choose the new data location',
  'dialog.migration.button': 'Move here',
  'error.migration-existing-home': 'You are using your own Harness folder; moving only applies to the data folder DeepSeekGUI manages.',
  'error.migration-source-missing': 'The current data folder does not exist: {path}',
  'error.migration-busy': 'The data directory is being moved. Wait for migration to finish.',
  'error.migration-selection-changed': 'The Home or Profile changed while choosing the destination. Start the migration again.',
  'error.migration-same-as-source': 'The destination is the current data folder: {path}',
  'error.migration-target-inside-source': 'The destination is inside the current data folder: {path}',
  'error.migration-source-inside-target': 'The destination contains the current data folder: {path}',
  'error.migration-target-not-writable': 'The destination is not writable: {path}',
  'error.migration-not-enough-space': 'The destination does not have enough free space: {path}',
  'error.migration-target-not-empty': 'The destination already has content; choose an empty folder: {path}',
  'error.migration-switch-failed': 'The new location failed to start, so DeepSeekGUI returned to the previous location. The copy there was deleted: {path}',
  'error.migration-cleanup-partial': '{count} old file(s) could not be deleted (they may be in use); the manifest is kept and the reminder returns on the next start.',
  'error.migration-not-verified': 'This move has not been verified by a restart yet, so the old location cannot be deleted. Restart DeepSeekGUI first to run the check.',
  'msg.update-verified-cached': 'The previously downloaded installer is verified and ready to install.',
  'msg.update-install-state-changed': 'The update file or state changed during confirmation. Installation was cancelled; confirm again.',
  'msg.update-verified': 'Downloaded and verified. Ready to install.',
  'msg.update-download-cancelled': 'Download cancelled',
  'msg.plugin-op-cancelled': 'Operation cancelled. The launcher selection is unchanged. The target profile may be in an unfinished intermediate state — refresh to see the current facts on disk.',
}

/**
 * 取 locale 对应字典：zh 用中文，其余 fallback 英文。
 * @param locale - 模型里的 locale。
 * @returns 文案字典。
 */
export function stringsFor(locale: DesktopControlModel['locale']): ChromeStrings {
  return locale === 'zh' ? ZH : EN
}

/** 字典取值（键集合由上方两套字典静态保证一致；缺键时回显键名便于发现）。 */
function t(dict: ChromeStrings, key: string): string {
  return dict[key] ?? key
}

/** 状态胶囊的展示事实。 */
export interface PillView {
  tone: 'grey' | 'blue' | 'green' | 'yellow' | 'red'
  text: string
}

/**
 * 七相状态 → 胶囊颜色与文案（切换/重启/恢复期间实时变化的唯一来源）。
 * @param status - 模型状态。
 * @param dict - 文案字典。
 * @returns 胶囊展示事实。
 */
export function pillView(status: DesktopRuntimeStatus, dict: ChromeStrings): PillView {
  // D2（莉莉丝 2026-09-05）：默认 profile 的名字 `web` 是官方给 profile 起的
  // 名，不是"网页版"；裸露在胶囊里会被当成"没在本地跑"。只有用户切到了
  // 非默认 profile 时才值得在胶囊里带名字。
  const suffix = (profile: string): string => profile === DEFAULT_PROFILE ? '' : ` · ${profile}`
  switch (status.phase) {
    case 'idle': return { tone: 'grey', text: t(dict, 'status.idle') }
    case 'stopping': return { tone: 'grey', text: t(dict, 'status.stopping') }
    case 'starting': return { tone: 'blue', text: `${t(dict, 'status.starting')}${suffix(status.profile)}` }
    case 'switching': return { tone: 'blue', text: `${t(dict, 'status.switching')}${suffix(status.profile)}` }
    case 'recovering': return { tone: 'yellow', text: `${t(dict, 'status.recovering')}${suffix(status.profile)}` }
    case 'running':
      return status.recovered
        ? { tone: 'yellow', text: `${t(dict, 'status.recovered')}${suffix(status.profile)}` }
        : { tone: 'green', text: `${t(dict, 'status.running')}${suffix(status.profile)}` }
    case 'failed': return { tone: 'red', text: t(dict, 'status.failed') }
  }
}

/** 托管 Home 的默认 profile 名（launcher state 缺省值）；胶囊对它不带名字。 */
const DEFAULT_PROFILE = 'web'

/**
 * 恢复提示横幅文案：按提示形态选文案，<profile> 为恢复目标 profile 名。
 * @param notice - 提示事实（profile + kind）。
 * @param dict - 文案字典。
 * @returns 横幅文案。
 */
export function recoveryNoticeText(
  notice: { profile: string; kind: 'boot-failure' | 'interrupted-switch' },
  dict: ChromeStrings,
): string {
  const key = notice.kind === 'interrupted-switch' ? 'notice.recovery-interrupted' : 'notice.recovery'
  return t(dict, key).replace('{profile}', notice.profile)
}
