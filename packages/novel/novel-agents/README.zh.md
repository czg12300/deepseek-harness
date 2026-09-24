---
description: "通过真实 Agent 会话讨论和修改小说文档。每次请求固定正文版本与可编辑范围，返回建议而不直接保存正文。会话在后续请求中继续。"
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-agents

[English](README.md) | 中文

## 概述

通过真实 Agent 会话讨论和修改小说文档。每次请求固定正文版本与可编辑范围，返回建议而不直接保存正文。会话在后续请求中继续。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与小说项目服务、Agent、模型路由、preset、Session 持久化、系统提示词和工具服务一起组合。maxTokens、maxSteps 和 timeoutMs 分别控制输出、步数和截止时间。创建项目与打开页面不调用模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

任务所属 Session 的作用域拒绝其他入口的消息和继承的工具。运行时只允许当前任务的结构化输出工具。取消操作等待实际模型与工具调用结束。已初始化会话缺少日志时明确失败。

不发布 invariant 伴随插件：任务归属在执行前验证，作用域与 Agent 句柄由 Cordis effect 管理。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Novel subsystem](../../../docs/subsystems/novel.zh.md)
- [Project storage](../novel-core/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 捕获的创作请求

#### 模型可见内容

普通 user 消息记录作者要求、固定文档版本、可编辑段落和有长度上限的只读参考。系统提示词规定只能提出建议；共享 structured_output 协议补充输出要求。

##### 创作指令

```markdown
You are a novel-writing assistant. Respond in the author's language. Work on the exact saved document and editable spans in the current request. References are read-only story context. Preserve established facts unless the author requests a change. Return an explanation and replacements for editable span IDs; use no replacements when answering a question. Never claim that a suggested edit has already been saved.
```

#### Token 影响

每次请求附加当前文档、可编辑范围与参考正文。上下文随同一文档的会话历史增长。

#### KV Cache 影响

作者消息追加到固定提示词之后；后续请求可以复用未变化的前缀。

### 结构化建议

#### 模型可见内容

structured_output 接受 reply 和 replacements。每个替换项必须使用本次任务发布的 spanId 与替换正文；空数组表示只回复不修改。

#### Token 影响

输出包括说明与替换正文；文档存储在发布建议前校验长度和范围。

#### KV Cache 影响

工具调用与结果追加到会话历史。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 当前运行时只提供固定文档上下文与结构化输出，不提供网页研究或任意文件工具。
- 取消只支持当前 Host 进程拥有的任务；中断的请求不会自动重新提交。

<a id="dev-note"></a>
### 开发备注

无。
