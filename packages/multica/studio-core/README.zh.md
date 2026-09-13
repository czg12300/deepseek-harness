---
description: "将 Multica 项目、大纲和分集草稿保存到 SQLite，保留不可变修订，处理编辑冲突，并归档或恢复项目。"
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-core

[English](README.md) | 中文

## 概述

保存项目规格、来源文本、大纲和有序分集剧本，并在重启后重新打开。每次成功编辑都保留此前的修订，包括分集文本和身份。编辑冲突时返回当前项目，供调用方保留并合并本地草稿。归档项目仍可读取和恢复。创建项目不会启动 agent 或生成媒体。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当项目需要持久化手工编辑和版本历史时，在 Multica 宿主组合中挂载此插件。

### 最小配置

默认挂载使用解析后的 Harness 主目录（依次为 `DSH_HOME`、`~/.dsh`），并创建缺失的数据库目录。

```yaml
- name: '@deepseek-ai/dsh-studio-core'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | `DSH_HOME`，其次为 `~/.dsh` | 显式 Harness 主目录优先。 |
| `databasePath` | `multica/studio.sqlite` | 主目录内的数据库文件路径，可相对于主目录或使用绝对路径。 |
| `busyTimeoutMs` | `5000` | SQLite 写锁等待时间，为 0 至 2,147,483,647 的整数毫秒。 |

### 读取和编辑项目

宿主消费者使用 `ctx.studioProjects`；客户端将 `./remote` 中由 Typert 生成的默认贡献挂载到 `studioProjects` 命名空间，通常将其导入为 `studioProjectsRemote`。公开数据类型通过客户端安全的 `./types` 导出提供。Remote 方法包装同步宿主方法；成功的修改仅在 SQLite 事务提交后返回。

`list()` 返回当前元数据，包括构想和分集数量，按最近更新时间、项目 ID 排序；结果包含归档项目。`get(id)` 返回当前项目或 `null`。这些读取只加载当前文档。`history(id)` 按从旧到新返回完整修订，未知项目返回空数组，并校验历史连续性。

`create(input)` 接受完整的[可编辑内容](src/types.ts)，返回修订 1。名称不能为空白，最多包含 50 个 Unicode 码点；构想最多包含 100 个码点。画幅为 `16:9`、`9:16` 或 `1:1`。目标集数为正安全整数或 `null`；每集时长为正有限秒数或 `null`。目标集数不会创建分集。其他创作文本允许为空，且所有输入字段均为必填。

项目获得宿主生成的 UUID。调用方为每个新分集分配新的小写 UUID，并在编辑和排序时保留它。重复分集 ID，以及曾由其他项目保存的 ID 均被拒绝，即使该项目已移除相应分集。ID 使用不同的 TypeScript 品牌类型。项目时间戳为毫秒精度的 ISO UTC 字符串；创建时间固定，更新时间不会倒退。

`save(id, expectedRevision, input)` 追加修订。`setArchived(id, expectedRevision, archived)` 追加归档或恢复状态转换，不改变创作内容；请求当前归档状态不作修改。两者均返回 `{ status, project }`：`saved` 携带结果，`conflict` 在预期修订过期时携带当前项目，`archived` 拒绝向只读项目保存内容。过期修订判断优先于归档状态。拒绝操作既不修改已存历史，也不修改调用方输入；未保存草稿由调用方持有。

非法传输输入、向未知项目写入、不兼容数据库、损坏的存储文档，以及文件系统或 SQLite 失败均抛出错误。每次读取当前文档均校验 JSON 字段、修订列和分集归属。只有显式历史读取才检查旧文档，并校验修订连续性、创建时间稳定性和更新时间不倒退。返回文档是独立值，因此调用方修改不会改变持久化历史。

### 专业草稿与人工审查

`saveCreationDraft()` 持久化独立创建表单，允许名称暂空。`createFromDraft()` 校验完整表单，并且只发布一次正式项目。`openWorkspace()` 将目标绑定到不可变角色版本和预留 Session ID，不创建 Agent。初始化登记九个不同角色；执行后端报告实际可用的角色及受控工具。

`startAssistant()` 解析依赖，冻结完整本地输入和批准引用，在分派前记录幂等任务。同一工作区只允许一个运行中任务。提案保存不可变前后值；`applyProposal()` 在同一事务中校验选定字段锁、本地当前值和已保存基础版本。应用提案建立新草稿版本。`submitReview()` 与 `decideReview()` 是针对具体已保存内容的独立人工操作；过期或归档目标不能批准。

角色默认限额在部署配置 `assistantDefaults` 中设置：`maxTokens: 8192`、`maxSteps: 8`、`timeoutMs: 180000`。已发布配置保留自己的限额。重启恢复只在确认任务所属进程已经退出时将任务标记为中断，不重新提交模型请求。不支持取消其他存活进程拥有的任务。

模式 1 先通过 `VACUUM INTO` 在配置数据库旁生成名为 `studio.sqlite.pre-migration-<uuid>.sqlite` 的一致备份，再事务升级为模式 2。恢复时同时恢复兼容数据库及其 Session 日志；回到模式 1 代码需要迁移前备份，不能降级当前数据库。

### 备份和恢复

停止使用数据库的所有宿主，复制包含全部 SQLite 文件的所在目录，然后在恢复后的 `dshHome` 下以相同的相对 `databasePath` 打开副本。[备份测试](tests/projects.spec.ts) 验证停机复制后保存的草稿、归档历史和永久分集归属。不兼容数据库会被拒绝，不会被替换或隐式降级。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

SQLite 模式版本 2 为每个不可变修订保存一份完整项目文档。项目 ID 标识其修订序列；独立的永久分集归属表阻止跨项目复用。写事务在读取预期修订之前获取 SQLite 即时写锁，原子插入内容和新归属记录。SQL 触发器拒绝修订更新、删除和归属变更。WAL 配合 FULL 同步保留已提交写入，插件卸载时关闭连接。

本包不发布 `./invariant` 配套导出：它不维护独立更新的缓存或投影，而是在读取时校验持久化文档、列和归属之间的关系。[服务](src/index.ts)、[数据库初始化](src/database.ts) 和[输入校验器](src/validation.ts) 拥有这些检查。[定向测试](tests/projects.spec.ts) 和[数据库测试](tests/database.spec.ts) 覆盖真实 SQLite 行为及不含 agent 服务的 Loader 组合。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Multica 工程方案](../../../multica/doc/architecture-design.md) — 项目数据归属。
- [Multica 页面规格](../../../multica/doc/page-specifications.md) — 编辑和归档行为。
- [Harness 架构](../../../docs/architecture.zh.md) — Profile 和插件组合。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：[专业运行时](../studio-agents/README.zh.md)记录并发送本服务提供的冻结任务、选定技能及批准引用。打开、保存和审查内容不会调用模型。

#### KV Cache 影响

无；本包既不组装也不发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

项目文档是持久化和冲突检测的单位。

- 对不同分集的并发修改仍会在项目修订层面发生冲突；调用方必须显式合并。
- 每次保存都存储完整项目文本。当前读取避免扫描历史，但显式历史读取会返回全部修订，不分页。
- 分集草稿和人工文本审查使用项目修订号；分集没有独立版本计数或细粒度场次数据。
- 服务不提供实时变更订阅或媒体执行。基本 `create()` 没有幂等键；`createFromDraft()` 对每个已保存创建草稿身份只发布一次。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
