# Agent Note: B3-P6 Archived Sessions — 取消归档操作与 Current/Archived 视图

Status: implemented

[English](2026-08-31-b3-p6-archived-sessions.md) | 中文

## Problem

注册表级全局归档集合（`archivedSessionIds`）已经能把会话从所有分组视图中隐藏，行菜单也能归档会话——但没有任何回头路：全栈没有取消归档操作，也没有任何表面能看到已归档会话。误归档的会话对 UI 永久消失（只能手工改状态恢复），ui-workspace README 把该缺口列为已知限制。

## Decision

**一路到底的最窄取消归档操作**（`packages/workspace/workspace`、`packages/host/apiproxy`、`packages/client/runtime`）：

- `WorkspaceRegistry.unarchiveSession(sessionId)` 从持久归档集合中移除一个 id。id 不在集合时直接完成而不写入（`archiveSession` 幂等的归档镜像），绝不触碰 workspace 记账——归档保留 `sessionIds` 席位正是为了让取消归档恢复原位置。既有的 `domain/changed` diff 已对每次归档集合写入广播，因此 `host/archived-sessions-changed` 帧对取消归档自动触发，无需新事件代码。
- `workspace.unarchiveSession` 加入网关契约（`api/workspace.ts`）、zod schema、unary 路由表与 carrier client——与 `archiveSession` 同形：入参 `{ sessionId }`，出参**完整更新后集合**。客户端 runtime 的 `WorkspaceManager.unarchiveSession` 把该回声集合装进共享快照（`installArchived`），与 `archiveSession` 完全一致：客户端绝不维护第二集合，远端 tab 的 changed 帧或重连基线会重新安装同一集合。
- workspace 服务面（`IWorkspaces.unarchiveSession`）与测试替身（connection fixture、runtime/connection fake、test-support workspaces double）镜像归档面。

**Current/Archived 视图与恢复操作**（`packages/client/ui-workspace`）：

- `deriveArchivedRows(list, archivedSessionIds)` 从树所用的同一会话列表源按最新优先推导已归档行——这是已归档会话唯一出现的表面（所有分组推导都排除它们）。
- 宽屏浏览器在树／平铺列表下方钉住一个 **已归档** 分区（自带分隔线，无需滚动列表即可触达）：头部带行数，每行一个已归档会话——标题、相对时间、单个文本 **恢复** 操作（该行不可打开：runtime 会清掉被归档的当前选择，所以会话必须先恢复到其分组才能打开）。搜索激活时（搜索只推导可见会话）与归档集合为空时分区隐藏。
- 行操作经注入的 `unarchiveSession` 面路由到 workspace 服务；失败是非致命 console 诊断，与归档和重排序拒绝同一姿态。

## Alternatives considered

**客户端第二归档集合／本地撤销。** 指令明确：客户端使用 Host 回声，不维护第二集合。每条安装路径（unary 回声、changed 帧、重连基线）都已替换完整集合，本地镜像只会漂移。

**复用行菜单做恢复操作。** 已归档行没有菜单——行不可打开，悬停才出现的省略号入口在一个单一动词必须清晰可读的表面上是不可见的；行上的文本按钮就是这个分区唯一的操作。

**从对话／事件窗口推导已归档视图。** 列表源已携带元数据（标题、新近度），归档集合是权威成员关系——扫事件只会重复状态并违反数据访问阶梯。

## Consequences

完整归档生命周期现在可以往返：归档隐藏、已归档分区展示、恢复回到原分组（或 Ungrouped 桶）。Host 持久化、重连基线、多窗口帧全部走既有的归档集合通道——取消归档操作没有新增任何 wire 事件或状态形态。ui-workspace 的已知限制条目收窄为「无 Session 删除」（删除语义保持待定）。测试：注册表取消归档的持久化／幂等／记账（`workspace.spec.ts`，44 通过）、网关 RPC＋帧回声（`api-proxy-workspace.spec.ts`，23 通过）、客户端回声安装／失败／帧（`workspaces-service.client.spec.ts`，23 通过）、已归档行推导（`tree.client.spec.ts`，28 通过）。浏览器组件规格（`workspace-browser.client.spec.tsx`）为 jsdom 套件，未在施工机运行——本机 vitest jsdom 环境无法加载任何 jsdom 套件（官方 `workspace-browser.client.spec.tsx` 以同样的 `No such built-in module: node:` 失败），故交由验收机运行。端到端 UI 验证（行菜单归档、已归档分区可见性、恢复、刷新持久、内容不变）同样交由验收机；施工机已到达 RPC 边界（archive/unarchive 返回正确的完整集合），但实时浏览器 bundle 需先重建才能探测 UI，验收运行会覆盖这一点。
