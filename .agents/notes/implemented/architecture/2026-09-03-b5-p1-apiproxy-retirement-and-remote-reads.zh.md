# Agent Note: B5-P1 — APIProxy 退役与桌面官方 Remote 读取

Status: implemented

[English](2026-09-03-b5-p1-apiproxy-retirement-and-remote-reads.md) | 中文

## 问题

dsh 0.1.2 移除了 DeepSeekGUI B4 GUI 所依赖的 APIProxy host RPC 层。保留的 `packages/host/apiproxy` 树引用了 0.1.2 已删除的模块（其官方域文件在上游合并中被移除），无法编译。每个运行时调用方都指向死端点：Workbench 浏览器插件（`task.*`/`fs.*`/`git.*`/`pr.*` HTTP 客户端，`POST /api/<域>.<方法>`）与 Electron 主进程（`harness-api` 的 settings/session/task RPC、`harness-events` 的 WS `events.mux`/`events.host` 通知流）。B5-P0 已把该包移出构建图作为 P1 迁移输入，并把 `workbench-plugin` 移出 client 图直到 B5-P2；P1 真正退役代理，把读取面迁到官方 Remote 端点，不重建相似物。

## 决策

旧 APIProxy 面在 B5-P1 整体退役；每个旧调用方要么迁到官方 0.1.2 Remote 方法，要么删除并记录其恢复 Phase：

| 旧面 | 处置 | 官方等价 / 恢复 |
|---|---|---|
| `packages/host/apiproxy`（schema、handler、client、tests、exports、tsconfig 别名/排除、tsdown workspace 条目、生成器豁免、子系统文档） | B5-P1 删除 | 无——官方域早已由 2026-08-10-unary-apiproxy-remote-migration 笔记迁到各业务 Remote owner |
| 主进程 `harness-api` 的 `settings.describe`/`settings.mutate` | 迁移 | `settings/describe`（无参）、`settings/mutate`（平铺 args `{ ns, ops, expectedRevision? }`） |
| 主进程 `session.list`/`session.create`/`session.prompt` | 迁移 | `session/list`（单 request 端点，host 参数名为 `_request`，故 args 为 `{ _request: {} }`）、`session/create`/`session/prompt` 包为 `{ args: { request } }`；`session/prompt` 需要客户端 mint 的 `requestId` |
| 主进程 `session.history` 尾页轮询（feedback AI 草拟） | 删除 | 0.1.2 无 unary 尾页（`session/page` 需要 follow 开帧 cut；`session/follow` 是流）——feedback 的 AI 草拟暂停在静态模板，随官方 follow/WS 通道恢复（B5-P2/P6） |
| 主进程 `task.get`（Task Terminal cwd、已声明服务 URL 核对） | 删除 | `show-task-terminal`/`open-service-url` 命令退出控制模型与分派器；工具原生任务路径恢复该入口（B5-P4） |
| 主进程 `harness-events`（`events.mux`/`events.host` WS 通知） | 删除 | 端点已消失且线协议无 0.1.2 等价物；桌面通知暂停（服务、去重记忆与点击导航接线保留在 git 历史），随官方 gateway WebSocket 与 token 对齐恢复（B5-P2/P6） |
| `workbench-plugin` B4 会话视图（Files、Session Changes、Tasks、Repository Changes、Commit、Push、Review）与其 `fsClient`/`gitClient`/`taskClient`/stores | 删除 | 插件只保留品牌席位、会话头徽章与桌面状态动作。恢复：编码动作改经 DSH 工具进入（结果写入会话事件，B5-P4）；Files/Changes/Git/Review 检查改经官方投影的按需检查器（B5-P5）；直接会话入口终结 Tasks 导航角色（B5-P3）；插件本身重新挂到 0.1.2 client 模块（B5-P2） |
| Session 事件读取（workbench） | 原则上迁移 | 客户端不再持有第二份完整 events；官方 `ctx.sessions`/`SessionEventStream`（`session/page`/`follow`、seq 游标、`loadOlder`/`loadThrough`）是替代读取路径，随 B5-P2 挂载插件 |

B5-P1 之后不存在旧代理的兼容 shim、别名或改名重建。生成器源（catalog/doc-graph）在同一变更中同步编辑；重新生成的产物归属验收构建。

## 备选方案

- 迁移期间让旧 APIProxy HTTP 域与官方 Remote API 并存（两套线上平面、两套鉴权路径）；否决——退役一步到位，只走官方 Remote 与单一 cookie/token 通道。
- 把 B4 的 Files/Changes/Tasks/Git/Review 视图原样搬到官方客户端上（它们对话的是已删的 `task.*`/`git.*`/`fs.*` 域）；否决——视图随域一起退役，再按阶段以官方投影与工具回归。
- 桌面读取用页面里存的长效 token 鉴权，而不是经服务 stdout 交换的一次性启动 token；否决——一次性通道加 cookie 让凭据面最小。

## 验证

- 桌面 host 图 typecheck 通过（`tsc -b apps/desktop`）。
- 聚焦单测全绿：apps/desktop tests（152 项，含重写后的 `harness-api.spec.ts` 端点/args/信封用例）+ node 环境 workbench specs（`apply`、`bridge`）。jsdom workbench specs 挂在插件私有 `node_modules` 的既有 React 生产构建解析问题上，owner B5-P2。
- 真实路径检查通过（B5-P1 返工）：迁移后的主进程客户端经官方一次性 token 交换（`GET /?token=` → 会话 cookie）鉴权，对真实 dsh 0.1.2 web 服务调用 `settings/describe` 与 `session/list` 均取回 `ok:true`——其中 `session/list` 的 args 按 host 签名 `list(_request, signal)`（typert 网关从签名参数名派生 wire 字段）携带为 `{ _request: {} }`。

## 影响

- B5-P1 后无人再 import `@deepseek-ai/dsh-host-apiproxy`：剩余文本引用只存在于冻结的归档笔记与 `apps/desktop/runtime.package-lock.json`（由 B5-P9 打包流程重新生成）。
- B4 平铺标签在其 B5-P5 替代物之前消失，因此 P2 前的 Workbench 只显示品牌/状态——这是 P0/P2 已定的排期，不是静默缺口；每个删除项都标注了恢复 Phase。
- 2026-09-01-b4-p1-task-repository-ownership 笔记在同一变更中移入 `archived/feature/`；其机制已被本次退役取代。
