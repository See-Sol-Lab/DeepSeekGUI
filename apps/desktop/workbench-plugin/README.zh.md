# @see-sol-lab/deepseekgui-workbench

[English](README.md) | 中文

DeepSeekGUI 的 Workbench 产品插件（B3-P1 Direct Composition Spike；B3-P2 Workbench Shell；B5-P1 在 B4 会话视图标签与其 APIProxy RPC 面退役后重新挂到官方 0.1.2 客户端模块上；B5-P5 新增工具结果卡片；2026-09-06 验收返工把 header 的检查器浮层换成四个会话视图）。它把 DeepSeekGUI 品牌注册进官方浏览器品牌槽位，在会话 header 里放一个可见的 Workbench 标识，把一个不可见的桌面轮询放进侧栏底部席位，为 DeepSeekGUI coding 工具与浏览器工具注册 keyed 工具结果卡片，并在官方「对话 / 轨迹」标签旁边放四个视图——改动、Git、并行工作区、记忆。其余一切——对话、工具卡片、Workspace 与 Session 导航、流式输出——都是原封不动的官方 DSH Web 客户端。

浏览器半边呈现官方 Harness 事实，不增加第二运行时。视图在打开或刷新时查询只读 workbenchInspector Remote，离开视图即取消读取。视图只显示：唯一的桌面动作是在文件管理器里定位文件、复制路径、打开工作区。提交、推送、建分支、worktree 的读写都是对话请求——助手先问、官方审批把关。卡片表单经官方 Session 队列发送文本，不改变输入框草稿或附件。Host 贡献 DeepSeekGUI 指南（随包资产：模型在哪运行、桌面工具怎么用、路径怎么写、记忆规则；没有用户入口）和两份扁平记忆文件——DSH home 下的 `memory.md` 与项目里的 `<文件夹名>.memory.md`——每个已加载 Session 捕获一次，并由官方上下文事件记录；全局文件在设置页（settings-plugin）编辑，项目文件在记忆视图里查看。用户可改的规矩放在官方 agent-instructions 插件加载的 AGENTS.md 里：桌面首次运行时给托管 home 种一份模板，项目模板只按请求写入，两者都绝不覆盖。Windows 下 Host 半边还会在 Harness 进程没有控制台时（Electron 宿主是 GUI 子系统进程）给它锚定一个隐藏控制台：官方沙箱让工具子进程共用宿主控制台而不是自建，没有锚定时每个受限 pwsh 都会弹出可见窗口并抢焦点。控制台在插件加载时分配一次、立即隐藏、绝不持久化；已有控制台（开发者终端）时不动。

## 加载

DeepSeekGUI 启动 Harness 时经 `dsh --patch` 传入 `deepseekgui-workbench.patch.yml`（见 `apps/desktop/src/dsh-service.ts` 的 `resolveDshLaunch`）。overlay 只插一行 loader 条目；包经 profiles 模块 fallback 解析（launcher 的 `ensurePluginResolvable`），绝不写进任何 Profile 清单。用户自己跑 `dsh web` 看不到这一层，卸载 DeepSeekGUI 也在任何 Profile 里零残留。Compatibility View 模式下 launcher 跳过这条 overlay，页面就是不带 Workbench 插件的官方 DSH Web UI（托盘提供返回入口）。

浏览器半边经官方 client loader 注册：

