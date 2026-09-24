---
description: "每部小说保存在独立目录中，章节独立编辑并保留不可变版本。导入已有项目不会移动文件。AI 建议与已保存正文分开，直到作者明确应用。"
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-core

[English](README.md) | 中文

## 概述

每部小说保存在独立目录中，章节独立编辑并保留不可变版本。导入已有项目不会移动文件。AI 建议与已保存正文分开，直到作者明确应用。

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

创建时提供作品名、简介、父目录和稳定请求 ID。服务在子目录内生成 novel.json 和 .novel/project.sqlite。同名目录会被拒绝。重命名只修改元数据；移除注册会保留目录和 Session 路由。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

打开受支持的旧数据库时，会先在 `.novel/backups` 中保存一致的备份，再更新结构；未知的新版本会被拒绝。

每份文档拥有独立递增的版本。保存时在 SQLite 写锁内比较预期版本。发生冲突时返回当前已保存文档，不修改内容。恢复历史会创建新版本。应用建议在同一事务中更新正文、版本、处理状态与重试凭据。

不发布 invariant 伴随插件：已保存状态和调用结果通过同一事务或既有 JSONL 句柄产生，没有独立更新的权威副本。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Novel subsystem](../../../docs/subsystems/novel.zh.md)

<a id="model-experience"></a>
## 模型体验

间接通过小说 Agent 运行时影响模型；运行时在请求模型前记录固定的任务输入与只读参考。

#### KV Cache 影响

项目修改不会请求模型。后续助手任务会记录新的文档快照。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 注册目录必须在记录的位置保持可用，当前没有目录迁移与可移植备份命令。
- 外部 Markdown 修改不会自动导入；SQLite 是正文的权威来源。
- 创建过程在发布标识文件前失败时，会保留未完成目录供检查。

<a id="dev-note"></a>
### 开发备注

无。
