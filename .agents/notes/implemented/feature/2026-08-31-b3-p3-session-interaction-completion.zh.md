# Agent Note: B3-P3 Session Interaction Completion — 权限档位标签的唯一 owner

Status: implemented

[English](2026-08-31-b3-p3-session-interaction-completion.md) | 中文

## Problem

Workbench 表面就是 DeepSeekGUI 品牌下的官方 DSH Web 客户端，因此完整的 Session 交互集（list、search、create、history、prompt、queue、steer、cancel、rename、fork、archive；模型、reasoning、权限、preset、附件、Skills、Commands、Plan、Todo、Goal、Jobs、Subagents、Deliverables 与用户问题）已经骑在官方 client-runtime 对象层上——分页、重连、pending interaction、queue 与 title 状态机都在。B3-P3 的活是关掉 B3 账本点名的唯一一处持久重复（B3-12③）：权限档位标签存在于两个 locale 命名空间且值完全相同——`ui-permission-presets` 的 `settings.permission`（Permission UI 自己的 owner）与 `ui-conversation` 的 `access.option.*`（composer chip 的私有副本）——外加 picker 显示变换里第三处硬编码英文 `Full access`。一个事实三个家，而且官方组合内部已经在漂移（picker 显示 `Full access`，设置行显示 `Full access (High risk)`）。

## Decision

设计档位的标签只有一个 owner：官方 `settings.permission` 命名空间，其 `option.*` 键由 `ui-permission-presets` 注册。所有表面直接消费它；未命中回退到常规 Title Case 显示变换：

- **ui-permission-presets picker**（`optionsOf`）：经该命名空间解析 `option.<value>`（用非类型化 bind，让任意 host 预设名保持合法），命名空间不携带的名字回退 `displayPermissionPreset`。picker 与 General 设置行现在渲染同一份本地化标签。
- **ui-conversation composer chip**（`PermissionSelect`）：输入栏 inject 面携带绑定到官方命名空间的 `permissionT` 翻译器；chip 经它解析 `option.<value>`，未命中回退自己的显示变换。`access.option.*` 键从 conversation 命名空间删除——设计档位标签不再住在这里。风险描述（`access.optionDesc.*`）与 Full access 确认门（`access.confirm.*`）留在 conversation 命名空间；官方 picker 的确认文案留在自己的 `permission.access` 命名空间（既有的刻意独立副本，见插件自己的注释）。
- **未命中语义**：locale 翻译对未知键回退到裸键（命名空间查找 → 公共命名空间 → 键本身），因此"返回值等于键名"即"无 owner 标签"——两个消费方都把它当未命中并回退 Title Case，这样不含 `ui-permission-presets`（可选 bundle）的组合仍渲染可读标签。

没有新增 DeepSeekGUI Session facade、私有 DTO、插件 allowlist、第二 running 状态或用轮询替代事件；Session 交互集本身是验证"组合应用里已存在且可用"，而不是重实现。

## Alternatives considered

**保留 composer chip 的私有 `access.option.*` 副本。** 那是账本点名的现状；两份值相同的字典各自独立演化，正是 B3-12③ 要消灭的漂移。

**让 `ui-conversation` 当 owner，picker 消费它的命名空间。** Permission UI 自己的包是权限标签的天然归属；设置行已经读它，而且可选 bundle 的独立性规则双向成立（自定义组合里任一 owner 都可能缺席）。

**处处走 `displayPermissionPreset`（不用命名空间）。** 那是硬编码英文 `Full access` 加其余 Title Case——用删掉本地化来修重复，产品明确不想要。

## Consequences

设计档位标签现在只有一个家，composer chip、`/permission` picker 与 General 设置行渲染同一份本地化文本（此前 picker 显示硬编码英文，chip 与设置行显示本地化文案）。不含 `ui-permission-presets` 的组合里 chip 仍因键回退按未命中处理而渲染可读的 Title Case。conversation 命名空间删掉六个键；picker 规格里的标签断言现在期望命名空间的值。
