# 数据与故障排查

[English](data-troubleshooting.md) | 中文

DeepSeekGUI 把应用状态与 Managed Harness Home 保存在 Windows 用户目录下。模型请求仍会发送给你配置的提供方；数据保存在本地，不代表远程模型变成本地模型。

## DeepSeekGUI 把数据保存在哪里

| 数据 | 默认位置 | 说明 |
| --- | --- | --- |
| Managed Harness Home | `%APPDATA%\DeepSeekGUI\dsh` | Harness 管理的凭据、设置、会话、Profile 与插件。可从**数据位置**迁移；见下文。 |
| Launcher selection | `%APPDATA%\DeepSeekGUI\launcher-state.json` | 当前 Home 与 Profile、last-known-good 选择和已脱敏的启动失败。 |
| 桌面偏好 | `%APPDATA%\DeepSeekGUI\desktop-ui-state.json` | 窗口尺寸、更新偏好与本地 UI 确认状态；主题由 Harness 设置保存。 |
| 服务日志 | `%APPDATA%\DeepSeekGUI\dsh-service.log` | 已脱敏并轮转；包含当前文件与有上限的历史文件。 |
| 诊断导出 | `%APPDATA%\DeepSeekGUI\diagnostics` | 只有你要求导出时才创建的本地诊断包。 |
| 更新缓存 | `%APPDATA%\DeepSeekGUI\updates` | 最多保存一条已验证安装器记录及其文件。 |
| 安装包留存 | `%LOCALAPPDATA%\DeepSeekGUI\installer` | 安装器每次安装留下的当前版本安装包（约 190 MB），供整体搬家直接使用；卸载时删除。 |
| 全局记忆与规则 | 托管 Harness Home 内的 `memory.md` 与 `AGENTS.md` | 在设置中编辑的跨项目偏好，以及你的全局规则。 |
| 项目记忆与规则 | 所选工作区中的 `<文件夹名>.memory.md` 与 `AGENTS.md` | 项目事实与规则，属于项目文件的一部分。 |
| 旧记忆条目 | 托管 Harness Home 内的 `storages/deepseekgui_memory` | 只在用过早期版本增强记忆的 Home 里存在：条目并入 Markdown 文件后留下的备份（见[记忆](memory.zh.md)）。 |
| 技能库 | 托管 Harness Home 内的 `deepseekgui/skills` 与 `storages/deepseekgui_skills` | 已安装的技能包及其清单，以及每个项目文件夹的选择。 |

Windows 通过 Known Folder API 解析真实应用数据目录。表格使用 `%APPDATA%` 作为熟悉的默认写法。

## 迁移 Managed Harness Home

从菜单选择**数据位置…**可以查看当前数据目录；点**只移动数据…**并选定目标文件夹后：DeepSeekGUI 复制每一项、按大小与 SHA-256 逐项校验、把 launcher 指向新目录，并重启 Harness。重启会逐项核对新位置，只有核对通过后才会提示删除旧的那份。在那之前旧文件原样保留；核对失败时保留旧文件并停下。

这条路径只搬 Managed Harness Home。它不搬程序安装位置，也不搬你选择的 Existing Home、你的项目目录，或 `%APPDATA%\DeepSeekGUI` 下的其他文件。程序和数据一起搬见下一节。

## 整体搬家：程序和数据一起换位置

C 盘不够用、想把 DeepSeekGUI 整个放到 D 盘时，用这一项，而不是上面的**只移动数据**。

**安装时就选位置。** 全新安装会先问一次是否装到默认位置。选**否**，再选一个父文件夹（例如 `D:\Apps`）：程序装到 `D:\Apps\DeepSeekGUI\app`，第一次启动时数据放进 `D:\Apps\DeepSeekGUI\dsh`。升级和重新安装不会再问，沿用已有位置；默认位置已有旧数据时，也照常用旧数据，不会改到新位置。

**已经装好的，从应用里搬。** 菜单选**数据位置…**，点**整体搬到其他位置…**，选一个父文件夹，确认弹出的计划。DeepSeekGUI 依次：

