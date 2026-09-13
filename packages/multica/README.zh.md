---
description: "漫剧工作台的 Multica 项目存储与版本服务。"
kind: "package-group"
---

# packages/multica

[English](README.md) | 中文

## 概述

Multica 让创作者保存相互独立的漫剧项目，并重新打开草稿和历史记录。本组负责项目持久化；浏览器工作台位于 client 组。创建和编辑项目不会启动 agent（智能体）或媒体制作。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

项目服务负责已保存内容与版本校验。

| 包 | 职责 |
|---|---|
| [studio-core](studio-core/README.zh.md) | 存储项目及不可变版本，包括单集草稿和归档状态 |

[专业运行时](studio-agents/README.zh.md)通过独立 Session 执行显式提交的文本任务。项目存储负责不可变角色配置、提案和人工审查。

<a id="related-documentation"></a>
## 相关文档

- [Multica 子系统](../../docs/subsystems/multica.zh.md) — 项目标识与版本语义。
- [浏览器工作台](../client/ui-multica/README.zh.md) — 项目导航与编辑。
- [产品设计](../../multica/doc/index.md) — 制作流程规划与视觉参考。

<a id="dev-note"></a>
## 开发备注

无。
