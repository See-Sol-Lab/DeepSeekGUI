---
kind: upgrade-guide
description: "DeepSeekGUI 1.2.0 移除实验性条目记忆，并把有效条目转换到 Markdown 文件。"
---

# DeepSeekGUI 记忆回到 Markdown

[English](guide.md) | 中文

## 变更

DeepSeekGUI 1.2.0 移除实验性增强记忆、条目工具和模式开关。全局记忆保存在 `<Harness Home>/memory.md`，项目记忆保存在 `<工作区>/<文件夹名>.memory.md`，文件在新会话开头提供上下文。

## 迁移

1. 升级后启动 DeepSeekGUI。应用会自动把仍有效的普通条目追加进对应 Markdown 文件，仅跳过完整原文相同的内容。
2. 检查**设置 → 全局记忆**和会话中的**记忆**视图。已有 Markdown 原文保留。
3. 需要原始记录时，保留 `<Harness Home>/storages/deepseekgui_memory`。已遗忘条目、接续记录、无法读取的记录和项目文件夹已不存在的条目仍在那里，避免自动注入。
4. 在该存储目录检查 `MIGRATED-TO-MARKDOWN.txt`，确认转换结果。标记存在后，后续启动不会重复迁移。

编辑与会话行为见[记忆指南](../../../user/deepseekgui/memory.zh.md)。
