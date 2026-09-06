# Agent Note: B5-P7 — 会话记录树与扁平文件记忆

Status: implemented

[English](2026-09-04-b5-p7-session-tree-and-flat-file-memory.md) | 中文

## 问题

B5-P1..P6 之后 GUI 仍看不到也无法恢复持久会话历史，也没有产品级记忆：每个新会话窗口都要项目重新自我介绍。本阶段要求只读会话记录树（父子/fork 事实取自官方 JSONL）加 Claude Code 档基础记忆——并带 B7 红线：不实现专用 recall/write 工具、记忆引擎、检索/向量、Persona kernel、MCP 适配器。

## 决策

- 记忆为两份扁平文件（句芒裁定取代此前的索引设计；无索引、无一事一文件、无目录结构、无元文件）：`<DSH home>/memory.md`（跨项目用户偏好，模型只读）与 `<项目工作目录>/memory.md`（本项目事实，模型用普通 fs 工具维护）。项目记忆位于工作区内，官方 workspace-write 语义天然成立——无新权限面、无后门、绝不以 full-access 为默认。已核实官方 0.1.2 没有目录级可写声明面（可写根只由模式派生），因此全局文件由用户编辑（桌面主进程按本机权限写盘），不由模型写。
- 注入走官方 system-prompt 上下文及变量值，正文中的模板语法保持字面意义。WeakMap 按已加载 Session 首次捕获两份文本，后续步骤不再读文件；卸载并重新打开 Session 后才读取编辑结果。官方上下文事件记录注入内容，缺失和空文件有明确状态。
- Host 代码在 `src/session-memory.ts`，资源相对路径同时适用于 `src/` 与打包的 `lib/`。浏览器代码在 `src/client/memory/` 和 `src/client/tree/`。全局记忆保存复用桌面原子写入器，错误传回控制响应，面板仅确认成功。
- 记忆面板不引入第二个数据面：打开文件管理器与保存全局记忆是封闭桌面命令（只传 `sessionId`/`which`/`content`；main 从权威事实推出每条路径——active home 或官方 `session.list` 的 cwd）。读内容与维护项目文件经官方 composer 请助手执行。面板文案区分 AGENTS.md（人写的项目说明书）与 memory.md（积累的事实），并提示项目记忆可能被提交——是否加 `.gitignore` 由用户决定。
- 会话记录树是官方会话列表 lineage（`parentId` 即 JSONL 的 `parentSession`，fork 与 subagent 同源）的只读平铺，渲染在既有按需检查器内；点击一行 = 打开（恢复）该官方会话。无第二份会话存储、无可操作树。

## 备选方案

- 最初规划的“索引 + 一事一文件 + 目录 + 元文件”布局；被扁平文件裁定取代——当前规模两份文件即够，不建索引层。
- 把记忆放在工作区外的 DSH home 并由模型写入（需要 0.1.2 没有的目录级可写声明面）；否决——全局文件由用户经桌面编辑，项目记忆放工作区内、走 workspace-write。
- 提供专用 recall/write 工具或任何记忆引擎/检索/Persona/MCP 面；被 B7 红线否决。

## 验证

- 插件：`tsc -b` 干净；oxlint 0；70 项聚焦测试（host 记忆文本/三态、树平铺含孤儿/环/空态语义、记忆命令 parse、完整注册面）。
- 桌面：`tsc -b apps/desktop` 干净；control-model 套件 62 通过；`verify-client-ui-i18n` 绿；客户端 bundle 已重建。
- 真实路径冒烟：桌面 Electron 对真实 dsh 0.1.2 服务启动成功（`[deepseekgui] window loaded`），无 loader/控制台错误；退出后服务端口释放、无孤儿进程。
- 模型驱动证据（A：会话中模型用 fs 工具落一条项目事实 → 新窗口可见；B：树上恢复会话 → 继续对话）需要真实模型，交给验收环境；本机 harness 无 key。
- 测试数据全部为合成（临时文件）；无真实关系、凭据、个人路径或私密记忆进入仓库。

## 影响

- workbench 插件经 P5–P7 连续增肥（卡片、检查器、notifier、owner 行、记忆、树）；交付报告记录当前文件数与职责分区，供 P8 决定是否按职责再分层。
- 官方可写声明面（或 B7 Memory Core）出现时，全局文件可无痛迁移/升级：契约文本与桌面命令是它路径的唯二 owner，权限门不动。
