---
description: "为独立挂载的 Chat Feed 打开经过校验的 Session 事件日志，不改变主对话选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-chat-feed

[English](README.md) | 中文

## 概述

为独立挂载的 Chat Feed 打开经过校验的 Session 事件日志，不改变主对话选择。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Web bundle 挂载此浏览器服务。[Chat Feed](../../client/ui-chat-feed/README.zh.md) 从 `ctx.chatFeedTransport` 请求尚未打开的读取器，在对话记录挂载时打开，并在最后一个阅读区域释放后等待读取器完成销毁。此包复用 Session Controller 日志协议，不提供配置字段。

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

- 调用者负责打开、分页和销毁。预留 Session 必须发布后才能读取其日志。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

None.

</details>
