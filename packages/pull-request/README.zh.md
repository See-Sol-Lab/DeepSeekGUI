---
description: "pull-request 包组：ctx.pullRequest capability 契约及其 GitHub provider，供 DeepSeekGUI PR 工具消费。"
kind: "package-group"
---

# packages/pull-request

[English](README.md) | 中文

## 概述

`pull-request/` 组为 agent 提供提供方无关的 PR 事实与创建能力：`pull-request/` 定义 `ctx.pullRequest` capability 契约（可用性、查重、创建），`pull-request-gh/` 通过用户已登录的 GitHub CLI 在宿主上实现——绝不用 token。DeepSeekGUI coding 工具等消费方在该 seam 之上注册模型可见工具并负责审批；组内不触碰模型文本与 token。本页是组的映射；每个包 README 负责各自的包级约定与配置。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`pull-request/`](pull-request/README.zh.md) | 定义 pull-request capability：provider 可用性事实、查重与创建 | `ctx.pullRequest` |
| [`pull-request-gh/`](pull-request-gh/README.zh.md) | 基于用户已登录 `gh` 的 GitHub provider——绝不用 token | 注册到 `ctx.pullRequest` |

seam 刻意不包含模型可见文本；DeepSeekGUI coding-tools 插件（B5-P4）是当前消费者，在其上添加工具、呈现与审批门。

-----

<a id="related-documentation"></a>
## 相关文档

- [Pull-request 子系统](../../docs/subsystems/pull-request.zh.md) — capability 契约与 provider 登录事实。
- [Capability seams 决策](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md) — capability 为何由 Service Definition / provider / consumer 组成。
- [B5-P4 coding 工具笔记](../../.agents/notes/implemented/architecture/2026-09-03-b5-p4-coding-tools-and-task-retirement.zh.md) — 消费该 seam 的工具，以及 task 时代 PR RPC 面的退役。

<a id="dev-note"></a>
## 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
