---
description: "无需询问模型即可读取当前工作区文件与 Git 差异；配置读取上限并检查 Workbench 只读 Remote API。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-inspector

[English](README.md) | 中文

## 概述

无需模型请求即可检查工作区和 Git 事实。桌面专用的 `deleteSession` 端点把已授权删除交给 SessionController。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

DeepSeekGUI 的 Web 组合以 Loader 条目挂载本插件。自定义组合需要 fs、git、sessionQuery、sessionController 和 typert 提供方；本包本身不是可安装的 bundle。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| logLimit | 30 | 总览返回的最新提交数量 |
| maxTextBytes | 524288 | 文件文本或 diff 响应上限；超限明确失败，不静默截断 |

WorkbenchFileText 包含 path 和有界的完整文本。WorkbenchMemory 描述项目记忆：Session cwd、文件名 `<文件夹名>.memory.md`（文件夹前缀把它与 DSH home 下的全局 memory.md 区分开）、文件文本（尚不存在时为 null），以及项目里是否有 AGENTS.md。WorkbenchRepository 包含 Git 根目录及提供方的 RepoStatus。WorkbenchOverview 携带根目录、RepoStatus、已配置的远端、最新提交（sha、subject、author、time），以及每个已注册的 worktree（WorkbenchWorktree：提供方的 WorktreeInfo 加 `current`——是否就是本 Session 的仓库根——与 `changedPaths`——该 worktree 自己的变更路径；干净或 bare 时为空；不可读时另有 statusError）。WorkbenchLastReply 携带 Session 最新一条助手回复（文本块拼接；第一条回复之前为 null）以及其后是否已有 `turn/end`；桌面端的反馈排查向隐藏会话提问后轮询 `lastReply` 直到 `complete` 为 true，因此不必碰流式的 follow 通道。`deleteSession(sessionId, signature)` 将经桌面授权的删除交给会话拥有者及其持久层。文本查询区分 Session 工作区与其 Git 根目录，未跟踪文件因此使用正确的基准路径。刻意不提供目录浏览：官方右侧 Sidebar 自带文件树。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>读取归属与上限</summary>

SessionQuery 为运行中或冷 Session 借出已记录的 cwd，不创建 agent。文件系统提供方解析规范化目标并检查包含关系，包括符号链接；文本解码和二进制拒绝也由它负责。Git 查询使用会话实际所属的仓库。前端在打开、切换路径、工具完成或手动刷新时读取，关闭时取消请求。不轮询、不复制对话，也不注册模型工具。

不发布 invariant companion：本适配器没有可能发生漂移的可变副本。请求检查与提供方测试覆盖路径包含关系和大小上限。

Git 检查禁用可选 index 锁、外部 diff/textconv 程序与 fsmonitor 钩子，读取不启用仓库配置的外部命令执行。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [文件系统提供方 API](../../fs/fs/README.zh.md)
- [Git 提供方 API](../../git/git/README.zh.md)
- [SessionQuery](../../session-query/session-query/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无，因为这些用户发起的读取不注册提示词或工具，也不追加 Session 事件。

#### KV Cache effect

没有直接影响；打开文件或差异不会改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 仅查看文本；提供方拒绝二进制文件，超大文本需要其他查看器。
- 文件系统与 Git 提供方必须描述同一个执行环境。
- 外部文件修改在刷新时读取，不安装文件系统监视器。

### 开发备注

无。
