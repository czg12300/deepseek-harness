---
description: "通过持久化 Session、冻结角色配置和人工应用提案运行受控漫剧文本助手。"
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-agents

[English](README.md) | 中文

## 概述

通过独立策划和编剧 Session 请求大纲及剧本提案。每项显式任务捕获目标、角色配置、本地草稿、选定技能和批准引用。重启后可恢复同一对话，保持身份不变。应用和批准内容通过独立人工项目操作完成，不开放媒体生成工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

显式任务模型选择覆盖角色默认值。LLM 运行时在接纳前校验提供方、模型和推理程度；每次请求使用该任务固定的选择，包括同一 Session 内的后续任务。普通请求头记录实际模型和推理程度。

大纲工作区在记录的系统提示中加入页面专属指令，也适用于已有角色配置。起草和改写请求通过结构化修改返回完整大纲，并保留不受影响的段落；仅分析请求返回说明而不修改内容。当前任务以传入的本地输入为准，助手不能声称尚未应用的提案已经写入。

-----

<a id="use-this-package"></a>
## 使用本包

可携带项目通过部署持久化提供方的 `registerStore()` 操作，在自己的 `sessions/` 目录中挂载 SQLite Session 存储。项目服务持有目录的独占写锁。已发布 Session 事件通过事务追加；头部和已提交事件不可修改。普通对话继续使用部署的 JSONL 后端。新建的可携带专业 Session 不保存绝对 `cwd`：任务对象和已挂载项目身份决定范围，因此移动目录不会改写历史或复用其他设备的路径。

关闭项目先等待其 Agent 退出，再移除 Session 路由并关闭 SQLite。旧项目迁移通过读写句柄复制已初始化日志，保留原始存储。项目日志发布不依赖硬链接。共享持久化约定测试及真实 Loader/循环测试验证从复制到全新主目录的文件夹继续对话；实物移动硬盘和跨操作系统验证仍需单独执行。

Web bundle 在 [studio-core](../studio-core/README.zh.md) 之后挂载本运行时，依赖 Agent、预设、Session 持久化、模型路由、系统提示词、工具和技能服务。`dshHome` 指定 Harness 主目录；默认依次使用 `DSH_HOME` 和 `~/.dsh`。工作目录位于 `multica/sessions`。文本供应商通过既有模型和凭据设置配置；密钥不进入角色记录。

只有项目服务的 `startAssistant()` 分派任务。打开页面和工作区不创建 Agent。专用 `multica` 预设不包含写工具。运行时只接受自有任务消息、共享 `structured_output` 捕获工具和显式选择的只读集成。角色发布建立独立对话版本；此前 Session 保留原身份和有效依赖。

宿主集成通过 `registerContextTool()` 登记具体只读工具，并负责返回的异步释放器。`source` 标识内置或经审查的 MCP 操作；登记 MCP 服务器不开放其他工具。`studio_read_approved` 只读取当前任务捕获的具体批准版本。技能贡献冻结文本，不授予权限。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

项目数据库预留 Session ID，管理任务和提案。本运行时创建或恢复对应 Agent，将完整捕获输入记录为普通用户消息内容，并安装任务作用域结构化输出。持续作用域守卫阻止非所属聊天输入和继承工具。取消等待真实任务结束。此前已初始化的 Session 历史缺失时明确失败，不建立替代日志。

不发布 `./invariant` 配套导出：项目服务在分派时校验持久任务归属，活动 Agent 和工具注册均由 Cordis effect 管理。[运行时测试](tests/runtime.spec.ts) 挂载真实 Loader、循环和 Session 持久化，仅脚本化外部模型回复。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [项目服务](../studio-core/README.zh.md) — 版本、任务持久化及人工审查。
- [专业工作区设计](../../../multica/doc/agent-workspaces.md) — 角色及制作授权。
- [共享结构化输出](../../subagent/subagent-in-process-driver/README.zh.md) — 捕获协议。

-----

<a id="model-experience"></a>
## 模型体验

### 专业任务输入

#### 模型看到的内容

配置身份替换部署身份。系统提示词还要求 Agent 只处理冻结目标，禁止批准、直接编辑项目和付费制作。普通用户消息包含创作者需求及 JSON 字段 `taskId`、`target`、`baseRevision`、`roleRevision`、`input`、`selectedSkills` 和 `reviewReferences`；相同内容持久化到 Session。

#### Token 影响

每项任务重复完整选定项目文本和技能正文。对话历史在固定工作区内累积，不复制其他角色的对话。

#### KV Cache 影响

角色身份和能力前缀在同一工作区内固定。新用户消息追加；发布其他角色版本建立独立 Session 和前缀。

### 提案与只读结果

#### 模型看到的内容

共享 `structured_output` 协议接受 `{ reply, changes: [{ field, value }] }`，字段名限定在任务目标范围。选定的 `studio_read_approved` 调用返回不可变审查记录及文本字段。普通工具结果日志记录成功或错误，不注册应用、审查决定或制作授权工具。

#### Token 影响

工具模式、提案文本和显式读取的批准内容贡献 Token。不使用模型循环轮询媒体任务。

#### KV Cache 影响

结果消息追加到已有 Session。工具选择在工作区首次分派前冻结。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

运行时当前服务于文本创作。

- 只有策划和编剧执行任务；其他已登记角色需要后续制作服务。
- 依赖解析校验模型路由和已登记能力；供应商鉴权最终由实际请求验证。
- 不支持跨进程取消。中断任务需要显式新请求，不自动重提。
- 技能和只读 MCP 工具必须存在于宿主注册表中；不开放远端写入或收费工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
