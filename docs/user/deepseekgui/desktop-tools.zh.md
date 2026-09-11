# 桌面工具

[English](desktop-tools.md) | 中文

DeepSeekGUI 将 Harness 与桌面控制组合，提供内置浏览器、终端、更新、诊断反馈和常驻运行。

## 内置浏览器

在 DeepSeekGUI 中，助手使用应用内的浏览器面板检查需要真实渲染或交互的网页。支持导航、页面快照、截图、标签页、等待、点击、输入、滚动与键盘操作。

浏览器遵循以下限制：

- 导航前拒绝本机、内网与保留网段地址。
- 每次重定向都会重新检查目标。
- 不提供任意页面脚本执行。
- 提交表单、登录、发送消息与其他敏感动作需要批准。
- V1 不持久化 Cookie。

助手打开网页时，浏览器面板自动展开，与会话并列。它与右侧文件 Sidebar 交替显示，同一时间只展示其中一个；隐藏面板不会停止浏览器任务。渲染器崩溃后，下次浏览器操作会重新创建面板。

![DeepSeekGUI 会话使用内置浏览器检查公开网页](assets/browser-1.1.1.png)

## DSH Terminal

从菜单或系统托盘打开 **DSH Terminal**。终端使用当前 Harness Home；从会话入口打开时优先跟随该会话目录，否则使用当前 Profile 目录，目录不可用时会说明所用位置。

打包应用会向这个终端进程提供私有的 `dsh`、`node` 与 `pnpm` shim。它不会修改系统 PATH、注册表、PowerShell profile 或 shell 配置。

不带 Profile 参数的 `dsh` 命令默认使用当前 Profile。明确传入的 `--profile` 始终优先。

## Harness 控制

设置中的 Harness 区域会显示当前 Home、Profile、状态、Profile 切换器、Plugin Manager、权限控制、恢复详情、诊断与反馈。顶部状态指示器是只读的；需要修改时请进入 Harness 区域。

## 更新

从菜单或托盘使用**检查更新**。DeepSeekGUI 只比较 DeepSeekGUI 应用版本，不比较内嵌 DSH 版本。

手动下载会先确认；自动下载开启时可在后台下载。DeepSeekGUI 检查 HTTPS 产物、声明大小与 SHA256；Windows 安装始终由用户确认，交给安装器前再次校验。取消安装会保留已校验文件；Linux AppImage 在文件管理器中交给用户手动处理。

更新面板还有一个**自动下载更新**开关，默认开启，与桌面偏好存在一起。开启时，DeepSeekGUI 对每个发现的新版本最多启动一次后台下载。关闭只影响将来的自动下载，不中断已经在跑的那一次；正在进行的下载随时可以显式取消。

已安装版本已经是最新发布版本时，手动检查会报告当前没有可用更新。已安装版本仍可继续使用。

## Diagnostics Center

Diagnostics Center 显示白名单内的产品事实，并提供两个动作：

- **Open Log Folder** 打开本地服务日志目录。
- **Export Diagnostics Bundle** 在 DeepSeekGUI 数据目录下创建本地诊断包。DeepSeekGUI 不会上传它。

诊断包可以包含已脱敏的服务日志、构建信息、上次退出事实与有容量上限的 crash dump。凭据、`.env` 文件与会话内容从结构上排除。Crash dump 仍可能包含本地路径或内存片段，因此公开分享前必须检查每个导出文件。

GUI 无法启动时，请从终端运行已安装的可执行文件：

```powershell
DeepSeekGUI.exe --export-diagnostics
```

该命令不会启动 Harness、Profile、窗口、托盘或本地服务器，只会输出诊断包路径并退出。

## 反馈

**设置 → BUG 诊断与反馈**提供可编辑的脱敏诊断摘要。点击发送可让助手辅助排查，并将回复整理成 GitHub issue；提交前可检查内容。对话消息旁的官方反馈入口面向 DeepSeek Harness，桌面产品问题请使用本区域。

## 桌面通知

会话需要你时，DeepSeekGUI 会发出桌面通知：待处理的审批、等待回答的问题，以及后台任务的完成或失败。点击通知即可打开对应会话。

通知遵循 Windows 中该应用的通知设置。

## 托盘与生命周期

DeepSeekGUI 是常驻桌面应用。关闭窗口会把它隐藏起来；再次打开快捷方式会聚焦已有实例。**退出 DeepSeekGUI**才会停止 Harness、销毁托盘与视图，然后退出应用。

## 相关指南

- [工作台视图与 Git 工具](workbench.zh.md)
- [Profile 与插件](profiles-plugins.zh.md)
- [权限与批准](permissions.zh.md)
- [数据与故障排查](data-troubleshooting.zh.md)
