# Agent Note: B5-P5 — 工具结果卡片与按需检查器

Status: implemented

[English](2026-09-04-b5-p5-tool-cards-and-on-demand-inspectors.md) | 中文

## 问题

B5-P4 的工具和其他工具一样把结果写进会话日志，所以结果已经进对话——但只以 generic 回退行呈现（标题加原文），而 B4 时代的检查面（Files / Changes / Git·Review / Runtime detail 页，以及 commit/push/PR 工序页）已在 B5-P1/P4 退役，没有产品形态的替代。顶部平铺导航早已移除；缺的是 DeepSeekGUI 自有工具的卡片呈现、统一的按需检查入口，以及旧工序页曾收集的人类输入（commit message、push remote/ref、PR body）的小表单。

## 决策

- 全部新浏览器 UI 落在既有 `apps/desktop/workbench-plugin` 客户端半边（仅 DeepSeekGUI 合成），只走官方 slot，并拥有三个字典命名空间（既有 `deepseekgui.workbench`，另加 `deepseekgui.tools` 与 `deepseekgui.inspector`）。
- keyed `tool.call.toolview` 行接管 23 个 DeepSeekGUI wire key（8 个 git 状态/差异/index 动词、`git_commit`、`git_push_preview`、`git_push`、`pr_availability`/`pr_existing`/`pr_create`，以及 12 个 `browser_*` 工具），对这些调用替换 generic 回退。行折叠为 状态点 + 标题 + 一行结论（失败时为首行失败文案，用错误色）；展开后「完整输出」与「调用参数」收进原生 disclosure 小节，并列出解析出的 diff 文件与 staged/unstaged/untracked/conflict 计数。行模型是冻结调用切片的纯函数；因为客户端只见渲染后的文本，解析器以 coding-tools 的确定性渲染文本为目标，畸形输入时优雅降级为可读首行。
- 人类输入在所属卡片中打开。[当前检查裁决](../feature/2026-09-05-workbench-current-inspection.zh.md)负责保留草稿的 Session 发送与基于元数据的推送预填；表单不直接执行工具，也不绕过 P4 审批门。
- 统一的头部入口打开 Files、Changes、Runtime detail、会话树与记忆。[只读适配器](../../../../packages/api/workbench-inspector/README.zh.md)拥有当前文件系统/Git 读取；提交、推送与 PR 历史保留工具、时间与序号来源。Runtime detail 读取官方投影，检查器关闭时不轮询。
- 已接受的 Host 插件/Remote 读取路线由当前检查裁决实现。在 Electron 中并行实现另一份 Git 的替代方案仍被否决。

## 备选方案

- 在 P5 内重建文件系统/Git 实时现查通道（桌面 git CLI 双轨或第二条 host 通道）；否决——接受的路线是后续官方 gateway/typert 只读查询域提案，面板改为展示带出处的窗口聚合与明确空态。
- 为检查与人工输入恢复独立工序页与顶部平铺标签；否决——检查收进统一入口，人工输入在所属卡片上开小表单。
- 表单提交时由卡片直接执行工具；否决——表单只经官方 composer 队列发送用户指令，P4 审批门保持不变。

## 验证

- `tsc -b apps/desktop/workbench-plugin` 干净；`oxlint` 对插件源码与测试 0 错误；7 个文件 49 项聚焦测试通过（注册面含全部 23 个 key、纯卡片模型、纯检查器聚合、jsdom 行/检查器呈现与表单发送）。组件规格需在 `NODE_ENV=test` 下运行，因为本沙箱导出 `NODE_ENV=production`，会把 React 解析到生产构建并破坏 `act()`（仓库已知的 jsdom 基线）。
- `verify-client-ui-i18n` 绿（481 个客户端 UI 文件）、`verify-client-packages` 与 `verify-package-dependencies` 绿；workbench 客户端 bundle 经其 tsdown 配置重建（75.6 kB `lib/client.js`）。
- 真实路径冒烟：桌面 Electron 对真实 dsh 0.1.2 服务启动打印 `[deepseekgui] window loaded`，插件模块无 loader 或控制台错误。普通分辨率人工目检与模型驱动端到端证据交给验收。

## 影响

- 标注的会话历史与当前 owner 查询保持区分；只读适配器不消耗模型轮次即可提供当前文件/Git 事实。
- `conversation.session.header.utilities` 迎来首个占用者；后续阶段（P7 的 Memory）可在同一入口后注册更多检查器面板。
