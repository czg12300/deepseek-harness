---
description: "可选三方授权插件的账号连接、模型选择与使用说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-third-party-auth

[English](README.md) | 中文

## 概述

在“设置 → 三方授权”管理订阅账号连接。页面展示连接状态、私有授权提示及各 Provider 的默认模型。ChatGPT 打开普通 Harness 会话；Claude 打开独立原生会话窗口。现有 API Key 设置保持独立。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web Profile 中加载同组 bundle。连接账号、从发现的模型中选择默认值，再点击“使用此模型新建会话”。原生窗口要求明确的工作目录，并提供历史会话选择、继续对话、停止和权限回复。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

本插件挂载自己的生成 Remote contribution，通过顺序 12 的 `settings.section` 注册设置页，并增加一个 `shell.overlay`。文案词典和状态存储由本插件负责。关闭设置页会取消其登录流；原生会话取消具有独立所有者，关闭设置不会意外结束其他账号操作。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [账号子系统](../../../docs/subsystems/third-party-auth.zh.md)说明连接与原生会话的归属。

-----

<a id="model-experience"></a>
## 模型体验

### 账号对话

#### 模型看到的内容

设置页不组装模型输入。它转交用户明确选择的模型；原生会话窗口转交用户提交的消息和权限回复。

#### Token 影响

授权、目录读取和会话创建不提交模型提示词。实际推理消耗所选 Provider 的额度，原生轮次通过 `query()` 执行。

#### KV 缓存影响

ChatGPT 请求使用现有 `llm-pi-ai` 历史链路。原生 Claude 的 `resume` 恢复官方上下文，缓存复用由其运行时负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 远程浏览器不可使用账号控制。Provider 通知保留其原始语言。只有原生账号元数据提供邮箱时才展示，否则显示“账号已连接”。原生历史独立于普通 Harness 会话列表。

Runtime invariant: 不发布 companion。每次尝试和流由单一所有者管理；认证、连接意图和目录可用性刻意表达不同事实。

<a id="dev-note"></a>
### 开发备注

交互单测使用脚本化 Remote 边界。真实 Profile 的渲染检查和真实账号验证属于独立证据。
