# Agent Note: B3-P2 Workbench Shell — 桌面动作与内置插件来源

Status: implemented

[English](2026-08-31-b3-p2-workbench-shell.md) | 中文

## Problem

B3-P1 证明了 DeepSeekGUI 产品插件可以骑在官方 client 栈上。但 Workbench 还缺日常外壳：普通用户在官方界面里没有桌面工具（终端、浏览器面板、Compatibility View）的入口，也看不到 Harness 状态——那些只活在托盘和 chrome 里。同时插件管理只显示三个 inventory 分类（profile bundles、已装依赖、loader 事实）；DeepSeekGUI 随包的五条 launcher overlay 插件对它不可见，用户可能再装一遍——给已经内置的东西开重复入口。

## Decision

两处增量，都落在既有接缝上。

**Workbench 桌面动作**（`apps/desktop/workbench-plugin`）：插件注册官方 `sidebar.footer.action` list 槽位（id `deepseekgui-desktop`），渲染 `DesktopActions` 组——DSH 终端（`show-terminal`）、浏览器面板（`browser-pane-toggle`）、Compatibility View（`open-compatibility-view`）与实时 Harness 状态。状态保留既有 2 秒请求节奏，但经 `/control/model?since=` 发送上次 control-model revision；未变化的 tick 只携带 `{ revision, changed: false }`，且不更新 React state。终端动作只携带官方当前 Session id，绝不携带浏览器提供的路径。所有命令经既有本机回环控制桥，与 Chrome 菜单、托盘同一封闭联合；没有第二命令总线。组件从页面 URL（`deepseekgui-control`）读桥，外部浏览器标签页整组不渲染。中英文案走插件自己的 `deepseekgui.workbench` locale namespace；侧栏收起时渲染 rail 图标组。

**Compatibility View 是真实切换，不是第二个 runtime**：`open-compatibility-view` / `open-workbench` 命令（加入封闭命令联合）翻转内存里的 `workbenchViewMode`，经既有控制器路径重启 Harness，运行中走既有 disrupt 确认。`resolveDshLaunch` 在 compatibility 模式下跳过 workbench overlay——同一 profile 启动为官方 DSH Web UI；托盘菜单提供返回入口（也提供切过去入口）。模式刻意不持久化——应用重开默认 Workbench。

**内置插件来源（B3-13）**：`plugin-service.ts` 声明 `BUILTIN_PLUGIN_NAMES`（五个 `@see-sol-lab/deepseekgui-*` 包），inventory 里同名的 bundle/依赖标记 `builtin`，并拒绝 `add`/`update` 内置包名（`remove` 放行——用户手动装进 profile 的那份可以移除，overlay 不受影响）。控制模型携带内置列表，settings 插件渲染为只读的「DeepSeekGUI 随包内置」块 + 「已内置」标签，add spec 命中内置包名时给出明确提示并禁用执行钮。

## Alternatives considered

**为动作新建全局 header 槽位。** 官方 `ui-layout` 没有声明全局 header 洞，B3-P2 又禁止 DeepSeekGUI 私有 UI 注册系统；侧栏底部 list 是既有的 root-scoped 增量席位，窄窗口自动退化为 56px rail。

**Compatibility View 用外部浏览器标签页。** 那不是官方界面：overlay 属于服务端 composition，系统浏览器打开同一 URL 看到的仍是带 Workbench 插件的页面。只有不带 overlay 重启才是真正的官方 UI，而规格明确允许走既有控制器与确认路径重启。

**把视图模式持久化进 launcher state。** B3 规格说 v1 无需持久化选择、应用重开默认 Workbench；内存标记保持 launcher-state schema 不动。

**把内置列表做成独立的模型分类。** 内置插件不是 profile 事实（三个 inventory 分类原样不动）；只读块 + 同名条目的 builtin 标记展示了真实来源，不发明第四分类。

## Consequences

侧栏底部现在有三个桌面入口加状态；侧栏收起时保留为 rail 图标。切换视图与重启同杀伤力——因此用同一条确认门铃。Compatibility 模式就是纯官方 UI：没有品牌、没有动作、没有设置分区（那些也是 overlay 插件）；托盘是返回路径。插件管理不再能按名安装内置包，只读块列出全部五个。`main.ts` 多一个内存标记和两个命令 case；launcher-state、profile 与 vendor 一律不动。
