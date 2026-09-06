# Agent Note: B3-P1 Direct Composition Spike — Workbench 产品插件

Status: implemented

[English](2026-08-31-b3-p1-direct-composition-spike.md) | 中文

## Problem

DeepSeekGUI V1 只是官方 DSH Web UI 的桌面包装。自己的身份止步于构建期品牌注入（`DSH_CLIENT_BRAND_NAME`，见 `scripts/build-web-branded.ts`）和四条 launcher overlay（皮肤、目录选择器、设置、浏览器）。其中没有任何一条证明：DeepSeekGUI 自研的产品插件可以骑在官方 client-runtime 与 UI 状态机上完成一条真实 Session 路径。B3 Workbench 在做任何自有界面之前需要这个证明——没有它，B3-P2 之后就有重造第二套客户端框架的风险，而这是 B3 地基明令禁止的。

## Decision

`apps/desktop/workbench-plugin/` 作为第一个 DeepSeekGUI Workbench 产品插件（`@see-sol-lab/deepseekgui-workbench`）随包存在，保留 TypeScript/React 源码与正常构建。它经 launcher `--patch` overlay（`deepseekgui-workbench.patch.yml`，`resolveDshLaunch` 里的第五条 overlay）进入 composition，与皮肤/设置分区完全同形：经 `ensurePluginResolvable` 从 profiles 模块 fallback 解析，绝不写进任何 Profile 清单，用户裸跑 `dsh web` 看不到，卸载零残留。

插件只注册两样东西，全部走官方 slot 系统（`ctx.slots.inject`，槽位由 `ui-sidebar` / `ui-conversation` 声明）：

- DeepSeekGUI 品牌：`sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark`；
- 一个可见的 Workbench 标识：`conversation.session.header.actions` id `deepseekgui-workbench`（order `-10`，作为交互动作之前的静态身份）。

不注册任何服务、路由、RPC 或状态。Workspace 选择、Session create、prompt、流式输出、Tool 卡片与恢复全部留在官方 `ui-layout` / `ui-sidebar` / `ui-workspace` / `ui-conversation` / `ui-tool` 栈上，跑在同一个 Harness runtime 里。client bundle 由包内 tsdown 配置从 `lib/types/client/index.js` 构建（与官方 `clientBundle` 预设同一产物契约：`window.__ModuleLoader__.load({ id, factory })`、经 loader require 解析模块表 external）——因为该预设的 workspace 扫描只覆盖 `packages/*/*`。`build:desktop` 编译本插件（`tsc -b` 加入 `apps/desktop/workbench-plugin`）并产出 bundle；`build-desktop-dist.ts` 经 `shipWorkbenchPlugin` 随包发送，并在打包时刻断言非空的 `lib/client.js`。

## Alternatives considered

**像 theme/settings 一样手写 `lib/client.js`。** 现有插件证明了这种形态可行，但 B3 代码归属规则要求产品插件保留 TypeScript/React 源码与正常构建；大段手写 bundle 不是长期源码。

**放进 `packages/client/`。** 那样能满足官方预设的 workspace 扫描，但 B3 地基把 DeepSeekGUI 产品代码划给 `apps/desktop/workbench-plugin`（`@see-sol-lab/*`）；`packages/` 只收通用 DSH 能力。

**复用 `packages/client/tsdown.client.ts` 的 `clientBundle`。** 它的 `workspaceManifest()` 只 glob `packages/*/*/package.json`，对任何其他位置直接 throw；为一个调用方放宽预设不值得。

**经控制桥或 chrome 注册。** 品牌槽位正是官方的增量扩展点，会话 header 标识是增量的 per-session 席位；不需要也不新增任何 Host RPC。

## Consequences

通用品牌槽位现在由 DeepSeekGUI 占用（官方 occupant 只在 `official` 构建 profile 下注册，因此没有冲突）。插件缺失或构建失败时退化为纯官方 UI，而不是启动失败——与其他四条 overlay 同一条「解析不了就不带 overlay」规则。`main.ts` 的 client settle 门禁仍把 DeepSeekGUI client 插件激活失败当作启动失败，所以空心随包会大声失败而不是悄悄丢品牌。开发多了一步构建：插件改动要进 `dev:desktop` 需先跑 `pnpm run build:desktop`；插件自带测试与 `dsh-service` overlay 测试钉住 launcher 接线。
