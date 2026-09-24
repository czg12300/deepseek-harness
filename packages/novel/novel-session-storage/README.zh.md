---
description: "将小说会话保存在作品目录内，普通会话继续使用配置的 JSONL 根目录。该提供方复用已有 JSONL 代际格式、迁移与写入租约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-session-storage

[English](README.md) | 中文

## 概述

将小说会话保存在作品目录内，普通会话继续使用配置的 JSONL 根目录。该提供方复用已有 JSONL 代际格式、迁移与写入租约。

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

与 novel-core 一起组合此提供方，替代普通 JSONL 提供方。root 配置指定普通 Session 的原有目录。compression 接受 none 或 zstd。小说归属决定使用注册项目目录下的 .novel/sessions。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

每个 JSONL 提供方挂载在独立服务域中，与 Host 共享 Session 事件。Session 句柄、已提交代际文件和文件锁仍由该提供方负责。路由器卸载会释放所有提供方 fiber 并报告错误。

不发布 invariant 伴随插件：已保存状态和调用结果通过同一事务或既有 JSONL 句柄产生，没有独立更新的权威副本。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Novel subsystem](../../../docs/subsystems/novel.zh.md)

<a id="model-experience"></a>
## 模型体验

无；此提供方只路由 Session 持久化操作，不添加模型上下文。

#### KV Cache 影响

持久化路由不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 使用小说 Session 时，其项目目录必须保持可访问。
- Session 发现仅覆盖已在当前 Host 注册的小说。

<a id="dev-note"></a>
### 开发备注

无。
