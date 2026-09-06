# Agent Note: B3-P9 验收修复——精确 Session 归属与隔离证据

Status: implemented

[English](2026-08-31-b3-p9-acceptance-repair.md) | 中文

## Problem

B3 要求每个 Workbench 动作和异步结果继续归属用户选中的 Session。缺少这层归属时，Files 响应可能结算进另一个 Session 的视图，状态轮询可能传输未变化的完整模型，Terminal cwd 也可能跟随全局最近活动而非当前选择。验收实例还需要自己拥有的端口，用户路径打码则必须把系统提供的 8.3 别名与同一 Home 的长名视为同一事实。

## Decision

### Session 拥有的异步工作

每个 Files 视图为一组 `(sessionId, cwd)` 持有一个请求 generation。Session/cwd 改变或组件卸载时取消该 generation、替换 pending-path 集合，并阻止所有迟到的成功、失败或结算回调修改新视图。`DesktopActions` 经既有条件端点携带上次 desktop-model revision，收到 `changed: false` 时不修改 React state。

### 精确的 Terminal 与测试实例身份

Workbench 经既有封闭 `show-terminal` 命令发送官方当前 `sessionId`；main 从匹配的 Harness Session summary 解析 cwd。浏览器无法提供路径，没有有效 Session 的命令使用 Profile/Home 回退。打包 e2e 经 `DEEPSEEKGUI_TEST_PORT` 独占 3081；readiness、URL、Compatibility View、进程定位、清场与 teardown 消费同一个测试事实，生产继续使用 3080。

### Windows 路径别名

`maskWindowsLiterals` 把系统解析出的同一 Home 各种写法替换成一个占位符。Main 在 Windows 上启动时只探测一次真实 8.3 Home 写法，并把 alias 集合交给界面打码与诊断归一化；绝不猜测 `~1` 名称。公开截图显示占位符，不显示本机长路径或短路径。

## Verification

延迟响应组件测试在 A 结算前从 Session A 切到 B，证明 B 会发起自己的根请求，且 A 无法发布条目、预览或错误。条件轮询测试覆盖首次全量读取、`since`、未变化信封、命令 revision 更新、失败恢复与卸载。桌面测试覆盖 Terminal 裸命令／带 Session 命令解析、非法载荷拒绝、精确 Session cwd 解析与回退。端口和路径测试固定隔离 e2e 环境与系统派生 alias 打码；解析层回归用例覆盖带 Session 命令全部允许与拒绝的 wire 形态。

## Alternatives considered

**让 pending path 在组件内全局共享。** `''` 等路径只在一个 Session 根下有意义；跨 Session generation 共享会压掉新根请求并发布旧数据。

**用最新或运行中的 Session 决定 Terminal cwd。** 最近活动不等于当前选择。多个 Session 活跃时会打开另一个仓库，而官方 client 已经持有当前 id。

**经控制桥发送 cwd。** 这会把浏览器输入当成宿主路径授权。发送 Session id 后，main 可以从 Harness 解析路径，无需第二份选择 store。

**e2e 前清场生产端口 3080。** 测试并不拥有住户应用。独立固定测试端口提供确定性清理，无需生产多实例机制。

**猜测用户的 8.3 名称。** 短名分配是 Windows 文件系统事实，不是字符串惯例。只有系统真实解析出的 alias 才能进入打码集合。

## Consequences

Files 为每个可见 Session generation 持有一个 AbortController 与 pending ledger。Workbench 状态保留低频请求，但未变化的 tick 只携带 revision 信封。`show-terminal` 新增可选且经过验证的 Session id，不增加持久状态；非 Workbench 调用方保留原回退。测试实例可以与住户产品并存，路径打码在启动时执行一次 Windows alias 探测。没有新增 Agent runtime、Session store、命令总线、文件系统实现或 B4 Git/worktree 状态。
