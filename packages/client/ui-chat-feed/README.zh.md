---
description: "在应用选择的 Session 中展示流式消息、Markdown、工具卡片、过程折叠和历史分页，会话选择独立于主 Chat。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-chat-feed

[English](README.md) | 中文

## 概述

在应用选择的 Session 中展示流式消息、Markdown、工具卡片、过程折叠和历史分页，会话选择独立于主 Chat。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Web bundle 挂载此插件。宿主声明 [chat-feed-contract](../chat-feed-contract/README.zh.md) 中的根作用域 `chat-feed.view` 插槽，传入 Session ID、发布状态和运行状态，并负责会话列表、输入框与任务执行。Feed 仅为已挂载的阅读区域打开数据流，最后一个阅读区域卸载后释放数据流。附加用户文本块可以折叠为可查看的上下文。`pageMessages` 是正整数配置字段，默认值为 50。文件、技能、详情和分支操作由宿主提供。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

所有权、复制起点和维护取舍见[Chat Feed 决策](../../../.agents/notes/implemented/architecture/2026-09-30-independent-chat-feed.zh.md)。不发布 `./invariant`：注册表和 Session 日志校验直接约束此包使用的数据；此包不维护独立的持久化事实。

</details>

-----

<a id="model-experience"></a>
## Model Experience

None，此包不注册模型上下文，也不修改模型请求。

#### KV Cache effect

None，此包不组装提供方请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 复制的渲染器使用独立扩展插槽。仅注册到主 Chat 的第三方渲染器不会自动注册到 Feed。阅读位置和折叠状态在插件生命周期内保存在内存中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

None.

</details>