1. 取得与当前版本完全相同的安装包，放进 `%APPDATA%\DeepSeekGUI\relocation` 里的副本。优先用安装器留在本机的那份（`%LOCALAPPDATA%\DeepSeekGUI\installer`，核对产品名和版本号），不用下载也不用自己找；没有时再按发布清单下载并核对大小、SHA-256、产品名和版本号。这一步不影响使用。都取不到时可以选一个本地安装包：同样复制成副本并核对产品名和版本号，但它没法与发布清单核对，请只用来源可信的文件。
2. 停止 Harness，把托管数据复制到 `<父文件夹>\DeepSeekGUI\dsh` 并逐项校验，然后切过去。这一步就是**只移动数据**的同一套流程，失败时自动回到原位置。
3. DeepSeekGUI 有序退出，交给一个短时的交接助手（系统自带的 PowerShell）。助手等应用的所有进程都退出后，再核一次安装包副本，然后运行安装器：把同一版本装到 `<父文件夹>\DeepSeekGUI\app`，移除旧程序目录，确认新位置有程序后从新位置打开。安装需要几分钟，期间桌面和开始菜单的快捷方式保持可见，装好后换成新位置。应用没能正常退出时，交接会取消，什么都不动。

搬完以后：桌面和开始菜单的快捷方式、卸载入口都指向新位置，以后的更新也装到那里。旧位置的数据在新位置启动核对通过后，回到**数据位置…**确认删除。**固定到任务栏的图标不会自动更新**，搬完请把旧图标取消固定，再从开始菜单重新固定。

**搬的是什么。** 程序本体，以及 DeepSeekGUI 管理的数据（会话、附件、凭据、各 Profile 及其 `cordis.patch.yml`、插件、技能、全局记忆与规则）。不搬：项目文件夹（项目记忆跟着项目走）、你自己选的 Existing Home（它留在原处，只搬程序）。Windows 必需的快捷方式和注册表项，以及 `%APPDATA%\DeepSeekGUI` 里的启动选择、窗口状态、日志这些小文件仍在 C 盘。凭据在同一个 Windows 用户下照常可用。

**不能选的位置。** 系统目录（Windows、Program Files、ProgramData）、Git 项目里面、当前程序或数据目录的里面或外面一层、已有内容的 `DeepSeekGUI` 文件夹、链接，以及安装目录超过 85 个字符的深路径。还没收尾的**只移动数据**（等重启核对、旧数据未删）要先处理完。

**没搬成怎么办。** 新位置没装成时，交接助手会先打开仍在的旧程序；旧程序已经被移除，就用同一个安装包副本把程序装回原位置。再打开 DeepSeekGUI，**数据位置…**会说明没搬成的原因：数据若已搬就留在新位置照常可用，可以**重试搬程序**（会按当前情况重新检查目标），也可以**放弃**让程序留在原位置。万一新旧两个位置都没装成，会弹出提示，写明安装包副本和数据所在的位置：双击那个安装包重新安装即可，数据不会被删除。安装包副本在搬家确认完成或你放弃之前一直保留。

**升级与卸载。** 搬家不改变版本。之后的更新装到新位置。卸载照旧询问是否删除数据，选**否**会保留 `<父文件夹>\DeepSeekGUI\dsh`，选**是**也会保留全局 `memory.md` 和 `AGENTS.md`。

Linux 的 AppImage 只有一个文件，直接移动这个文件即可；数据用**只移动数据**。

## 卸载与重新安装

卸载程序会询问是否删除 DeepSeekGUI 数据目录。选择**否**会保留凭据、设置、会话与 Profile，供以后重新安装时继续使用。只有你确定要删除这些数据时才选择**是**；即使选择**是**，全局 `memory.md` 与 `AGENTS.md` 也会保留，并放回 `%APPDATA%\DeepSeekGUI\dsh`，重新安装后仍然在。想清空它们，请在应用里删改。项目记忆与规则留在你的项目文件夹里。

升级过程中的静默卸载会保留数据，不显示该询问。

<a id="keep-your-data"></a>

## 留存你的数据

你的历史记录在两个地方：托管 Harness Home 与你的项目文件夹。本节列出要复制什么，以及每种导出包含什么。这些步骤只在 DeepSeekGUI 1.2.x 上核对过：恢复指的是把文件放回同一版本的 DeepSeekGUI。其他产品能否打开这些文件尚未验证，这里不作任何承诺。