- `sidebar.brand.name` — 侧栏品牌行里的 DeepSeekGUI 名称。标识（侧栏与空会话页）保留官方鲸鱼：DeepSeekGUI 是非盈利的开源 DSH 插件集，不是另一个品牌（2026-09-06 定）。
- 一个 `<style>` 元素（`deepseekgui-skin`）承载官方组件没有 token 钩子时的视觉补丁——目前是输入框下方的会话统计行：0.1.2 去掉 `--dsh-statsline-*` 钩子后，把 v1.0.0 那种居中胶囊、浮层底色的样子补回来。
- `conversation.session.header.actions`（id `deepseekgui-workbench`）— 会话 header 里的只读 Workbench 标识胶囊。
- `sidebar.footer.action`（id `deepseekgui-desktop`）— 桌面模型轮询（`/control/model`，按 revision 门控，仅挂载期间），消费通知点击导航；它不画任何东西——侧栏状态灯与壳的状态胶囊重复，已删。页面 URL 没有控制桥参数（外部浏览器标签页）时该动作不渲染任何内容。
- `sidebar.footer.action`（id `deepseekgui-notifier`，B5-P6）— 隐形通知消费端：观察官方 pending interactions（审批/询问）与官方连接（自带 heartbeat/reconnect，无本地补偿）送来的 job 变迁，按「会话 + 官方事件 id」去重后经控制桥推送一次性 `notify` 命令。桌面保持无状态：只弹系统通知，点击时导航。
- `tool.call.toolview` — keyed 行（B5-P5），接管 23 个 DeepSeekGUI wire key（git 状态/差异/index 动词、commit、推送预览/推送、三个 `pr_*` 工具与 `browser_*` 工具集），替换这些调用的 generic 回退：折叠为一行结论，错误时显示失败行；展开后完整输出与参数折叠收纳；settled 的 status、push-preview 与未发现 PR 的查重卡片上提供 commit message、push remote/ref、PR title/body/base 的小表单，经官方输入动作发送。行摘要是冻结调用切片的纯函数（解析器以 coding-tools 的确定性渲染文本为目标并优雅降级）。
- `conversation.view`（id `deepseekgui-changes`、`deepseekgui-git`、`deepseekgui-worktree`、`deepseekgui-memory`）——官方「对话 / 轨迹」旁边的四个 DeepSeekGUI 标签。改动：按组（将提交 / 已改动 / 新文件 / 冲突）列出工作区改了什么并可打开每个文件的补丁，每行可在文件管理器里定位或复制路径。Git：当前分支、带领先/落后计数的远端分支、已配置的远端、最新提交，以及从窗口内已有的工具卡片读出的本会话提交/推送/PR 结果（含嵌在 `run_code` 之下的调用——官方 PTC 模式就是从那里驱动 git 工具的）。并行工作区：每个已注册 worktree 的分支、改动路径、当前会话在哪一个、以及在多个 worktree 里都被改过的路径。记忆：从磁盘读出的项目 `<文件夹名>.memory.md`，在独立阅读区里按 Markdown 渲染（文件尚不存在时显示空态），带「在文件管理器中打开」与「让助手整理」两个动作、一条指向设置里全局记忆的提示，以及折叠的「关于项目记忆」——文件位置、与 AGENTS.md 的区别、Git 说明和「为这个项目生成 AGENTS.md」按钮（封闭的 `create-project-agents` 桌面命令；已有文件则改为打开）。四个视图都经挂载的 `workbenchInspector` namespace 读取，按需刷新，不提供任何写操作，并且住在官方对话的内容列里（`--dsh-chat-content-width`）——官方的宽窄拖柄因此落在视图之外，拖动时视图与对话一起变宽窄。改动、Git、并行工作区的工具栏带「打开资源管理器」（封闭的 `open-workspace` 桌面命令）；记忆视图只保留自己的「在文件管理器中打开」。
- 路径点击——对话里文本像路径的 `<code>` 片段，点击经 `reveal-path` 桌面命令定位文件；桌面按会话工作区解析并拒绝一切越界路径，页面自己不判断包含关系。

以上所有槽位都由官方客户端包声明；本插件只用 `ctx.slots.inject` 填充它们。

## 开发

插件保留 TypeScript/React 源码与常规构建。先编译源码，再产出客户端 bundle：

```sh
pnpm exec tsc -b apps/desktop/workbench-plugin
pnpm exec tsdown --config apps/desktop/workbench-plugin/tsdown.config.ts
```

bundle 经 `window.__ModuleLoader__.load({ id, factory })` 自注册，并通过 loader require 解析 React 与共享模块表行——与官方客户端包用 `clientBundle` 构建的产物契约一致（该 preset 本身无法构建本包，因为它的 workspace 扫描只覆盖 `packages/*/*`）。

单测位于 `tests/`，经仓库 vitest 运行（组件规格需 `NODE_ENV=test`；本沙箱导出 `NODE_ENV=production`，会把 React 解析到生产构建并破坏 `act()`——仓库已知的 jsdom 基线）：

```sh
pnpm exec vitest run apps/desktop/workbench-plugin/tests
```

## 模型体验

无：插件只渲染品牌外观、工具结果卡片与基于官方投影的只读视图，不组装任何 provider 请求。卡片表单和记忆视图「让助手整理」组合的用户指令文本与任何手打消息一样走官方 composer 提交。

#### KV 缓存影响

无；本包既不组装也不发送 provider 请求。
