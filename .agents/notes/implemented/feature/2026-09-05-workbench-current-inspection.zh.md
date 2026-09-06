# Agent Note: Workbench 当前检查与独立表单消息

Status: implemented

[English](2026-09-05-workbench-current-inspection.md) | 中文

## 问题

工具历史无法在 agent 读取之前显示文件，也不能显示对话之外发生的修改。通过 setDraft 发送表单会丢掉无关草稿，展示文案也不是稳定的推送表单数据源。可重复的问题项 id 还会把不同通知请求合并。

## 决策

[Workbench 检查器](../../../../packages/api/workbench-inspector/README.zh.md) 只通过官方 Remote 提供 list、text、status 和 diff。SessionQuery 借出 cwd 而不创建 agent，已有 fs 和 Git 提供方负责读取。Files 与 Changes 在打开、导航、工具完成和刷新时查询，关闭时取消请求。Changes 在当前检查下方保留明确标注的提交/推送/PR 历史。

表单使用官方 Session prompt 的 queue 模式发送自身文本，不触碰草稿和附件。推送默认值来自工具展示元数据。通知使用关联 call id 或官方待处理请求标识，仅由了解当前 Session 的 Web 消费者抑制正在查看的事实。

这部分取代了 [B5-P5](../architecture/2026-09-04-b5-p5-tool-cards-and-on-demand-inspectors.zh.md) 的纯历史检查范围；旧记录仍为卡片呈现与来源标注提供依据。没有记录被完全取代或归档。

## 备选方案

**让模型替用户浏览。** 这会消耗模型轮次，不能满足独立检查当前状态的需求。

**在 Electron 再实现一份 Git。** 这重复既有提供方及其行为，只读 Remote 适配器已经足够。

**把展示句子解析为表单数据。** 文案改动会破坏默认值；工具的结构化展示元数据直接提供这些字段。

## 影响

产品增加的是一个无状态读取适配器，不是另一套 agent、队列、会话存储或记忆引擎。二进制与超大文件明确报告读取失败。测试覆盖真实提供方读取、范围限制、分页、取消、草稿保留与请求标识。隔离的真实 UI 验证展示了不调用模型的文件内容和 Git patch 读取。
