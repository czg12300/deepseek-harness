---
description: "从现有侧栏打开“小说”，创建、导入和编辑独立目录保存的作品。在中间编辑正文，在右侧请求助手建议，对比后再应用。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-novel

[English](README.md) | 中文

## 概述

从现有侧栏打开“小说”，创建、导入和编辑独立目录保存的作品。在中间编辑正文，在右侧请求助手建议，对比后再应用。

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

Web 组合将此浏览器插件与小说服务一起挂载。创建页只要求作品名、简介和文件夹。目录对话框操作的是提供服务的 Host，支持其原生选择器或目录浏览能力。autoSaveMs 控制空闲自动保存；零表示禁用自动保存。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节</summary>

声明的 store 在插件生命周期内保留本地草稿与导航状态。独立查询模型发布已保存记录。请求在导航后仍保留原文档身份。建议只能应用到其保存时的基础版本；冲突的本地正文仍可编辑或下载。

不发布 invariant 伴随插件：已保存状态和调用结果通过同一事务或既有 JSONL 句柄产生，没有独立更新的权威副本。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Novel subsystem](../../../docs/subsystems/novel.zh.md)

<a id="model-experience"></a>
## 模型体验

间接通过向小说 Agent 运行时明确发送消息影响模型；打开或编辑页面不会请求模型。

#### KV Cache 影响

查看状态不改变请求前缀；运行时负责捕获任务输入。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 助手回复在结构化任务完成后显示，当前不渲染逐 token 流。
- 未保存的浏览器草稿可跨面板导航保留，但不能跨浏览器刷新；关闭前请保存或下载。
- 通过读取与带版本检查的写入发现其他窗口的修改，当前没有项目实时订阅。

<a id="dev-note"></a>
### 开发备注

无。
