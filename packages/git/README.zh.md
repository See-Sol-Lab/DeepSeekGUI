---
description: "git 包组：ctx.git capability 契约及其本地 git 命令后端，由仓库变更工具集消费。"
kind: "package-group"
---

# packages/git

[English](README.md) | 中文

## 概述

`git/` 组让 agent 对仓库进行读写访问：`git/` 定义 `ctx.git` capability 契约（identity、HEAD/upstream、worktree、status、diff、index 写、带护栏的 commit、push 预览/push），`git-local/` 通过 `git` 命令行在宿主上实现它，并做有界输出捕获。DeepSeekGUI coding 工具等消费方在该 seam 之上注册模型可见工具；组内不负责模型文本或提示词的格式化。本页是组的映射；每个包 README 负责各自的包级约定与配置。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发说明](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`git/`](git/README.zh.md) | 定义 git capability：仓库 identity、status/diff 读、index 写、带护栏的 commit、push 预览/push | `ctx.git` |
| [`git-local/`](git-local/README.zh.md) | 基于 `git` 可执行文件的宿主后端：exact-argv 调用、有界输出、写入的整树安全 | 注册到 `ctx.git` |

seam 刻意不包含模型文本与进程所有权决策；DeepSeekGUI coding-tools 插件（B5-P4）是当前消费者，在其上添加工具、呈现与审批门。

-----

<a id="related-documentation"></a>
## 相关文档

- [Git 子系统](../../docs/subsystems/git.zh.md) — capability 契约、porcelain-v2 status 词汇、diff 范围与 commit/push 护栏。
- [Capability seams 决策](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md) — capability 为何由 Service Definition / provider / consumer 组成。
- [B5-P4 coding 工具笔记](../../.agents/notes/implemented/architecture/2026-09-03-b5-p4-coding-tools-and-task-retirement.zh.md) — 消费该 seam 的工具，以及 task 时代 git RPC 面的退役。

<a id="dev-note"></a>
## 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
