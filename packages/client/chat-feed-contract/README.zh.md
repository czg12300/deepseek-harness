---
description: "为嵌入式 Chat Feed 定义应用拥有的 Session 选择和导航回调类型，无须导入渲染实现。"
kind: "package-library"
---

# @deepseek-ai/dsh-client-chat-feed-contract

[English](README.md) | 中文

## 概述

为嵌入式 Chat Feed 定义应用拥有的 Session 选择和导航回调类型，无须导入渲染实现。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过类型导入使用此包及 `chat-feed.view` 插槽声明。应用拥有根插槽声明并提供 `FeedOwnerProps`；[ui-chat-feed](../ui-chat-feed/README.zh.md) 在其中注册渲染器。此库不注册插件，也不打开 Session。

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

- 每个组合中，此契约要求一个根插槽声明所有者；它不定义会话持久化和任务执行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

None.

</details>
