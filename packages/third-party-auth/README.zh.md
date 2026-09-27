---
description: "可选账号连接、私有授权 UI 与原生 Claude 会话。"
kind: "package-group"
---

# third-party-auth/ — 三方账号连接

[English](README.md) | 中文

## 概述

本组包含默认 Web Profile 加载的账号功能。Host 包管理连接状态及原生 Claude 会话，UI 包增加设置页和独立原生窗口，bundle 负责组合。现有模型适配器和普通 Agent 循环保持独立。

## 目录

- [包列表](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包列表

默认 Web Profile 直接加载完整功能。自定义 Profile 可使用 bundle，其余包分别拥有对应行为。

| Package | Role |
|---|---|
| [third-party-auth](third-party-auth/README.zh.md) | 账号状态、私有 Remote 操作、原生运行时 |
| [client-ui-third-party-auth](client-ui-third-party-auth/README.zh.md) | 设置页与原生会话窗口 |
| [third-party-auth-bundle](third-party-auth-bundle/README.zh.md) | 可选 Profile 配置层 |

<a id="related-documentation"></a>
## 相关文档

- [账号子系统](../../docs/subsystems/third-party-auth.zh.md) — 状态与归属。

<a id="dev-note"></a>
## 开发备注

真实账号验证记录在 Host 包 README 中。
