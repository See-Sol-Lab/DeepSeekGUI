# Agent Note: B3-P7 Desktop Integration — 控制桥 revision 门控与会话对齐的终端 cwd

Status: implemented

[English](2026-08-31-b3-p7-desktop-integration.md) | 中文

## Problem

对照当前代码逐项核实 P1–P6 迁移表后，仍存两个桌面缺口：

1. 官方设置页里的 DeepSeekGUI 分区（settings-plugin）每 2 秒轮询本机回环控制桥，且是**无条件全量拉取**：`GET /control/model` 永远返回整个序列化的 `DesktopControlModel`（几十 KB），插件每个 tick 都重设 React 状态，即使什么都没变。
2. DSH Terminal 的 cwd 钉死在 active Profile 目录（再回退 Harness Home），对 Workbench 当前会话毫无感知——正在某个会话里干活时开终端，落点与手头的事无关。

## Decision

**Revision 门控的控制模型**（`apps/desktop`）：

- `DesktopControlModel` 与 `ControlModelInput` 携带 `revision`——内容版本号，只在 main 一处维护。`buildModel()` 用新构建模型的 JSON 指纹对比盖章：**只有模型内容真正变化时 revision 才递增**，重发相同内容的广播不会虚增。
- `GET /control/model?since=<revision>`：调用方 revision 是最新时只回小信封 `{ revision, changed: false }`；否则回完整 `{ revision, changed: true, model }`。`parseModelSinceParam`（纯函数，已测）把缺失/空/非数字/负数一律视为「取全量」。`POST /control/command` 本就返回命令后的模型，现在模型自带 revision。
- settings-plugin 的 `useDesktopModel` 与 Workbench `DesktopActions` 保持 2s 节奏但带 `?since=`，`changed: false` 时不更新状态；命令响应推进调用方保存的 revision。轮询仍是轮询，但未变化的 tick 只传一个小信封而不是整份模型，且两个消费者都不重渲染未变化模型。

**会话对齐的终端 cwd**（`apps/desktop/src/terminal-service.ts`、`main.ts`）：

- Workbench 动作读取官方 client-runtime 当前选择，只把 `sessionId` 经既有 `show-terminal` 命令送出。命令解析器接收托盘/chrome 的裸形态，或只多一个非空 `sessionId` 的形态；额外键与非法 id 一律拒绝。
- Main 用该 id 查询权威 `session.list`，只把匹配项的 cwd 交给 `resolveTerminalCwd`；浏览器从不提供路径。Session 缺失、过期、没有 cwd 或不可达时，沿用 Profile 目录 → Harness Home 回退链。托盘与 chrome 命令不带 Session，直接使用该回退链。

## 已核实为现状（迁移表条目，无需改动）

Home watcher 已在 Home 切换时重挂（`watchHarnessTheme` 每次经 `followHarnessPreferences` 先 close 再 watch）；故障态主窗口已有 Restart（chrome 菜单与托盘同一封闭命令联合）；托盘菜单从同一个 `DesktopControlModel` 派生；动态标点、错误与 feedback 模板已在各自 locale owner 下（chrome `view-model` 字典、settings-plugin `STRINGS`、`feedback-issue` 的 zh/en 分支、`english-errors` 守卫）；浏览器 pane 的 viewport 在窗口 resize 时事件驱动重排（`layoutViews`，无轮询）；控制桥就是那一条命令总线（没有第二条）。

## Alternatives considered

**给控制桥加推送通道（SSE/长轮询）。** 事件推送能彻底去掉设置分区的轮询，但桥是普通回环 HTTP 对，分区住在官方页面里；推送通道意味着 main 里新增长连接、重连状态与生命周期处理。revision 门控保留既有请求/响应形态，只消除真正的成本（全量模型传输）——缺口要的正是这个。

**由浏览器发送 cwd。** 让浏览器提供绝对路径会把控制桥变成路径授权方。发送官方当前 Session id，既让选择继续由 client-runtime 持有，也让 main 从 Harness 事实解析 cwd，无需保存第二份选择。

**终端 cwd 继续钉在 Profile 目录。** 那是迁移表标记的旧行为；会话 cwd 只在会话真实存在时优先，回退链不变，纯 Profile 工作流不受影响。

## Consequences

设置分区与 Workbench 动作不再每个 tick 重下整份控制模型；Workbench Terminal 无需信任浏览器路径，就能在选中 Session 的 workspace 打开。托盘与 chrome 保留明确的 Profile/Home 回退。实现复用既有 terminal service、browser plugin、control bridge 与官方当前选择，没有新增持久状态。聚焦组件与桌面测试覆盖条件轮询、命令 revision 更新、当前 Session 派发、精确命令解析、权威 cwd 解析、非法 id 与回退行为。
