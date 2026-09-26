---
description: "导入、列出与卸载 DeepSeekGUI 本机技能库里的技能包，并按项目文件夹选择会话可用的安装；写入前先审阅来源，并可配置体积上限。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-manager

[English](README.md) | 中文

## 概述

DeepSeekGUI 在当前 DSH home 下的本机技能库。`skillManager` Remote 命名空间审阅目录、ZIP 或 Markdown 来源，把审阅过的选择作为完整目录安装，只卸载自己写入的内容，并保存每个项目文件夹选用的安装。技能库不是官方 provider 的根：本服务注册的唯一 provider 只为会话列出其项目选中的那些安装。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

DeepSeekGUI 的 Web 组合以 Loader 条目挂载本插件，与 workbench inspector 并列。自定义组合需要 typert、storageDomain、skills 与 sessionQuery 提供方；本包本身不是可安装的 bundle。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| dshHome | `$DSH_HOME` 或 `~/.dsh` | 显式 harness home；每次调用重读，切换 home 时技能库随之移动 |
| agentsHome | `$DSH_AGENTS_HOME` 或 `~/.agents` | 只读列表用的 agents home |
| bundledSkillDir | `$DSH_BUNDLED_SKILL_DIR` | 只读列表用的随包根 |
| libraryDir | `<home>/deepseekgui/skills` | 安装目录根 |
| stagingDir | `<home>/deepseekgui/skills-staging` | 暂存与回收根，在技能库之外 |
| maxZipBytes | 268435456 | 归档文件的包含上限 |
| maxFileBytes | 67108864 | 来源内单个文件的包含上限 |
| maxTotalBytes | 536870912 | 来源内全部文件的包含上限 |
| maxFiles | 4000 | 来源内文件数的包含上限 |
| watchLibrary | true | provider 是否监视技能库目录里绕过本服务发生的变化 |

`inventory` 返回 SkillInventory：技能库目录、每个受管安装的 SkillInstalledView（清单字段加 `location`，以及 `ok` 或带问题的 `invalid` 状态）、`orphans`（技能库下没有本管理器清单的目录；绝不删除），以及在 `<home>/skills`、`<agents home>/skills` 和随包根下按官方文件系统 provider 同一套元数据规则发现的只读 SkillReadOnlyView 行。

`previewImport(path)` 只读来源、不写任何东西：目录会被遍历（符号链接跳过并报告，`.git` 不复制），`.zip` 在内存中读取并逐条检查路径（`..`、绝对路径、盘符、反斜杠、控制字符与以点结尾的段一律拒绝），`.md` 是一个候选。根 `SKILL.md` 产生持有整个包的一个候选；否则三层以内的每个嵌套 `SKILL.md` 各是一个候选，再不然根层的每个 Markdown 文件各是一个候选。每个 SkillImportCandidate 携带声明的 `name` 与 `description`（缺失或无效为 null）、审阅对缺项给出的 `proposed` 值（由文件名或目录名得到的 kebab-case 名称、由正文第一行得到的说明）、`issues`（可补齐的只有名称与说明的缺失或无效）、文件数与字节数、`installable`，以及 `replaces`——它将替换的现有安装：先按来源匹配，再按名称匹配，并以安装标识与来源点名，让实际目标可见。

`applyImport({ path, selections })` 逐条独立安装每个 SkillImportSelection：候选先在暂存根下作为完整目录落地（只有最终名称或说明与入口不同、或入口缺少元数据头时才重写 `SKILL.md`；其余文件原样复制），写入 `deepseekgui-skill.json` 清单，重新校验暂存的 `SKILL.md`，然后才把目录重命名进技能库为 `<name>-<8 位十六进制>`。带 `replaces` 安装标识的选择保留目录名与首次安装时间；交换期间旧目录停在暂存区，重命名失败则放回。任何失败都会删除暂存目录，并为该条选择报告一个 SkillIssue——名称已被未确认的安装占用时为 `name-conflict`，以及 `replace-target-missing`、`library-unwritable`、`skill-invalid`、`io-error`。来源里的任何内容都不执行，也不安装依赖。 来源超过文件数或字节上限时，整个导入被拒绝，不能安装缺少资源的技能。ZIP 文件数与总字节检查在解压前执行。

`uninstall(installId)` 只在目录的清单写着该安装标识时删除它；其余一律回答 `not-managed`，什么都不删。原下载包与官方根目录从不被触碰。结果里的 `affected` 列出选择中仍引用该安装的项目；`installReferences(installId)` 事先回答同一份清单，供确认时展示。每次技能库变化都会发出 `skill-manager/change`。 目录链接不属于管理器拥有的安装目录，此操作拒绝卸载它们。

### 项目选择

