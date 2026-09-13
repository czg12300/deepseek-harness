---
description: "Multica 基于 DeepSeek Harness 的插件、项目数据、授权和任务恢复方案。"
status: proposed
---

# 工程方案

## 概览

本页描述完整制作平台的技术分工。Multica 通过 Cordis 插件复用 Harness 的 agent、工具、Session、附件和 Web 扩展能力。[项目基础版](project-foundation.md)以 studio-core 和 studio-ui 的职责接入现有 Web Bundle；[文本创作工作台](text-authoring.md)通过 studio-agents 复用独立 Session、作用域工具和结构化提案；资产与媒体制作模块仍是设计范围。

## 目录

- [插件职责](#插件职责)
- [项目数据](#项目数据)
- [任务与授权](#任务与授权)
- [Agent 权限](#agent-权限)
- [基座复用点](#基座复用点)

## 插件职责

| 模块 | 职责 |
| --- | --- |
| studio-core | 项目、集、场次、镜头、资产版本、依赖与制作阶段 |
| studio-review | 审查记录、定稿、生成授权、额度预占及费用记录 |
| studio-agents | 角色配置版本、页面绑定、工作区会话、skills 与工具装配、受控交接及结构化提案 |
| studio-media | 图像和视频服务定义、供应商适配、任务恢复和素材入库 |
| studio-editing | 声音服务、字幕、时间线、合成及导出 |
| studio-ui | 全局与项目导航、编辑工作区、资产视图、审查面板 |

模块可在第一版合并为少量包；服务定义、供应商实现和消费者的职责保持明确。产品使用 Profile 和 Bundle 装配，遵守基座的统一应用启动约定，不新增绕过 dsh 的应用入口。

## 项目数据

建议使用 SQLite 保存项目记录、不可变版本、依赖、审批、任务和费用。每次批准、额度预占及任务建立通过事务协调，防止多个任务同时超出额度。二进制素材保存在附件服务或对象存储，数据库只保存引用和元数据。

项目数据是作品的事实来源。Session 记录 agent 的工作过程；进入模型请求的项目快照、修改事实和任务结果也必须进入 Session，以便恢复模型实际看到的内容。禁止仅从进程内缓存向模型注入未记录的信息。

| 实体 | 主要关系 |
| --- | --- |
| Project | 规格、集列表、预算策略与归档状态 |
| Episode / Scene / Shot | 项目、剧本段落、镜头顺序和状态 |
| Asset / AssetRevision | 稳定身份、不可变版本、媒体引用及标准属性 |
| Artifact / ArtifactRevision | 制作结果、原件、预览、父版本与生成记录 |
| Dependency | 使用方版本与被引用版本，保留影响分析所需关系 |
| Review | 对象版本、审查者、意见和决定 |
| GenerationRequest / Authorization | 冻结请求、授权范围、额度与使用次数 |
| ProductionTask / Attempt | 供应商任务引用、提交尝试、恢复信息和状态 |
| TimelineRevision | 轨道、剪辑区间、素材版本、声音和字幕 |
| CostReservation / CostSettlement | 预占额度、实际用量、待核实金额和释放记录 |
| AgentRoleRevision | 页面映射、模型、persona、skills 版本、MCP 工具选择和权限 |
| AgentWorkspaceBinding | 项目或创建草稿、角色、对象范围、配置版本和 Session 引用 |
| ChangeProposal | 目标版本、字段差异、锁定字段、提案状态和应用记录 |
| AgentTaskContext / Handoff | 冻结的执行范围、输入版本、授权与专业角色交接记录 |

更新采用预期版本校验，冲突返回当前版本并要求重新合并或审查。持久化通知使用可重放的记录和幂等消费，处理项目事务成功但会话通知未完成的情况。

原图和视频原件需要按字节保留；模型看图和页面预览使用独立派生文件。现有图片附件会执行规范化，不能直接把预览当作无损母版。导出记录绑定时间线与素材版本，并保留可重新合成的清单。

## 任务与授权

正式制作的执行顺序为：读取批准输入、解析参数、核对供应商能力、计算额度、建立待审生成单、接收人工授权、校验版本、预占额度、提交远端、记录结果、入库素材、结算费用、等待结果采用。

供应商任务可能在进程退出后继续执行。持久化任务保留远端 ID 和查询信息，重启后重新核实状态；现有进程内 jobs 不作为长期制作任务的唯一存储。

提交响应中断时，任务进入“待核实”。在无法排除远端已经接受请求前，不自动再次提交。后端支持时使用幂等键；不支持时明确暴露无法保证一次提交的限制，由人工决定后续动作。

取消本地等待不等于远端任务停止。界面分别显示取消请求、远端确认与费用结算状态；尚未确定的费用继续占用额度。系统只能严格控制自己的提交行为，供应商最终计费仍须核对实际账单。

内容批准和付费授权都在业务服务中检查。UI 按钮禁用、工具提示词和通用工具权限只是辅助，不能替代后端校验。

## Agent 权限

每个角色得到固定对象范围、已批准输入版本、可修改字段、工具清单和任务完成条件。权限来自宿主保存的角色身份，不接受模型自报身份作为凭据。职责与页面映射见[专业 Agent 工作区](agent-workspaces.md#页面与角色)。

宿主根据工作区绑定解析实际配置，创建或恢复对应 Session。每次任务固定角色配置和上下文；切页只改变前端显示，不更换在途任务的写入对象。已有会话不通过热换 preset 冒充另一角色。

修改提案保存基准版本和字段差异，应用操作检查锁定字段、用户手工修改和当前版本。应用到草稿、正式内容批准及制作授权分别由不同业务操作处理。

Skills 与 MCP 通过角色配置引用和选择。MCP 写入及收费操作必须进入同一授权服务，不能仅依赖客户端工具清单。角色配置由用户发布，agent 无权编辑自身权限；生效版本及依赖可用性在宿主解析时校验。

媒体提交、轮询、下载和转码由普通服务执行，不使用模型持续轮询。专业角色可共享模型，但使用不同工具范围和结构化输出要求。

受限 preset 不开放可绕过授权的任意 shell、通用网络调用或自修改能力。需要访问供应商的执行服务持有凭据，角色只提交受检验的请求。

## 基座复用点

| 基座能力 | 用法与限制 | 依据 |
| --- | --- | --- |
| 工具系统 | 定义参数、结构化结果、取消和模型输出；持久化字段要明确设计 | [工具开发指南](../../docs/cookbook/adding-a-tool.md) |
| Agent preset | 配置角色 persona、skills 和工具集合 | [Agent presets](../../packages/preset/agent-presets/README.md) |
| Subagent | 复用角色覆盖、工具限制和结构化输出；确认 provider 支持 | [Subagent 类型](../../packages/subagent/subagent/src/types.ts) |
| Approval | 复用单次动作交互；跨天业务审批使用项目审查记录 | [User approval](../../packages/interaction/user-approval/README.md) |
| Workflow | 用于阶段内协作；制作状态机由业务服务管理 | [Workflow](../../docs/subsystems/workflow.md) |
| Attachment | 保存原件和预览，分别处理文件与规范化图片 | [Attachment local](../../packages/attachment/attachment-local/README.md) |
| Jobs | 可承载进程内执行控制，补充持久化远端任务记录 | [Jobs local](../../packages/jobs/jobs-local/README.md) |
| Web client | 通过客户端插件装配专业工作区与工具展示 | [UI layout](../../packages/client/ui-layout/README.md) |

以上为完整制作链的集成方向；项目基础版的数据与界面约束见[使用说明](project-foundation.md)。供应商选择及实际能力验证见[实施与验收](delivery-plan.md)。
