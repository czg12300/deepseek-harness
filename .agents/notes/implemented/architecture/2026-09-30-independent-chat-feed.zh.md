# Agent Note: 独立的 Chat Feed 副本

Status: implemented

[English](2026-09-30-independent-chat-feed.md) | 中文

## Problem

主 Chat 的上游同步与漫剧的嵌入式对话需要独立演进，直接修改共享主界面会增加合并冲突。

## Decision

`ui-chat-feed` 在提交 `98475343dfb95a7635f7a1c8f58a08427d2f160d` 的基础上复制 `ui-chat` 消息展示、`ui-tool` 工具展示及所需的消息组装代码。独立注册表、字典和插槽允许它与主 Chat 同时存在。Session 传输和基础 UI 仍使用公共基础设施；Feed 不修改全局当前 Session。

类型库 `chat-feed-contract` 让漫剧声明插槽，无须依赖消息渲染包；这避免现有 Conversation 对漫剧输入契约的类型依赖产生循环。每段对话绑定独立 Session，配置版本是对话属性。同一对象和角色版本可有多个工作区。SQLite schema 6 为已有工作区绑定键追加其稳定 ID，保留工作区、任务、提案与 Session 身份。

## Alternatives considered

主 Chat 直接抽取共享视图会增加上游同步耦合。仅复制 React 外观会继续依赖全局 Session 选择和消息注册表。完全重写消息渲染会丢失已有的流式和分页行为。

## Consequences

副本需要主动吸收上游修复。重复代码检查仅排除此插件目录；其他代码继续接受检查。宿主负责会话列表、输入、提交、停止和提案应用。原有[专业任务策略](2026-09-11-multica-professional-tasks.zh.md)继续约束角色版本、冻结输入和人工应用。
