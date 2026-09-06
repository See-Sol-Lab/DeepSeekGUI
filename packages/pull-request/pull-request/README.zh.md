---
description: "面向基于既有 provider 登录态创建 pull request 的开发者，以及其可用性与重复创建守卫维护者的 ctx.pullRequest 能力契约说明。"
kind: "package-reference"
---

# dsh-pull-request

[English](README.md) | 中文

## 概述

DeepSeek Harness 的 Pull request capability Service Definition（`ctx.pullRequest`，B4-P6）：经既有 provider 登录态创建 Pull Request——产品绝不读取、显示或保存 token。provider 拥有登录态（首个本地 provider [@deepseek-ai/dsh-pull-request-gh](../pull-request-gh/README.zh.md) 以精确 executable + argv 调用用户已登录的 `gh`）；本 seam 定义调用方可依赖的能力：可用性、重复创建护栏与创建。

## 目录

- [语义](#semantics)
- [失败词汇](#failure-vocabulary)
- [边界保持](#boundaries-held)
- [模型体验](#model-experience)
- [已知局限与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="semantics"></a>
## 语义

- `ctx.pullRequest.availability(cwd)`——当前环境能否创建 Pull Request：provider 可执行文件存在且已登录。只报告 host 与账号——绝不报告 token。
- `ctx.pullRequest.existing(cwd, head)`——head 分支已存在的 Pull Request（若有）：创建前展示给用户的重复创建护栏。
- `ctx.pullRequest.create(cwd, { title, body, base, head, draft })`——以用户确认的字段创建 Pull Request。显式外部写入：调用方先完整预览（标题、正文、base、head、draft）并获得显式确认——模型建议绝不是授权。

-----

<a id="failure-vocabulary"></a>
## 失败词汇

- `PullRequestUnavailableError('missing-gh' | 'not-authenticated')`——provider 无法运行。
- `PullRequestFailedError(stderr, reason, url?)`——创建失败；reason 对 provider 自身输出分类（`already-exists` 携带既有 PR 的 URL、`auth` 或 `other`），原始 stderr 始终随附。

任何地方都不重试、不自动 merge、不自动 reviewer、不自动标签。

-----

<a id="boundaries-held"></a>
## 边界保持

token 绝不跨越本 seam 的任一方向；登录态完全留在 provider。task 记录只保存所创建 PR 的 URL/number 引用——PR 本身由平台持有。

-----

<a id="model-experience"></a>
## 模型体验

### Pull request 创建

#### 模型看到什么

什么也没有。`ctx.pullRequest` 只服务宿主侧消费方：本包不注册任何工具、不注入任何提示词、不写任何会话事件，因此没有任何请求字段携带本包的数据。

#### Token 影响

每个请求零直接 token。

#### KV Cache 影响

与实时请求无关：本包从不触碰请求前缀，因此不可能使 provider 缓存复用失效。

## 已知局限与延后工作
<a id="known-limitations-and-deferred-work"></a>

- **登录态留在 provider**——本 seam 绝不持有、读取或显示 token；没有登录态的 provider 只报告 `not-authenticated`。
- **无重试、无自动化**——创建是一次显式用户确认的动作；任何情况都不自动 merge、不自动 reviewer、不自动标签。

**运行时不变式：** 不发布伴生入口。登录归提供方所有，每次调用都是对其事实的显式动作；本 seam 没有独立的事件序列或可变数据关系。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包由 DeepSeekGUI 自有，上游没有对应物。自 B5-P4 起它的唯一消费方是 coding-tools 插件——由该插件注册调用本 seam 的 DSH 工具，已退役的 Task capability 不再夹在中间。

</details>
