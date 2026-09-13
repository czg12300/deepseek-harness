---
description: "可选三方授权插件的账号连接、模型选择与使用说明。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-third-party-auth-bundle

[English](README.md) | 中文

## 概述

为 Web Profile 增加可选的 ChatGPT 和 Claude 账号连接。该层挂载授权服务、账号运行时及设置 UI，不修改已有 base、Web bundle 或 preset 文件。此 bundle 仅在当前源码中提供，并非已发布的注册表版本。

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

入口是包内 `cordis.patch.yml`，作为 Web Profile 的上层配置加载。启动 UI 前先构建工作区，确保所有已有客户端产物可用。注册表安装与 Desktop 加载尚未验证。

以下是在隔离数据目录中实际启动过的源码验证入口；在仓库根目录执行。

```sh
DSH_HOME="$PWD/.artifacts/third-party-auth-preview/home" pnpm dsh --profile web --patch packages/third-party-auth/third-party-auth-bundle/cordis.patch.yml --port 0 --no-open
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

安装层插入三个配置项，并声明运行依赖。账号包负责凭证和原生会话行为，UI 包负责导航与渲染。bundle 自身不添加模型工具或其他应用启动器。

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

模型行为由挂载的账号 Provider 决定。仅加载该层不会发送模型请求或自动登录。

#### Token 影响

授权、目录读取和会话创建不提交模型提示词。实际推理消耗所选 Provider 的额度，原生轮次通过 `query()` 执行。

#### KV 缓存影响

ChatGPT 请求使用现有 `llm-pi-ai` 历史链路。原生 Claude 的 `resume` 恢复官方上下文，缓存复用由其运行时负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 该层要求 Profile 已提供基础服务。已经挂载授权服务的组合需要避免重复服务注册。缺少原生平台载荷时，Claude 不可用。

Runtime invariant: 不发布 companion。每次尝试和流由单一所有者管理；认证、连接意图和目录可用性刻意表达不同事实。

<a id="dev-note"></a>
### 开发备注

Loader 组合用例在关闭一次性 runner 的已提供 headless 基础配置上验证注册。真实账号验证单独进行。
