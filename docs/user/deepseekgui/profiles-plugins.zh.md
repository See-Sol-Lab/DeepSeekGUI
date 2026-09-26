# Profile 与插件

[English](profiles-plugins.md) | 中文

Harness Profile 定义 agent 使用的运行时组合。DeepSeekGUI 发现这些 Profile，并通过官方 Harness 命令管理插件；它不维护第二套插件系统。

## Managed Home 与 Existing Home

DeepSeekGUI 可以运行两类 Harness Home：

- **Managed Home** 是 DeepSeekGUI 应用数据目录下由应用管理的 Home。它是推荐起点，并使用 DeepSeekGUI 的安全默认值。
- **Existing Home** 是你选择的 DSH Home 绝对路径。DeepSeekGUI 会原地发现并运行其中的 Profile，不复制、不合并，也不迁移。

Harness 面板会显示当前 Home、完整路径、Profile 与运行时状态。切换 Home 或 Profile 会重启 Harness，并可能中断正在运行的任务；有任务正在运行时，DeepSeekGUI 会先要求确认。

## 选择 Profile

打开设置中的 Harness 区域，选择可启动的 Profile。DeepSeekGUI 会区分支持 Web、候选、headless 与 malformed 的 Profile，不会把每个目录都显示成可运行项。

新 Profile 启动失败时，DeepSeekGUI 可以回到 last-known-good（最近一次成功）选择。恢复提示会记录失败阶段与目标，不会假装尝试过的 Profile 已经成功。

![DeepSeekGUI 设置面板，包含通用、模型、插件与 agent preset 控制](assets/settings-panel.png)

## 插件页

插件在**设置 → 插件**里管理。这是 Harness 自带的插件页，DeepSeekGUI 直接使用它，按当前 Profile 显示：

- **已安装**：Profile 里已经安装的插件包，可以查看包含的组件、启用或停用、配置和卸载。
- **官方**：可以直接安装的官方插件。
- **DeepSeekGUI 内置**：随 DeepSeekGUI 一起安装的插件（工作台、主题、设置、浏览器、Skill 等）。它们带红色的「不可卸载」标记，不能停用或卸载，因为 DeepSeekGUI 要靠它们工作。

添加插件时可以选择官方源、镜像或自定义源。DeepSeekGUI 使用自带的 pnpm 安装，电脑上不需要另装 pnpm。大多数改动在下次启动 Harness 后生效，页面会提示。

## 版本兼容检查

安装和启动插件时，Harness 会检查插件声明支持的 DSH 版本。版本不兼容的插件会被拒绝，页面会写明原因。确实要用某个不兼容的版本时，可以只针对这一个插件版本和这一个 DSH 版本授予例外；这可能让应用出错或损坏数据，只在确认来源可信时这样做。

## 插件让 Harness 起不来时

Harness 启动失败时，DeepSeekGUI 会弹窗说明卡在哪一步，并给出诊断日志和事件记录文件的路径（事件记录在 `<DSH_HOME>/deepseekgui/events.md`）。如果刚装过插件，先怀疑那次安装：可以在 DSH 终端里用 `dsh plugin --profile <Profile> remove <包名>` 移除它，再重启 Harness。

## 相关指南

- [权限与批准](permissions.zh.md)
- [桌面工具](desktop-tools.zh.md)
- [数据与故障排查](data-troubleshooting.zh.md)
