---
description: "三方授权插件的账号连接、模型选择与使用说明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-third-party-auth

[English](README.md) | 中文

## 概述

连接 ChatGPT 和 Claude 账号，无需在另一设置页输入 API Key。ChatGPT 使用现有 OAuth 凭证存储与 Codex 路由。Claude 使用固定版本官方运行时及独立原生会话存储。账号认证、集成启用和模型发现分别展示。

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

账号登录默认等待 15 分钟（`connectTimeoutMs`），与 Provider 的设备码有效期一致。到期报告 `timeout`，与用户取消分开。失败结果用 `authorization`（含凭证保存）或 `activation` 标识阶段，不暴露厂商响应。ChatGPT 重试会复用已保存的授权凭证来完成路由启用。

在已配置凭证、授权、设置、LLM 和 subprocess Provider 的本机 Web Profile 上使用同组 bundle。Web 服务绑定所有网卡时，控制器拒绝账号管理。`connectTimeoutMs`、`maxQueuedEvents`、`cwd`、`graceMs`、`statusTimeoutMs`、`outputBytes`、`databasePath`、`turnTimeoutMs`、`maxTurnEvents` 和 `nativeConfigDir` 是部署配置字段；默认值及校验定义在 `src/index.ts`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

账号操作使用私有 Remote 流，尝试能力标识只返回发起者。GPT 授权仍存放在 `llm-pi-ai/openai-codex`；独立配置的路由会被拒绝，断开时只删除本插件创建且未被修改的路由。Claude 登录由未修改的 CLI 在集成专属配置目录中完成。原生会话将官方 SDK 记录镜像到 schema version 1 的独立 SQLite 数据库，并用这些记录进行官方续聊；它们不进入默认 Harness Agent 工厂，也不改变已发布的 Harness Session 文件。

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

所选 ChatGPT 模型接收普通 Harness 请求。原生 Claude 接收用户明确提交的消息、所选工作目录和模型、原生上下文及工具权限回复。原生工具由 Claude Code 执行，不在 Harness 循环里重复执行。

#### Token 影响

授权、目录读取和会话创建不提交模型提示词。实际推理消耗所选 Provider 的额度，原生轮次通过 `query()` 执行。

#### KV 缓存影响

ChatGPT 请求使用现有 `llm-pi-ai` 历史链路。原生 Claude 的 `resume` 恢复官方上下文，缓存复用由其运行时负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 Provider 支持一个账号。模型目录不构成账号权限证明。原生模型活动要求 Host 能启动固定版本 CLI；启动失败不会被视为成功。原生会话拥有独立历史，不支持普通 Harness Session 的 fork/export 或跨执行器上下文转换。关闭原生流会停止当前轮次，原生工具已经产生的变更不回滚。

Runtime invariant: 不发布 companion。每次尝试和流由单一所有者管理；认证、连接意图和目录可用性刻意表达不同事实。

<a id="dev-note"></a>
### 开发备注

开发 Host 上最新一轮原生账号和模型探测已通过。早期运行出现过 SIGKILL，原因尚未定位。真实 SDK 的会话、权限和取消夹具仍在启动时遇到 SIGKILL，发生在调用方中止或请求终止之前。真实账号浏览器授权与模型推理也仍需按账号验证。
