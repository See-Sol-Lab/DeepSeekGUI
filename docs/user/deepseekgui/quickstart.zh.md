# DeepSeekGUI 快速开始

[English](quickstart.md) | 中文

本教程帮助 Windows 新用户从下载安装走到可用的 DeepSeek coding agent（编程智能体）会话。DeepSeekGUI 自带 Harness 运行时、Node.js 与 pnpm，安装后的应用不需要开发工具链。

## 开始之前

- 一台 Windows 10 或 Windows 11 x64 电脑。
- 一个 DeepSeek API key。
- 一个你愿意让 agent 检查和编辑的文件夹。

## 1. 下载 DeepSeekGUI

从[最新发布页](https://github.com/See-Sol-Lab/DeepSeekGUI/releases/latest)下载 Windows 安装包 `DeepSeekGUI-Setup-<版本号>.exe`。Linux AppImage 通过独立的实验性发布提供，当前可用链接见仓库首页。

DeepSeekGUI 目前的发行包未附代码签名，Windows SmartScreen 可能显示未知发布者警告。运行安装包前，请先用同一发布页的 `SHA256SUMS.txt` 校验文件：

```powershell
Get-FileHash .\DeepSeekGUI-Setup-<version>.exe -Algorithm SHA256
```

输出的 hash 与发布清单完全一致时再继续。在 SmartScreen 中选择**更多信息**，然后选择**仍要运行**。

## 2. 安装并启动

运行安装包。DeepSeekGUI 会为当前 Windows 用户安装，不需要管理员权限；安装过程会创建开始菜单和桌面快捷方式，并在结束后启动 DeepSeekGUI。

关闭主窗口只会把 DeepSeekGUI 隐藏到系统托盘，Harness 会继续运行。需要停止 Harness 并完全退出时，请从菜单或托盘选择**退出 DeepSeekGUI**。

## 3. 连接 DeepSeek

1. 从左下角打开**设置**。
2. 打开**模型**。
3. 选择 DeepSeek 提供方并输入 API key。
4. 选择模型，然后返回首页。

DeepSeekGUI 通过 Harness 凭据服务把 key 保存在应用数据目录中，不会把 key 写入安装包、命令行或诊断日志。

![DeepSeekGUI 模型设置页面，API key 已遮盖，并显示可用的 DeepSeek 模型](assets/settings-1.1.1.png)

模型选择、图片输入与自定义提供方见[模型与视觉](models.zh.md)。

## 4. 选择工作区

选择本次任务使用的文件夹。在推荐的 Sandbox 模式下，这个工作区是 agent 可以写入的文件范围。评估不熟悉的自动化时，请从项目副本或已纳入版本控制的目录开始。

## 5. 开始第一个会话

新建会话，并给 agent 一个具体结果，例如：

> 阅读这个项目，解释它如何启动，并找出我最应该先理解的三个文件。暂时不要编辑任何内容。

确认结果符合预期后，再要求 agent 完成边界明确的修改。DeepSeekGUI 会流式显示回复，并把会话保存在当前选择的 Harness Home 中，供你稍后恢复。

全新安装会引导选择工作区、配置模型和发送第一条消息，并在等待回复或审批时给出提示。随时可以跳过；已有会话数据的用户不会被当作新用户。

![DeepSeekGUI 完成创建并运行 JavaScript 文件的 coding 任务](assets/workbench-overview.png)

## 6. 检查批准请求与改动

工具批准由 Harness 提供。批准前请阅读请求执行的具体动作。DeepSeekGUI 绝不自动批准操作，也不维护另一份信任缓存。

在会话旁边打开**改动**视图阅读文件差异，打开 **Git** 视图查看分支状态和本会话的提交结果。视图读取本地状态，检查项目不消耗模型请求。详见[工作台视图与 Git 工具](workbench.zh.md)。

## 7. 留住协作经验

把长期协作偏好写进 **设置 → 全局记忆**，助手会在每个项目中遵循；这个项目的事实由助手记录在会话的**记忆**视图中。详见[记忆](memory.zh.md)。

日常工作请保持 **Sandbox**。只有任务确实需要 Windows 账户级访问，而且你理解界面显示的风险时，才启用 **Full Access**。

## 下一步

- [模型与视觉](models.zh.md)
- [工作台视图与 Git 工具](workbench.zh.md)
- [记忆](memory.zh.md)
- [工作区与会话](workspaces-sessions.zh.md)
- [Profile 与插件](profiles-plugins.zh.md)
- [权限与批准](permissions.zh.md)
- [桌面工具](desktop-tools.zh.md)
- [数据与故障排查](data-troubleshooting.zh.md)
