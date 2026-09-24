---
description: "独立目录中的小说项目、文档版本与受控 Agent 创作。"
kind: "package-group"
---
# novel/ — 小说创作

[English](README.md) | 中文

## 概述

每本小说拥有独立的内容与会话目录。项目服务保存版本，运行时产生待确认建议，存储路由保留普通会话的位置。浏览器页面位于 client 组。

## 目录

- [包列表](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包列表

这些包分别负责作品数据、模型执行和会话保存。

| Package | Role |
|---|---|
| [novel-core](novel-core/README.zh.md) | 项目、文档、历史版本与修改建议 |
| [novel-agents](novel-agents/README.zh.md) | 固定任务上下文中的 Agent 执行 |
| [novel-session-storage](novel-session-storage/README.zh.md) | 作品目录中的 JSONL 会话路由 |

<a id="related-documentation"></a>
## 相关文档

- [Novel subsystem](../../docs/subsystems/novel.zh.md)
- [Browser workspace](../client/ui-novel/README.zh.md)

<a id="dev-note"></a>
## 开发备注

无。
