# Agent Note: B5-P6 — 交互与后台连续性

Status: implemented

[English](2026-09-04-b5-p6-interaction-and-background-continuity.md) | 中文

## 问题

B4-P8 的通知消费两条 SSE 流（`events.mux` / `events.host`），它们随 APIProxy 退役（B5-P1）一并删除，桌面只剩一个空的事件脚手架，审批、询问、后台完成与点击回会话都没有产品路径。GUI 不得为运行中插话增加第二条队列、不得从已退役的 task 表反推 job/验证/服务状态，也不得重建官方连接已拥有的 heartbeat/reconnect 逻辑。

## 决策

- 运行中插话完全走官方：GUI 不加队列、不加 steer 机制——composer 排队与官方 queue dock 是唯一路径。
- Web 消费者观察官方待处理交互与 job 列表。审批按关联 call id 去重，无关联时用待处理请求 key；询问使用请求 key，不用可重复的问题项 id。Job 通知沿用 completed/failed 变迁与首见基线抑制。了解 Session 的消费者仅抑制正在查看的事实，桌面不再额外按整个窗口焦点过滤。
- 桌面显示经鉴权且限长的 notify 命令，点击时写入一次性 navigateRequest。既有 Workbench 消费者打开准确的目标 Session，通知状态与重连仍由已有 owner 负责。
- Runtime detail 扩展只读 owner 行（B5-P6 裁定）：后台 jobs 与子代理会话按官方列表原样展示；Plan/Todo/Goal 投影单行事实（`plan`/`goal`/`todos` 三个键做结构化收窄）；待审批/待询问标记取自官方 interaction 事实。无状态机、无本地聚合、无交互动作（不可启停/勾选/改动）；验证与服务只在官方以 job 形态发布时显示——绝不从 task 表或历史事件反推。
- 进程唯一 owner 保持不变并已验证：stop 与应用退出早已等待完整 DSH 进程树（`taskkill /T` + 重试/等待）、终端树与插件操作树结束；会话结束的取消是官方工具/Agent 语义。未引入任何新 owner。

## 备选方案

- 让桌面主进程自建官方 gateway WebSocket 连接（打包第二套连接客户端并重实现其补偿）；否决——事实由官方 Web 连接消费，无状态控制桥只承载一次性通知。
- 在官方连接旁保留本地心跳/重连补偿；否决——随退役事件流脚手架一并删除。
- 从已退役 task 表向 Runtime detail 推断 job/验证/服务状态；否决——行来自 owner（jobs 列表、投影、pending interactions），只读。

## 验证

- 插件：`tsc -b apps/desktop/workbench-plugin` 干净，oxlint 0 错误，63 项聚焦测试通过（注册面含 notifier 条目与第四个字典命名空间、notifier-model 去重/基线规格、owner-facts 收窄、jsdom watcher 一次性行为、control-model notify 解析用例）。
- 桌面：`tsc -b apps/desktop` 干净；control-dispatch/harness-controller/dsh-service/quit-confirm 套件通过（129 项）。
- `verify-client-ui-i18n` 绿。真实路径冒烟：桌面 Electron 对真实 dsh 0.1.2 服务打印 `[deepseekgui] window loaded`，无 loader/控制台错误；退出后服务端口释放、无孤儿进程。通知视觉行为与模型驱动端到端证据交给验收。
- `apps/desktop/src/main.ts` 中三处既存 `no-unnecessary-condition` 提示（本次未触碰的 spawn stdio 行）已确认在已提交 HEAD 上同样存在，属基线债，留待归属方清扫，不在本阶段静默改动。

## 影响

- 通知诊断使用控制响应和页面状态。[当前检查裁决](../feature/2026-09-05-workbench-current-inspection.zh.md)拥有已实现的 fs/Git 查询路线，不引入桌面事件流或重复重连循环。