项目就是文件夹：`projectView(sessionId)` 用与工作区注册表相同的 `realpath` 规范解析会话记录的 cwd（Windows 先折叠大小写），哈希成键后返回页面——文件夹、已保存的 `revision`（首次保存前为 0），以及技能库每个安装一行 SkillProjectEntry，外加选择里安装已不存在的每一项一行。每行都说明勾选在会话真实目录里的效果——目录经 `ctx.skills.snapshot` 在会话的存活 agent 或其记录的 preset 的常驻作用域下读取：`active`（该名称的胜出技能就是这个安装）、`shadowed`（官方同名技能胜出；`shadowedBy` 点名其来源）、`inactive`、`invalid`（安装副本未通过校验）或 `missing`（已卸载；引用保留到项目自己清除为止——绝不切到另一份同名技能）。没有文件夹或文件夹已不存在的会话报告 `problem`，且不能保存。

`setProjectSelection({ sessionId, enabled, revision })` 把该文件夹的完整安装标识列表存为 `<home>/storages/deepseekgui_skills/projects/<key>.json`（`deepseekgui_skills` 存储域，`per-record` 布局）。保存必须带上页面渲染时的 revision；存储的 revision 不同则回答 `revision-conflict` 并附上胜出的页面，既未安装也未曾被引用的标识回答 `unknown-install`，保存与安装、卸载串行。保存成功会使注册表目录缓存失效并发出 `kind: 'selection'` 的 `skill-manager/change`。选择保存的是安装标识，所以替换安装会保留它，新安装在项目勾选之前不属于任何选择。

### 受管 provider

挂载时本服务向 `ctx.skills` 的宿主层注册 `deepseekgui-skills`：一个只以技能库为根的官方 `FileSystemSkillProvider`（不含默认根，随包根与用户根不会以这个名字再次出现），按调用方 cwd 的已选安装标识过滤，并以来源 `deepseekgui-managed`、rank 550 重新标注——排在官方用户根之后、随包根之前，且整体让位于任何 preset 层的 provider。每个官方消费者都带会话 cwd 读注册表——模型目录消息、`skill` 工具、用户的 `/名称` 行与 `/` 选择器的 Remote——所以勾选是唯一的开关：未勾选的安装不出现在目录里，`ctx.skills.get()` 对它们返回 undefined。技能库根在服务挂载时绑定；切换 DSH home 会重启 Harness。 已勾选的安装还必须通过清单和文档校验；修改声明名称不能借用原安装 ID 启用另一个技能。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>整目录安装与身份</summary>

`library.ts` 拥有磁盘布局。写操作在服务内串行，安装与卸载绝不交错；每次写都是暂存 → 校验 → 重命名，崩溃最多在暂存根下留下一个多余目录，绝不会留下 provider 可能捡到的半份安装。身份是清单里的 `origin`（来源种类、绝对路径与入口）加安装标识；apply 时绝不用显示名去猜替换目标——客户端回传它展示过的那个标识。

`frontmatter.ts` 以问题的形式复述官方 provider 的规则（kebab-case 名称、非空说明、规范的 `disable-model-invocation` / `user-invocable` 布尔值、拒绝旧字段），而不是静默丢弃，并用 `yaml` 渲染安装副本。`zip.ts` 在写任何文件之前用 `fflate` 限制解压体积。

`selection.ts` 拥有存储域、项目键与页面装配；`provider.ts` 包装官方文件系统 provider。选择是唯一的可变副本，且它本身就是权威：一次保存就是一次持久化 `put`，注册表缓存按这个事实失效，而不是依赖监视器。清单每次调用都从磁盘读取。

不发布不变量伴侣：唯一的可变副本是按项目的选择，它的内存视图就是持久化记录；技能库本身每次调用都从磁盘读取。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [技能 provider 注册表](../../skill/skill/README.zh.md)
- [文件系统技能 provider](../../skill/skill-filesystem/README.zh.md)
- [存储域](../../storage/storage-domain/README.zh.md)
- [工作区注册表](../../workspace/workspace/README.zh.md)（路径规范）
- [DSH home 路径](../../util/home-paths/README.zh.md)

<a id="model-experience"></a>
## 模型体验

通过技能工具包（`dsh-tool-skill`）间接产生影响；它的目录消息、`skill` 工具与 `/名称` 注入渲染的正是本服务 provider 为项目列出的安装。

#### KV Cache effect

保存选择会改变技能工具包在已打开会话下一次请求时追加的目录替换消息，从那一点起前缀失效；已经注入的技能内容留在会话历史里，单独导入或卸载一个包不会改变任何模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- ZIP 内的符号链接不会保留：读取器拿不到链接属性，链接条目会变成保存目标文本的普通文件；目录来源里的链接会被跳过并报告。
- 文件整份复制，没有流式处理，所以体积上限就是归档的内存上限。
- 只读行通过直接扫描官方根目录发现，而不是经 `ctx.skills`——宿主面的列表看不到 preset 层的 provider；项目页的生效列则读取会话的作用域。
- 技能库里不能并存两个同名安装，所以选择永远不用在同名安装之间取舍；官方同名技能总是胜出，并被报告为遮蔽。
- 选择按文件夹而非按会话：两个工作树就是两个文件夹。

### 开发备注

无。