| 要保留的内容 | 位置 | 说明 |
| --- | --- | --- |
| 会话 | 托管 Harness Home 内的 `sessions\--<工作区路径>--\session-<id>\` | 每个工作区一个文件夹、每个会话一个子文件夹；里面的日志是压缩文件，例如 `session.v4.jsonl.zstd`。 |
| 附件 | 托管 Harness Home 内的 `attachments\v1` | 第一次添加文件或图片时创建。会话引用这些文件，请和 `sessions` 一起保留。 |
| 工作区列表 | 托管 Harness Home 内的 `storages\workspace.json` | 侧栏显示的工作区与会话。复制整个 Home 时会和会话一起保留。 |
| 全局记忆与规则 | 托管 Harness Home 内的 `memory.md` 与 `AGENTS.md` | 纯文本，原样复制即可。 |
| 项目记忆与规则 | 各项目文件夹中的 `<文件夹名>.memory.md` 与 `AGENTS.md` | 随项目一起走。 |
| 设置与插件 | 托管 Harness Home 内活动 Profile 的文件夹 `profiles\<Profile>\`（默认 Profile 是 `web`）：`cordis.yml`、`cordis.patch.yml` 与 `package.json` | `cordis.yml` 是基础配置；你在设置页保存的修改写在 `cordis.patch.yml`；`package.json` 是插件清单。只留 `cordis.yml` 会丢掉你在设置页做的修改。DeepSeekGUI 自带的插件由所装版本重新提供。 |
| 技能 | 托管 Harness Home 内的 `deepseekgui\skills` 与 `storages\deepseekgui_skills` | 你安装的技能包，以及各项目的选择。 |
| API 密钥 | 托管 Harness Home 内的 `.credentials.yaml` | 里面是你的密钥。只在私密的地方留副本，或以后重新填写。不要附在任何报告里。 |

要全部留下：

1. 在**设置 → Harness**里记下当前 Harness Home 的路径、它是托管还是已有目录，以及当前 Profile。这些选择保存在 Home 之外（`launcher-state.json`；迁移过的托管 Home 另有 `%LOCALAPPDATA%\DeepSeekGUI\managed-home.txt`），复制 Home 不会带上它们。
2. 完全退出 DeepSeekGUI。关闭窗口只是隐藏：请用托盘图标，选择**退出 DeepSeekGUI**。Harness 运行时复制，可能复制到写到一半的文件。
3. 把整个 Harness Home 文件夹复制到你的备份位置：默认是 `%APPDATA%\DeepSeekGUI\dsh`；迁移过的话，是**数据位置…**里显示的文件夹；用的是已有目录的话，就是你第 1 步记下的那个文件夹。
4. 照常复制你的项目文件夹；它们自带记忆和规则文件。

要恢复到同一版本的 DeepSeekGUI，先安装它并完全退出，然后按你记下的 Home 类型操作：

- **默认托管 Home**（从未迁移）：把保存的文件夹放回 `%APPDATA%\DeepSeekGUI\dsh`，再启动 DeepSeekGUI。
- **迁移过的托管 Home**：选择记录还在时，放回**数据位置…**里原来显示的路径即可。在新机器上，或选择记录已清除时，DeepSeekGUI 不知道原来的外部路径，只会读 `%APPDATA%\DeepSeekGUI\dsh`。请把保存的文件夹放到这里再启动；想继续放在别处，启动后用**数据位置…**再迁移过去。
- **已有目录（Existing Home）**：把文件夹放回任意位置，启动 DeepSeekGUI，在**设置 → Harness**选择**选择已有 Harness Home…**，选中这个文件夹，再选你记下的 Profile。

如果你记下的 Profile 不是 `web`，启动后在**设置 → Harness → Profiles**里切换到它。随后检查一个会话、**设置 → 全局记忆**，以及某个项目的**记忆**视图。这些步骤只按应用现有入口整理，未在全新机器上做过完整的桌面恢复验证。

在应用之外阅读历史，有两种导出：

| 导出 | 做法 | 内容 | 附件 |
| --- | --- | --- | --- |
| 会话日志（ZIP） | 会话的更多操作菜单 →**下载 Session 日志**，或输入 `/export` | `dsh-session-<id>.zip`：日志为 `session.v<格式版本>.jsonl`（例如 `session.v4.jsonl`），子会话在 `subagents\<id>\` 下，外加被引用的文件 | 包含：图片在 `media\`，其他文件在 `files\` |
| Markdown | 侧栏中该会话的菜单 →**导出为 Markdown** | 你的消息与助手回复的可读文本；勾选后才包含工具调用与思考过程 | 不包含：附件只显示为一行占位 |

ZIP 里的图片文件名含 `sha256:`，而 Windows 文件名不允许冒号。PowerShell 的 `Expand-Archive` 会直接拒绝这样的压缩包；Windows 自带的 `tar -xf <文件>.zip -C <文件夹>` 可以解开，并把冒号写成 `sha256_`。如果别的解压工具也拒绝，请照这样用 `tar`。

ZIP 是单个会话的完整记录；Markdown 用来阅读与分享。两种导出都不含记忆、规则、设置与密钥，请按上面的方法另行复制。分享导出文件前请先检查：日志会引用助手读过和运行过的内容。

## 隐私边界

- DeepSeekGUI 通过 Harness 把提示词、所选上下文与附件发送给配置的模型提供方。
- 会话数据与凭据保存在当前 Harness Home 中；已配置的提供方或工具仍可能发送任务要求的内容。
- 服务日志会在写入前脱敏凭据形态文本。
- 诊断导出保存在本地，绝不自动上传。
- 项目记忆是工作区中的普通 Markdown 文件。公开项目之前，请先检查其中的内容。
- Existing Home 会原地使用；DeepSeekGUI 不会把它复制进 Managed Home。

向电脑外部分享任何内容前，请检查工具批准请求与导出的诊断信息。

<a id="windows-smartscreen-blocks-the-installer"></a>

## Windows SmartScreen 阻止安装包

DeepSeekGUI V1 尚未签名。请从同一个 GitHub Release 下载安装包与 `SHA256SUMS.txt`，校验 SHA-256；只有 hash 一致时，才使用**更多信息 → 仍要运行**。

## DeepSeekGUI 报告缺少 API key

打开**设置 → 模型**，为当前会话选择的准确提供方路由保存 key。详见[模型与视觉](models.zh.md)。

## Harness 无法启动

1. 打开 Harness 区域并阅读失败阶段。
2. 检查是否有其他进程占用端口 `3080`。
3. 最近切换过 Profile 或安装过插件时，请检查 Recovery Details 与 Plugin Manager 恢复入口。
4. 打开日志文件夹或导出诊断信息。
5. 修正原因后重启 Harness。

Profile 切换失败后，DeepSeekGUI 可能回到 last-known-good Profile。恢复提示说明回退已经成功，不代表尝试过的 Profile 已经加载。

## DeepSeekGUI 已经打开，但窗口不见了

请检查系统托盘。关闭窗口会隐藏常驻应用。再次打开 DeepSeekGUI 快捷方式后，已有实例应当重新获得焦点。

显示器、DPI 或分辨率变化后，DeepSeekGUI 也会把已保存窗口范围限制回可见工作区。

## 插件操作失败

重试前，请阅读操作输出与恢复状态。恢复确认窗口打开时，不要编辑受保护的 Profile 文件。DeepSeekGUI 报告文件 drift 时，请人工检查文件；自动恢复会停止，避免覆盖更新的改动。

## 浏览器没有打开

DeepSeekGUI 使用应用内的浏览器面板，首次浏览器操作时启动。确认 Harness 正在运行、目标是公开的 `http` 或 `https` 地址；本机、内网和不受支持的 URL 会被拒绝。截图分析还需要当前模型支持图片输入。

## 检查更新报告没有可用更新

已安装版本已经是最新发布版本。这不会改变已安装应用。你也可以从 GitHub 手动下载 Release。

## Sandbox 模式用过的项目里，自己运行程序出错

在 Windows 上，旧版 DeepSeekGUI 可能在项目文件夹上留下 Sandbox 写入授权和低完整性标签。从这个文件夹启动的程序随后可能无法访问用户目录或缓存。Electron 程序可能以 `0x80000003` 退出；Python 或 `uv` 可能报告“拒绝访问”。

DeepSeekGUI 1.2.0 会在项目空闲 30 秒、且没有 Sandbox 命令仍在运行时收回授权。要清理旧版留下的标记，打开**设置 → 通用 → 清理沙箱标记**并选择文件夹。如果该文件夹还有 Sandbox 命令在运行，应用会拒绝清理；如果标记来自上级目录，应用会找到并清理实际带标记的那一层。

可以用 `icacls "D:\my-project"` 检查文件夹。清理后，输出里不应再有 `Mandatory Label\Low` 或 `S-1-4-…` 沙箱授权。清理失败时，保留错误信息并导出诊断供排查。

## GUI 无法使用时导出诊断

运行：

```powershell
DeepSeekGUI.exe --export-diagnostics
```

该命令会输出导出目录。把诊断包附加到公开 issue 前，请先检查内容。

## 获取帮助

新建 issue 前，请先搜索已有 [DeepSeekGUI issues](https://github.com/See-Sol-Lab/DeepSeekGUI/issues)。请提供 DeepSeekGUI 版本、Windows 版本、尝试过的操作、可见错误，以及你已经检查过的诊断文件。
