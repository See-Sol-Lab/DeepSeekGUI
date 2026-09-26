[中文](#中文) | [English](#english)

<a id="中文"></a>
## 中文

DeepSeekGUI v1.1.1 把内嵌的 DeepSeek Harness 从 `0.1.2-rc.1` 升到 `0.1.5-rc.2`，并补齐日常使用的几条主路径：首次启动引导、就地更新、数据目录迁移、归档会话管理，以及内置浏览器与流式显示的体验。桌面壳仍基于官方 Harness 客户端扩展，会话、工具与权限机制不变。

### 新增功能

#### 首次启动与更新

- 新增首次启动引导：依次选择工作区、填写 API 密钥、发送第一条对话，完成后不再出现；已有数据的用户不会被当作新用户。
- 新增就地更新：后台下载安装包并校验 SHA256，明确显示版本与更新说明，由用户确认后启动安装；可在设置中关闭自动下载。取消安装后，已校验的安装包保留，下次无需重新下载。

#### 数据目录与会话管理

- 新增 Harness 数据目录迁移：在设置中把托管数据目录移到其他位置，程序先复制、逐文件校验、切换并重启，再次核对后提供删除旧副本的选项；清理只删除清单内的文件，从不跟进目录链接。
- 卸载时若选择删除数据，迁移后的目录会一并列出并删除；选择保留时，重装后的首次启动会询问是否继续使用原目录。
- 归档会话移入「设置 → 归档的会话」，可恢复打开或两步确认删除。删除会等待该会话当前回复与工具执行结束后进行，清除正文、附件引用与搜索索引，仅保留会话编号、标题与删除时间；之后按编号或标题查询会明确得到「已删除」，而不是查无结果。

#### 内置浏览器

- 助手每次打开网页时浏览器面板自动展开；面板与官方右侧 Sidebar 互斥，同一时间只显示其中一个。
- 助手会知道当前模型是否支持看图：只支持文本的模型被要求查看网页或截图时，会先停下询问是否切换模型，而不是继续用文本工具硬做。
- 页面元素定位优先选择可见元素，匹配多个元素时不再报错，匹配不到时限时失败并提示先取快照；无障碍树保留被包装层隐藏的子元素，快照中的可点击引用完整。
- 面板渲染进程崩溃后延迟释放，下一次使用时自动重建，无需重启程序。

#### 内嵌 Harness 0.1.5-rc.2

随包的 DeepSeek Harness 由 `0.1.2-rc.1` 升级到 `0.1.5-rc.2`，官方 Web 界面随之更新，主要包括：右侧 Sidebar 支持多标签、分栏、全屏以及 Markdown / 代码 / HTML / PDF / 图片预览，模型可显式交付文件；支持上传任意类型文件；新增 `DeepSeek V4.1 Flash` 并作为新会话默认模型；长会话打开与恢复更流畅；Windows 上本地子进程不再弹出控制台窗口；反馈提交增加确认对话框。完整变更见官方说明：[0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)、[0.1.5-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)。

### 体验优化

- 助手回复的正文以稳定速度平滑显示，不再随网络分块跳动；停止、结束或出错时立即显示完整文本，思考与工具事件不受影响；模型静默期间不再空转重绘。
- 「并行工作区」并入「Git」视图上半部分；「改动 / Git / 并行工作区」视图去掉「打开资源管理器」按钮与根路径行，文件定位统一走官方右侧 Sidebar 的文件树，「记忆」视图保留打开文件入口。
- 默认模型目录的显示名改为 DeepSeek V4.1 Flash；`deepseek-v4-pro` 继续保留在默认目录中。
- 官方右侧 Sidebar 全屏时使用不透明底色，不再透出左侧工作区栏。
- 汉堡菜单去掉与状态胶囊重复的状态块；官方反馈对话框注明反馈提交给 DeepSeek Harness 渠道。
- 「设置 → 反馈」会以脱敏后的诊断信息在后台向助手发起一次分诊，并把回复直接显示给用户。
- 数据目录迁移、校验与清理会写入桌面事件，助手能读到搬家事实而不是靠猜。
- 主进程的错误与警告镜像到 `deepseekgui-main.log`（有界、轮转、脱敏），并纳入诊断包。
- Compatibility View（官方界面）不再加载任何产品覆盖层，作为纯粹的官方界面逃生门；切换时 Harness 保持运行。

### 问题修复

- 修复 Windows 上沙箱 PowerShell、Git 等子进程弹出黑色控制台窗口并抢占焦点的问题（0.1.5 的作业运行器没有控制台，子进程各自开窗）。
- 修复删除归档会话后列表残留幽灵行，切换设置标签又出现、「恢复并打开」进入无日志会话报错的问题。
- 修复插件恢复：第二次「恢复」被错误拒绝并给出不实提示；恢复中途失败后可再次继续；确认期间文件被改动时不再覆盖。
- 修复插件操作失败时没有任何提示、首次启动因无法读取会话目录而误判为新用户、诊断包导出因时间戳而假报超时的问题。
- 修复 Git：路径按字面匹配，不再把含 `[ ] *` 的文件名当通配符；还原文件前复核内容与审批时一致；推送预览与错误中的远端凭据脱敏；未跟踪与冲突文件拒绝还原。
- 修复 Pull Request：长正文改经标准输入传给 GitHub CLI；已关闭的 PR 不再阻挡同分支再次创建；超时与输出截断如实报告。
- 修复更新：超时、取消、重定向次数与缓存位置校验，确认安装前重新核对安装包；同一时刻只有一次安装。
- 修复终端：带空格或特殊字符的路径参数、管道分块破坏尺寸控制帧、初始化输出过早、退出码被覆盖。
- 修复会话导入：不可读目录不再当作空历史；跨工作区重复编号去重；半份副本不再可见。
- 修复全局记忆：外部修改后拒绝用旧草稿覆盖；换 Home 后不串写；切换项目后不残留上一个项目的局部状态。
- 修复 Harness 启动状态：持久化失败不再报告运行中，停止标记不残留，旧进程回调不改变新进程状态；终止失败时不释放操作槽位、不谎报已停止。
- 修复流式文本被替换后的下一帧从头重播的问题。
- 修复更新缓存、迁移清理与卸载器对目录链接的处理：链接只摘链接本身，不进入目标目录。

### 升级说明

- 内嵌 DeepSeek Harness 更新至 `0.1.5-rc.2`。会话数据格式升级为 V3：旧会话在首次打开时自动迁移并保留原文件；迁移后的会话不能再被旧版 Harness 读取。
- 从 v1.1.0 覆盖安装时，保留 `%APPDATA%\DeepSeekGUI` 下的会话、设置与凭据。
- 官方 Web 界面的 Detail 面板已由右侧 Sidebar 取代。
- 卸载器「同时删除数据目录」现在会连迁移后的数据目录一起删除；请在卸载前确认。

### Linux（实验性）

Linux AppImage 由 CI 构建并作为单独的预发布提供，发布后链接会补在本页；用法与 v1.1.0 相同（系统没有 `libfuse2` 时用 `--appimage-extract-and-run` 启动）。Linux 版本本次未做完整验收，问题请在 Issues 反馈。

### 下载与校验

下载本页附件 `DeepSeekGUI-Setup-1.1.1.exe`，并使用 PowerShell 计算 SHA256，与附件 `SHA256SUMS.txt` 核对：

```powershell
Get-FileHash .\DeepSeekGUI-Setup-1.1.1.exe -Algorithm SHA256
```

安装与 SmartScreen 相关问题见[故障排查指南](https://github.com/See-Sol-Lab/DeepSeekGUI/blob/main/docs/user/deepseekgui/data-troubleshooting.zh.md)。

DeepSeekGUI 是非官方社区产品，与 DeepSeek 无隶属关系，也未获其背书。DeepSeek Harness 及其官方 Web UI 由 DeepSeek 提供。

---

<a id="english"></a>
## English

DeepSeekGUI v1.1.1 upgrades the embedded DeepSeek Harness from `0.1.2-rc.1` to `0.1.5-rc.2` and completes several everyday paths: first-run guidance, in-place updates, data-folder migration, archived-session management, and the built-in browser and streaming experience. The desktop shell still extends the official Harness client; sessions, tools, and permissions are unchanged.

### New Features

#### First Run and Updates

- Add a first-run guide: choose a workspace, enter an API key, send the first message, and the guide is done for good. Existing users are never treated as new.
- Add in-place updates: the installer is downloaded in the background and verified by SHA256, the version and release notes are shown, and installation starts only after the user confirms. Automatic download can be turned off in Settings. Cancelling the install keeps the verified installer, so the next attempt needs no re-download.

#### Data Folder and Session Management

- Add Harness data-folder migration: move the managed data folder to another location from Settings. The app copies, verifies every file, switches, restarts, re-checks, and then offers to delete the old copy. Cleanup removes only the files in its manifest and never follows directory links.
- The uninstaller's "also delete data" option now lists and removes the migrated folder as well; choosing to keep the data makes the next first start after a reinstall ask whether to continue with that folder.
- Archived sessions move to Settings → Archived Sessions, where they can be restored and opened or deleted with a two-step confirmation. Deletion waits for the session's current reply and tool work to finish, then removes the content, attachment references, and search index, keeping only the session id, title, and deletion time. Later lookups by id or title report "deleted" instead of "not found".

#### Built-in Browser

- The browser panel opens whenever the assistant navigates; the panel and the official right Sidebar are mutually exclusive.
- The assistant knows whether the current model accepts images. A text-only model asked to look at a page or screenshot stops and asks about switching models instead of pressing on with text tools.
- Element targeting prefers visible elements, multiple matches are no longer an error, and a target that matches nothing fails within a bounded time with a pointer to the snapshot. The accessibility tree keeps children hidden behind wrapper nodes, so snapshot references are complete.
- A crashed panel renderer is released and rebuilt on the next use; no restart is needed.

#### Embedded Harness 0.1.5-rc.2

The bundled DeepSeek Harness moves from `0.1.2-rc.1` to `0.1.5-rc.2`, and the official Web UI moves with it. Highlights: the right Sidebar with tabs, split panes, fullscreen, and Markdown / code / HTML / PDF / image previews, plus explicitly delivered files; uploads of arbitrary file types; `DeepSeek V4.1 Flash` as the default model for new sessions; smoother opening and resuming of long conversations; no console windows from local subprocesses on Windows; a confirmation dialog for feedback. See the official notes for the full list: [0.1.5-rc.1](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1), [0.1.5-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2).

### Improvements

- Assistant text streams at a steady rate instead of in network-shaped bursts; stop, completion, and errors reveal the full text immediately, thinking and tool events are unaffected, and idle periods no longer repaint.
- Worktrees become the top section of the Git view. The Changes / Git / Worktrees views drop the "open in file manager" button and root path row; file reveal goes through the official right Sidebar's file tree, and the Memory view keeps its open-file action.
- The default model catalog shows DeepSeek V4.1 Flash as the display name; `deepseek-v4-pro` stays in the default catalog.
- The official right Sidebar uses an opaque surface in fullscreen instead of showing the workspace column through it.
- The hamburger menu drops the status block duplicated by the status pill; the official feedback dialog states that feedback goes to the DeepSeek Harness channel.
- Settings → Feedback runs a background triage with the assistant over redacted diagnostics and shows the reply directly.
- Data-folder migration, verification, and cleanup write desktop events, so the assistant learns about the move instead of guessing.
- Main-process errors and warnings mirror to `deepseekgui-main.log` (bounded, rotated, redacted) and are included in diagnostics bundles.
- Compatibility View loads no product overlay at all, serving as a pure official-UI escape hatch; the Harness keeps running across the switch.

### Bug Fixes

- Fix black console windows stealing focus on Windows when sandboxed PowerShell, Git, or other subprocesses run (the 0.1.5 job runner has no console, so each child opened its own).
- Fix a ghost row after deleting an archived session, which reappeared on a Settings tab switch and opened a session with no log on "restore and open".
- Fix plugin recovery: a second Restore was refused with an untrue message; an interrupted restore can be continued; files changed while the confirmation was open are no longer overwritten.
- Fix silent plugin-operation failures, first-run misclassifying an existing user when the sessions folder could not be read, and diagnostics exports reporting a false timeout because of their timestamp.
- Fix Git: paths match literally, so names containing `[ ] *` are no longer treated as globs; a file is re-checked against the approved content before it is reverted; remote credentials are redacted in push previews and errors; untracked and conflicted files refuse revert.
- Fix Pull Requests: long bodies go to the GitHub CLI over standard input; a closed PR no longer blocks creating a new one on the same branch; timeouts and truncated output are reported as such.
- Fix updates: timeout, cancellation, redirect-count, and cache-location checks, with the installer re-verified before installation; only one installation runs at a time.
- Fix the terminal: path arguments with spaces or special characters, pipe chunking breaking resize control frames, premature initial output, and overwritten exit codes.
- Fix session import: an unreadable folder is no longer treated as empty history; duplicate ids across workspaces are deduplicated; half-written copies are never visible.
- Fix global memory: a stale draft no longer overwrites an external edit; saving after a Home switch writes to the right Home; switching projects leaves no state from the previous one.
- Fix Harness status: a persistence failure no longer reports "running", stop markers do not linger, and callbacks from an old process cannot change the new one's state; a failed stop keeps the operation slot and never claims success.
- Fix streamed text replaying from the start after a replacement.
- Fix directory-link handling in the update cache, migration cleanup, and the uninstaller: links are removed as links and never entered.

### Upgrade Notes

- The embedded DeepSeek Harness is updated to `0.1.5-rc.2`. The session data format moves to V3: older sessions are migrated on first open and the original files are kept; migrated sessions cannot be read by older Harness versions.
- Installing over v1.1.0 preserves sessions, settings, and credentials under `%APPDATA%\DeepSeekGUI`.
- The official Web UI's Detail panel is replaced by the right Sidebar.
- The uninstaller's "also delete the data folder" option now removes a migrated data folder too; check before uninstalling.

### Linux (experimental)

The Linux AppImage is built by CI and published as a separate pre-release; the link will be added to this page once it is out. Usage is the same as v1.1.0 (without `libfuse2`, start it with `--appimage-extract-and-run`). The Linux build did not go through the full acceptance this time; please report problems in Issues.

### Download and Verification

Download `DeepSeekGUI-Setup-1.1.1.exe` from this release's assets. Calculate its SHA256 hash in PowerShell and compare it with the attached `SHA256SUMS.txt`:

```powershell
Get-FileHash .\DeepSeekGUI-Setup-1.1.1.exe -Algorithm SHA256
```

For installation and SmartScreen issues, see the [troubleshooting guide](https://github.com/See-Sol-Lab/DeepSeekGUI/blob/main/docs/user/deepseekgui/data-troubleshooting.md).

DeepSeekGUI is an unofficial community product and is not affiliated with or endorsed by DeepSeek. DeepSeek Harness and its official Web UI are provided by DeepSeek.

---

### 归档与引用 / Archive and Citation

- 所有版本 DOI / All versions DOI: [10.5281/zenodo.22205160](https://doi.org/10.5281/zenodo.22205160)
