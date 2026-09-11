---
description: "面向通过用户已登录的 gh CLI 创建 pull request 的开发者，以及其精确「可执行文件+argv」调用维护者的 gh 提供方说明。"
kind: "package-reference"
---

# dsh-pull-request-gh

[English](README.md) | 中文

## 概述

DeepSeek Harness pull-request capability seam 的 GitHub CLI 实现（B4-P6）：用户的已登录 `gh`，经 subprocess seam 以精确 executable + argv 调用——绝无 shell 字符串，输出有界收集。登录态完全活在 gh 自己的配置里（keyring、配置文件或 `gh auth login`）；本 provider 只向 gh 询问事实，绝不读取、显示或保存 token。

## 目录

- [命令](#commands)
- [失败分类](#failure-classification)
- [模型体验](#model-experience)
- [已知局限与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="commands"></a>
## 命令

- `gh auth status`——可用性：exit 0 表示已登录；`Logged in to <host> account <account>` 行提供报告的 host 与账号。
- `gh pr list --head <head> --state all --json number,url`——重复创建护栏。
- `gh pr create --title <title> --body <body> --base <base> --head <head> --json number,url [--draft]`——创建；title/body/base/head 原样经 argv 传递，draft 是标志位，结果为 PR 的 number 与 URL。

-----

<a id="failure-classification"></a>
## 失败分类

创建失败按 gh 自身 stderr 词汇分类：`already-exists`（从 stderr 提取既有 PR 的 URL）、`auth` 或 `other`——原始 stderr 始终随附。可执行文件缺失以 `PullRequestUnavailableError('missing-gh')` 呈现。

-----

<a id="model-experience"></a>
## 模型体验

### Pull request 创建

#### 模型看到什么

什么也没有。本 provider 只服务宿主侧的 `ctx.pullRequest` seam：无工具、无提示词、无会话事件。

#### Token 影响

每个请求零直接 token；登录态活在 gh 自己的配置里，这里从不读取。

#### KV Cache 影响

与实时请求无关：本包从不触碰请求前缀，因此不可能使 provider 缓存复用失效。

## 已知局限与延后工作
<a id="known-limitations-and-deferred-work"></a>

- provider 只对 gh 已登录的 host 说话；remote host 无 gh 登录态的仓库在可用性或创建时明确失败。
- 无重试、无自动 merge、无自动 reviewer、无自动标签——创建是一次显式用户确认的动作。

**运行时不变式：** 不发布伴生入口。登录只存在于 gh 自己的配置里，每次调用都是对其事实的显式动作；本提供方没有独立的事件序列或可变数据关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包由 DeepSeekGUI 自有，上游没有对应物。自 B5-P4 起它的唯一消费方是 coding-tools 插件——由该插件注册调用本 seam 的 DSH 工具，已退役的 Task capability 不再夹在中间。

</details>

PR 正文通过 stdin 传入；已有 PR 查询选择开放的 PR。子进程超时或输出截断会明确失败。
