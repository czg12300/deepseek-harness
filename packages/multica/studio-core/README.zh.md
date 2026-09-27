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
- [演员库](#actor-libraries)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

`StudioTaskRequest.modelSelection` 可覆盖单次任务的工作区模型。提供方、模型和推理程度固定在该任务不可变的已解析依赖中；使用同一请求 ID 提交不同选择会被拒绝。工作区技能、工具和角色保持固定。未指定选择的任务使用工作区默认值。

任务视图包含固定的推理程度，使创作客户端无需读取完整任务输入即可恢复成功使用的模型选择。


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

<a id="portable-project-folders"></a>
### 可携带项目文件夹

创建界面先调用 `prepareFolder(path, draftId, input)`，再通过 `createFromDraft()` 发布项目。路径必须是绝对路径，且目录为新建或空目录。文件夹包含 `multica.project.json`、`project.sqlite`、`sessions/` 中的项目对话，以及 `assets/`、`artifacts/` 和 `exports/`。清单身份在目录移动后保持不变；已存内容和素材文件随目录迁移。已发布角色配置归项目所有，凭据和可执行插件仍归设备所有。

`openFolder()` 打开已有项目或已保存的创建表单。`projectFolders()` 列出当前设备的最近位置，不打开这些位置的数据库。本机 `databasePath` 保存最近索引、共享角色模板与旧项目；索引丢失不影响重新打开项目文件夹。`create()` 和未绑定文件夹的创建表单保留旧宿主 API。浏览器创建的项目绑定到文件夹。为尚未发布的旧创建表单选择目录时，也会复制其已保存版本和策划对话，保留源数据。

`closeFolder()` 停止自有任务、关闭其 Session 存储、完成项目数据库检查点并释放独占 SQLite 锁。只有关闭成功后才能复制完整文件夹。`backupFolder()` 持有项目锁复制已停止写入的项目，再关闭源项目；它拒绝链接文件和非空目标目录。断开或被替换的目录不会静默变成新项目。第二个写入者及同时打开的同清单身份副本会被拒绝。

`migrateProject()` 将单个旧项目的版本、创建历史、提案、审查、角色历史和已初始化对话复制到空目录。其他项目不会进入副本，源数据保持完整。未完成迁移标记阻止打开残缺结果。`saveEditorDraft()` 在正式版本之外保存可恢复编辑缓冲；重新打开时携带原始基础版本恢复，以便检测冲突。设备数据库的 `studio_locations` 表以文件夹标识登记作品，并在 `document` 中保存项目 ID、规范化路径和列表摘要。`forgetFolder()` 将记录标为隐藏，不读取或改动项目文件，目录不可用时也可执行。列表删除保留已挂载的运行时和写锁，由显式关闭操作释放；元数据刷新保留隐藏标记。保留归属信息可防止已迁移的旧项目重新出现在列表；`openFolder()` 恢复同一条记录，不重复登记。

每个独立项目文件夹将生成或编辑的大纲、人物及分集 Markdown 存入 `scripts/`；模式 5 的 `studio_script_documents` 索引文件路径和正文。`completeScript()` 记录已保存且非空的大纲及每集非空剧本的摘要，后续剧本修改会使确认失效。`studio_production_units` 和 `studio_canvas_nodes` 表保存逐集或整片画布及文本或媒体节点。`importProjectMedia()` 将通过校验的图片、视频或音频复制到 `artifacts/<unit-id>/`，并写入 `studio_media_assets`；`projectMediaData()` 为选中的素材预览返回文件字节。每个导入文件上限为 16 MiB。设备项目列表和演员库仍位于项目文件夹之外。

文件夹测试覆盖复制到全新 Harness 主目录、不同路径、恢复草稿、迁移、所有权竞争及目录缺失时的写入。实物移动硬盘故障注入与跨操作系统硬盘测试不在这些 fixture 的覆盖范围内。网络共享盘以及对独立副本的同时编辑不构成同步机制。

<a id="actor-libraries"></a>
### 演员库

`actorLibraries()` 列出设备 `studio.sqlite` 同级 `actor/` 下的独立库目录。每个库有自己的清单、`library.sqlite` 和 `assets/` 中的引用图片。`createActorLibrary()` 新建目录；`saveLibraryActor()` 保存手动填写的演员资料及最多两张 PNG、JPEG 或 WebP 参考图。`libraryActors()` 分页搜索一个库，`libraryActor()` 读取两张参考图供编辑。所有操作都不修改项目，也不启动 Agent。

`exportActorLibrary()` 返回完整 ZIP；`importActorLibrary()` 可独立安装或合并到所选库。合并比较演员稳定 ID 与内容指纹，保留冲突版本，并记录来源身份，重复导入不会增加副本。ZIP 上限为压缩后 32 MiB、解压后 64 MiB、500 个文件、每张图片 2 MiB。[演员库方案](../../../multica/doc/actor-library.md)说明目录结构和冲突规则。

### 读取和编辑项目

宿主消费者使用 `ctx.studioProjects`；客户端将 `./remote` 中由 Typert 生成的默认贡献挂载到 `studioProjects` 命名空间，通常将其导入为 `studioProjectsRemote`。公开数据类型通过客户端安全的 `./types` 导出提供。Remote 方法包装同步宿主方法；成功的修改仅在 SQLite 事务提交后返回。

`list()` 返回已打开项目和旧项目的实时元数据，以及已关闭文件夹的缓存摘要，按最近更新时间、项目 ID 排序；结果包含归档项目。`get(id)` 返回当前项目或 `null`；已登记的可携带项目必须先打开。这些读取只加载当前文档。`history(id)` 按从旧到新返回完整修订，未知项目返回空数组，并校验历史连续性。

`create(input)` 接受完整的[可编辑内容](src/types.ts)，返回修订 1。名称不能为空白，最多包含 50 个 Unicode 码点；构想最多包含 3000 个码点。画幅为 `16:9`、`9:16` 或 `1:1`。目标集数为正安全整数或 `null`；每集时长为正有限秒数或 `null`。目标集数不会创建分集。其他创作文本允许为空，且所有输入字段均为必填。

项目获得宿主生成的 UUID。调用方为每个新分集分配新的小写 UUID，并在编辑和排序时保留它。重复分集 ID，以及曾由其他项目保存的 ID 均被拒绝，即使该项目已移除相应分集。ID 使用不同的 TypeScript 品牌类型。项目时间戳为毫秒精度的 ISO UTC 字符串；创建时间固定，更新时间不会倒退。

`save(id, expectedRevision, input)` 追加修订。`setArchived(id, expectedRevision, archived)` 追加归档或恢复状态转换，不改变创作内容；请求当前归档状态不作修改。两者均返回 `{ status, project }`：`saved` 携带结果，`conflict` 在预期修订过期时携带当前项目，`archived` 拒绝向只读项目保存内容。过期修订判断优先于归档状态。拒绝操作既不修改已存历史，也不修改调用方输入；未保存草稿由调用方持有。

非法传输输入、向未知项目写入、不兼容数据库、损坏的存储文档，以及文件系统或 SQLite 失败均抛出错误。每次读取当前文档均校验 JSON 字段、修订列和分集归属。只有显式历史读取才检查旧文档，并校验修订连续性、创建时间稳定性和更新时间不倒退。返回文档是独立值，因此调用方修改不会改变持久化历史。

### 专业草稿与人工审查

`saveCreationDraft()` 持久化独立创建表单，允许名称暂空。`createFromDraft()` 校验完整表单，并且只发布一次正式项目。`openWorkspace()` 将目标绑定到不可变角色版本和预留 Session ID，不创建 Agent。初始化登记九个不同角色；执行后端报告实际可用的角色及受控工具。

`startAssistant()` 解析依赖，冻结完整本地输入和批准引用，在分派前记录幂等任务。同一工作区只允许一个运行中任务。提案保存不可变前后值；`applyProposal()` 在同一事务中校验选定字段锁、本地当前值和已保存基础版本。应用提案建立新草稿版本。`submitReview()` 与 `decideReview()` 是针对具体已保存内容的独立人工操作；过期或归档目标不能批准。

角色默认限额在部署配置 `assistantDefaults` 中设置：`maxTokens: 8192`、`maxSteps: 8`、`timeoutMs: 180000`。已发布配置保留自己的限额。重启恢复只在确认任务所属进程已经退出时将任务标记为中断，不重新提交模型请求。不支持取消其他存活进程拥有的任务。

受支持的旧模式先通过 `VACUUM INTO` 在配置数据库旁生成名为 `studio.sqlite.pre-migration-<uuid>.sqlite` 的一致备份，再事务升级为模式 5。恢复时同时恢复兼容数据库及其 Session 日志；回到模式 1 代码需要迁移前备份，不能降级当前数据库。

### 备份和恢复

停止使用数据库的所有宿主，复制包含全部 SQLite 文件的所在目录，然后在恢复后的 `dshHome` 下以相同的相对 `databasePath` 打开副本。[备份测试](tests/projects.spec.ts) 验证停机复制后保存的草稿、归档历史和永久分集归属。不兼容数据库会被拒绝，不会被替换或隐式降级。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

SQLite 模式版本 5 为每个不可变修订保存一份完整项目文档。项目 ID 标识其修订序列；独立的永久分集归属表阻止数据库内跨项目复用。写事务在读取预期修订之前获取 SQLite 即时写锁，原子插入内容和新归属记录。SQL 触发器拒绝修订更新、删除和归属变更。WAL 配合 FULL 同步保留已提交写入，插件卸载时关闭连接。

本包不发布 `./invariant` 配套导出：持久化文档、列和归属关系在读取与任务接纳时校验。文件夹和 Session 路由条目共享其所有者的打开与关闭生命周期；最近摘要明确属于缓存元数据，并非实时文档镜像。[存储](src/project-store.ts)、[文件夹所有者](src/project-folders.ts) 和[输入校验器](src/validation.ts) 拥有这些检查。[定向测试](tests/projects.spec.ts) 和[文件夹测试](tests/folders.spec.ts) 覆盖 SQLite 行为、目录迁移和写入所有权。

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
