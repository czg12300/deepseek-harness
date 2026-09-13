---
description: "Multica 漫剧创作工具的设计文档与页面效果图索引。"
status: proposed
---

# Multica 设计目录

## 概览

Multica 的设计目标是帮助创作者管理从构想、全剧规划、单集剧本、分镜、视觉制作到剪辑成片的完整过程。创作者决定定稿和制作授权；专业 agent 提交方案与草稿；系统管理版本、依赖关系、任务状态和预算。

本目录包含产品设计方案和生图效果图；当前可操作范围见[项目基础版](project-foundation.md)和[文本创作工作台](text-authoring.md)，其余设计不代表已接入能力。设计图沿用 DSH 漫剧工作台标识；Multica 是本设计资料的项目名称。

## 文档目录

| 文档 | 用途 |
| --- | --- |
| [文本创作工作台](text-authoring.md) | 专业对话、字段提案、角色配置、人工审查及恢复限制 |
| [项目基础版](project-foundation.md) | “漫剧”入口、手工项目管理、保存与版本规则、数据位置及当前限制 |
| [开发计划与资源预估](development-plan.md) | 阶段排期、Token 预算、持续交付节奏与启动条件 |
| [功能设计](feature-design.md) | 产品范围、导航层级、创作流程、人工审查和一致性机制 |
| [专业 Agent 工作区](agent-workspaces.md) | 按页面绑定角色、对话提案、skills、MCP、工具权限和会话交接 |
| [页面规格](page-specifications.md) | 各页面的入口、功能、操作、状态与对应设计图 |
| [工程方案](architecture-design.md) | 插件组合、项目数据、agent 权限和长期任务实现方向 |
| [实施与验收](delivery-plan.md) | 试片范围、里程碑、验证标准和待决定事项 |
| [设计图索引](design-catalog.md) | 当前页面效果图、生成信息与完整提示词入口 |

## 阅读顺序

先阅读功能设计确定产品范围，再按页面规格审查界面，最后用工程方案和实施与验收安排开发。设计图中的示例故事、日期、模型名称、费用和数量不代表真实数据或供应商报价。

当图片与文字存在差异时，以功能设计和页面规格为准。效果图用于讨论布局和交互，具体文案、图标、示例数据与组件细节需要在实现时统一。

## 设计资料布局

```text
multica/doc/
  index.md
  project-foundation.md
  development-plan.md
  feature-design.md
  agent-workspaces.md
  page-specifications.md
  architecture-design.md
  delivery-plan.md
  design-catalog.md
  designs/                 页面效果图
    archive/               导航调整前的参考图
  prompts/                 页面生成提示词
  design-manifest.json      图片路径与来源记录
```

## 开发说明

项目基础版通过 [studio-core](../../packages/multica/studio-core/README.zh.md) 和 [ui-multica](../../packages/client/ui-multica/README.zh.md) 接入现有 Web 组合。统一启动方式及约束见[项目架构](../../docs/architecture.md)。
