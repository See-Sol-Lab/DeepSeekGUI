# Agent Note: 由一个过滤 provider 提供的按文件夹技能选择

Status: implemented

[English](2026-09-13-skill-project-selection.md) | 中文

## 问题

技能库（B7-P4）把包装到 `<home>/deepseekgui/skills/` 下，但没有任何东西能用它们：技能库刻意放在所有官方 provider 根之外，这样新安装才不会被广播给每个会话。缺的另一半是选择——哪个项目可以用哪个安装——而且它必须是真正的开关，不是一个藏起来的复选框：模型目录、`skill` 工具、用户的 `/名称` 行与 `/` 选择器必须读同一份选择；未勾选的安装必须在每个入口都加载不到；官方技能必须保留其优先级与调用限制；安装更新后选择必须保留；卸载必须点名受影响的项目，且不能解析成另一份同名技能；变化在已打开会话里的生效时点必须如实说明。

## 决策

项目就是文件夹。`packages/api/skill-manager/src/selection.ts` 用工作区注册表自己的 `realpathNormalize` 解析会话记录的 cwd（Windows 折叠大小写），哈希成 per-record 键，在 `deepseekgui_skills` 存储域（`per-record`，`<home>/storages/deepseekgui_skills/projects/<key>.json`）里为每个文件夹存一条记录：规范路径、已选安装标识、revision 与保存时间。同一文件夹的所有会话读同一条记录；其他文件夹各有各的；没有文件夹或文件夹已不存在的会话不能保存。记录里存的是安装标识而不是显示名，所以替换（同一标识）保留勾选，新安装不属于任何项目。

`provider.ts` 就是开关。挂载时服务向 `ctx.skills` 的宿主层注册 `deepseekgui-skills`：一个以 `includeDefaultRoots: false` 构造、只以技能库为自定义根的官方 `FileSystemSkillProvider`，其候选按调用方 cwd 的已选标识过滤，并以 `deepseekgui-managed`、rank 550 重新标注。因为每个官方消费者本来就带会话 cwd 读注册表，一个过滤就覆盖了四个入口，注册表零改动；未勾选的安装不出现在 `list()` 里，`get()` 对它返回 undefined。这个 rank 排在官方用户根之后、随包根之前，而 preset 层的 provider 整体遮蔽宿主层，所以官方同名技能总是胜出；页面把它报告为 `shadowed` 而不是藏起来。provider 不授予任何权限：调用策略来自安装副本的元数据，由官方 provider 解析。

服务暴露 `projectView(sessionId)`——文件夹、revision，以及每个安装一行加每条悬空引用一行，每行的效果由 `ctx.skills.snapshot` 在会话的存活 agent 或其记录 preset 的常驻作用域下算出（`active`、带胜者来源的 `shadowed`、`inactive`、`invalid`、`missing`）——和 `setProjectSelection({ sessionId, enabled, revision })`：拒绝过期 revision（`revision-conflict`，并返回胜出的页面）与未知标识（`unknown-install`），与安装、卸载串行，然后使注册表目录缓存失效并发出 `skill-manager/change { kind: 'selection' }`。`uninstall` 报告 `affected` 项目，`installReferences` 事先回答同一份清单；悬空引用以 `missing` 留着，直到项目取消勾选。

生效时点就是注册表的：保存使 collect 缓存失效，已打开会话的下一次请求重建目录，`dsh-tool-skill` 追加它的目录替换消息；已经注入的内容留在会话日志里。事件经 `@deepseek-ai/dsh-api-remotes` 里新增的一个条目转发到浏览器（声明放在技能库的客户端安全 `types.ts` 里），`ui-skill` 据此清空缓存的 `/` 目录，`@see-sol-lab/deepseekgui-skills` 插件的「项目管理」视图（会话顶部，order 22，与 Git、记忆并列）据此重读；该视图把每次读取与保存按会话和代次做键，晚到的结果绝不覆盖更新的目标，设置分区的卸载确认则显示受影响的项目。

## 考虑过的替代方案

**把已选的包复制进 `<project>/.dsh/skills`。** 不采用：一次勾选就要复制文件，更新要追着副本改，而且官方项目根会把副本广播给选择管不到的工具。

**只在客户端过滤。** 不采用：模型目录和 `skill` 工具读的是宿主注册表；藏起来的复选框会让每个未勾选的技能照样可加载。

**改注册表或自写一个 `tool-skill`。** 不采用：注册表本来就按 cwd 键缓存并带 cwd 询问每个 provider；一个 provider 是最小的正确改动，还保留了官方优先级规则。

**用 `WorkspaceId` 做身份。** 不采用：它是可删可重建的注册表记录，侧栏之外创建的会话也没有；每个会话真正携带的是规范化的文件夹路径。

**转发 `skills/change` 而不是技能库自己的事件。** 暂不采用：它的声明在仅宿主的注册表模块里，客户端编译面导入不了；技能库的事件声明为客户端安全，并携带页面需要的 selection 种类。

## 后果

勾选是唯一的开关，对每个入口都一样；测试驱动真实注册表：未勾选的安装不出现在 `list()` 与 `get()` 里，两个文件夹互不干扰，同一文件夹的两个会话共用一条记录，过期页面会输，重启后选择仍在，另一个 home 从空开始，替换保留勾选，卸载留下点名的缺失引用，官方同名 provider 遮蔽受管行。客户端规格覆盖勾选、带渲染时 revision 的保存、冲突与拒绝的展示、无文件夹与文件夹消失的状态，以及切换会话时丢弃陈旧结果。用 mock 模型实测模型目录、同一文件夹开两个窗口、以及 Harness 重启仍是验收工作；技能库根在挂载时绑定，切换 DSH home 依赖桌面本来就会做的 Harness 重启。 Provider 也会拒绝文档与清单不一致的已选安装。页面让保存回包完成当前操作，避免同一次保存广播触发的刷新使回包失效、控件一直禁用。
