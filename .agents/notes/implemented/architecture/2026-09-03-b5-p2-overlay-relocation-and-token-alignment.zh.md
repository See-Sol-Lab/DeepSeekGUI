# Agent Note: B5-P2 — launcher overlay 落位与一次性 token 对齐

Status: implemented

[English](2026-09-03-b5-p2-overlay-relocation-and-token-alignment.md) | 中文

## 问题

DeepSeekGUI 以五个 launcher overlay（theme、picker、settings、browser、workbench）经 `--patch` 层启动 Harness（绝不写进用户 profile）。dsh 0.1.2 移除 0.1.1 client runtime、重构 client 模块/slot 契约，并引入一次性 launch token 鉴权（入口页、HTTP API 与 WebSocket）。每个 overlay 都要落到 0.1.2 模块上，桌面也要把 token 带进自己的启动路径。

## 决策

- **workbench-plugin** 落到 0.1.2 client 模块：`@deepseek-ai/dsh-client-runtime`（上游已删）的 import 改为 0.1.2 分片类型 merge——`Context` 取自 `@deepseek-ai/cordis`、`ctx.slots` 取自 `ui-renderer`、`ctx.locale` 取自 `client-locale`、`ctx.sessions` 取自 `api-session-controller`、`SessionId` 取自 `dsh-session/types`；tsconfig references 与 `tsconfig.client.json` 聚合条目回归，`dsh.client.inject` 元数据改列 0.1.2 提供包。其注册的槽（`sidebar.brand.mark/name`、`conversation.hero.brand.mark`、`conversation.session.header.actions`、`sidebar.footer.action`）在 0.1.2 全部同名存在。
- **theme-plugin**（手写 `__ModuleLoader__` 产物，产品源）：0.1.1 CSS 的 20 个 `--dsh-*` 字号钩子在 0.1.2 已不存在（官方重构了字阶——迁移要求 7 以官方新版为权威），这些覆盖删除；0.1.2 仍存在的 `--dsw-*` alias token 覆盖（透明底、玻璃侧栏、审批蓝、浅色用户气泡）保留。`inject ['theme']` / `ctx.theme.overrideTokens` 在 0.1.2 不变。
- **settings-plugin**（手写产物）无需改动：其 `settings.section` 与 `conversation.session.header.utilities` 注册、register options（id/order/label/locale）与 `props.t` locale 席位与 0.1.2 契约逐字一致。
- **browser-plugin** 加入 `pnpm-workspace.yaml` 成员：pnpm 非 hoist 布局下其运行时 import（`@deepseek-ai/dsh-tools` 等）无法只靠 profile 侧 junction 解析；成为成员后 launcher 的 `--patch` host 行在 0.1.2 干净装载。
- **picker-plugin** 保持打包态专用（缺陷只在打包态出现）：overlay 的 `disabled: true` 目标行 id `directory-picker` 在 0.1.2 web-app bundle 中仍在；产物 seam（`DirectoryPicker` 子类、native capability）与 0.1.2 `@deepseek-ai/dsh-host-directory-picker` API 一致。官方 Windows picker 修复是否让补丁可删，是打包态验收项，移交 B5-P9（开发态无法复现 koffi/Electron realm 崩溃）。
- **启动鉴权（桌面）**：stdout 按完整行解析，launch token 仅存内存，日志和控制台接收脱敏文本。导航前主进程将 token 换成官方 cookie 并安装到 Electron 会话；页面 URL 仅携带桌面桥参数，Node API 使用同一 cookie。每次 spawn 清除两份凭据，避免官方重定向丢失控制桥。

## 备选方案

- 在官方页面上保留 B4 自绘 overlay，并原地迁移 APIProxy 面（同一功能在两个平面长期双轨）；否决，改为一步把 overlay 迁入 launcher patch 层。
- 直接注入凭据让桌面页持有持久会话，而不是经服务 stdout 交换一次性 token（凭据面更大）；否决，改为一次性 stdout token + cookie 交换。
- 把 overlay 写进用户 profile 清单（污染用户资产、卸载要清理）；否决，改用 launcher `--patch` 层，profile 零残留。

## 验证

- Electron smoke（`DSH_DESKTOP_SMOKE=1`、隔离 `--user-data-dir`）：窗口加载 token URL、官方 UI 挂载、theme overlay 的 client settle 标记生效——同一轮 composition 证明 theme/settings/workbench 的 client 行装载成功、其 slot 注册全部解析。退出码 0。
- 带 theme/settings/browser/workbench `--patch` 层的真实 0.1.2 服务无 loader 错误启动；经 token→cookie 流程的 `settings/describe` 与 `session/list` 取回 `ok:true`。
- 桌面 specs：37 文件 / 841 测试通过（含新增 `harness-auth.spec` 与更新的 `dsh-service.spec`）；`tsc -b apps/desktop` 与 `tsc -b apps/desktop/workbench-plugin` 干净；workbench 的 apply/bridge specs 通过。

## 影响

- 五个 overlay 不再有任何 0.1.1 runtime import；唯一剩下的打包态门禁是 picker 去留，owner B5-P9（精确验收步骤在 P2 交付报告里）。
- jsdom 组件 specs（workbench 的 brand/desktop-actions，与官方 client 包一样）仍全仓挂在本环境的 React production build 解析问题上；该问题早于 B5-P2，不属于本 Phase diff。
