# Agent Note：按职责拆分桌面主进程

Status: implemented

[English](2026-09-10-b6-p8-main-process-responsibility-split.md) | 中文

## 问题

`apps/desktop/src/main.ts` 曾承担整个 Electron 入口：启动装配、窗口与托盘生命周期、DSH 终端、浏览器 pane、插件恢复、权限切换、更新状态机、Managed Home 迁移流程、反馈与诊断——全部挤在一个 `app.whenReady()` 闭包里，模块级辅助函数也混在同一文件中。读者无法判断哪份可变事实属于哪个职责，纯函数也只能通过整个应用来验证。

还有三类没有调用点证据的遗留：导出的值在整个仓库（含测试）都没有导入者；GUI 与 task 消费方随 APIProxy 一起退役的 git seam 方法没有仓内调用者；打包日志里的 Node 实验警告从未定位到具体进程。

## 决定

只提取成团、可独立命名、且不持有可变状态的职责；`main.ts` 保留装配与全部状态 owner。

- `harness-settings.ts` 读取官方 `settings.yaml` 里的标量偏好（`ui-theme.preference`、`locale.preference`）。settings 监听器、语言缓存与 `applyTheme` 留在 main：它们持有可变状态并驱动 Electron 界面。
- `update-view.ts` 持有 update 面板的事实——更新通道配置读取、装机时刻的读写与其进程内缓存、安装包流式摘要、`UpdateView` 默认形态。更新状态机、下载、校验与安装交接留在 main，它是更新状态的唯一写者。
- `crash-evidence.ts` 收下 `collectCrashDumpEvidence`，与它本就拥有的收集计划合流；该文件从此是崩溃证据的唯一归属。
- `migration.ts` 收下 `nodeMigrationFacts`，即生产用的 `MigrationTargetFacts`。目标判定与它的文件系统事实现在同址。三个迁移入口保持原顺序、留在 main，因为那个顺序就是安全属性：`runHomeMigration` 校验、停服务、复制并逐项校验、写清单、切指向，然后请用户重启；`verifyMigrationOnStartup` 在下次启动时按清单核对新位置；`runMigrationCleanup` 只在清单为 `verified` 时才允许删除。本次改动没有把核对挪回迁移进程，也没有让删除入口提前出现。

同一轮的清理决定：

- 取消导出十二个没有导入者的值导出（已在整个 `apps/desktop` 含 `tests-e2e` 搜索核实），并删除一个没有调用者的 e2e 辅助函数。
- `worktrees()` 是 workbench inspector 的活调用；`stageFile`、`unstageFile`、`revertFile` 是 coding-tools 插件模型工具的活调用。`worktreeAdd`、`worktreeRemove`、`applyIndexPatch` 没有仓内调用者，但仍是已发布包 `@deepseek-ai/dsh-git` 的 Service Definition，因此保留并纠正账本结论，而不是删除方法。
- Node 实验警告是 `stripTypeScriptTypes is an experimental feature`，由上游 `dsh-code-runtime-worker-thread` 在 `run_code` 工具剥离类型时发出。保留并记录。

## 考虑过的替代方案

**把每个有状态的簇搬到工厂后面。** 否决。插件恢复、终端、浏览器 pane、更新状态机与反馈各自读写多个闭包事实，而这些事实同时被控制模型、托盘和命令分派器读取。每簇一个工厂就是带注入依赖清单的 Manager 层——本阶段明确禁止，而且它不会降低耦合，只是换个名字。

**在 main 与提取模块之间加事件总线。** 否决。控制模型已经是运行时事实的唯一可观察投影；事件总线会给同一份状态加第二条路径。

**为满足行数目标而搬单个函数。** 否决。行数不是目标；被提取的单元按职责选定，留下的那些不是。

**删掉三个没有调用者的 git seam 方法。** 本阶段否决。它们是已发布 `@deepseek-ai/dsh-git`（release family 包，同时发布到本 fork 的 npm 基线）Service Definition 的一部分，删除等于改动 provider 契约。正确做法是记录证据、交给 owner 裁决；账本条目已纠正。

**用 `NODE_NO_WARNINGS` 或 `--disable-warning` 静音 Node 实验警告。** 否决。两者都是进程级，而该警告来自一个文档中明确依赖该实验性 API 的上游包。

## 后果

主进程仍然持有全部可变事实与 Electron 生命周期；被提取的模块足够纯，不需要 Electron 实例即可测试。`main.ts` 少了约 400 行辅助函数，行为、状态 owner 与调用顺序均未改变。

更新与迁移两条流程在构造上未变：它们的函数没有被移动，调用点仍按同一顺序执行。迁移的删除入口仍由上一次运行写下的清单把关。

仓库保留既有的动态入口面。knip 仍是本 fork 的临时基线而不是门禁——上游已在[从仓库门禁中移除 Knip](../process/2026-08-19-remove-knip.zh.md) 中移除它，本 fork 在提交 `4e7868d671` 重新加入 `knip.json`。它剩下的发现是按名字加载的 snapshot fixture、e2e 驱动与语料文件，以及模块数据形状；没有一个是死代码。

## 验证

`pnpm run typecheck` 与 `pnpm run build:desktop` 均 exit 0。`NODE_ENV=development vitest run apps/desktop/tests apps/desktop/workbench-plugin/tests`——72 文件、1220 通过、1 跳过。新增 `tests/harness-settings.spec.ts`（settings 文档形状、引号、CRLF、降级）与 `tests/update-view.spec.ts`（默认视图形态、更新通道配置、摘要、每个缓存用例使用全新模块的装机时刻），并扩展 `tests/crash-evidence.spec.ts`（从合成 Crashpad 目录收集、目录缺失）与 `tests/migration.spec.ts`（`nodeMigrationFacts` 的存在性、空目录、可写性与空闲空间）。
