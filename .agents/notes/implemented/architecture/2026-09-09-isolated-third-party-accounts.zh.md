# Agent Note: 独立的三方账号插件

Status: implemented

[English](2026-09-09-isolated-third-party-accounts.md) | 中文

## Problem

账号登录和模型选择需要设置入口，但将厂商逻辑放进设置壳、会话控制器或全局 Agent 工厂会增加与上游 rebase 的冲突。原生 Claude 还拥有自己的 Agent 循环及会话格式，不能作为普通模型 HTTP 适配器处理。

## Decision

将 Host 实现、UI 和可选 bundle 放进[同一模块组](../../../../packages/third-party-auth/README.zh.md)，通过已有插槽注册设置页和独立原生窗口。依赖单向指向公开服务，原模块不反向导入新功能。GPT 复用已有授权流程和凭证，Claude 使用官方 CLI/SDK，以及集成专属配置目录和 SQLite 会话镜像。

[凭证记录决策](2026-08-13-credential-records-and-authorization-flows.zh.md)继续负责授权存储语义。[一次性产品 Provider 决策](../feature/2026-08-04-claude-code-and-codex-subagent-backends.zh.md)继续负责已有子任务，其文件和语义不被替换。新的账号消费者不取代这两份记录。

## Alternatives considered

- 在普通 Agent 工厂和会话控制器中增加厂商分支：会使原生执行与上游控制流程耦合。
- 将 Claude 订阅 Token 当作模型 API 凭证复用：会绕过官方原生执行和凭证归属。
- 复制或抽取已有一次性子任务实现：会把改动扩展到其他消费者拥有的代码。

## Consequences

设置和 API Key 行为保持独立。原生会话保留独立历史并要求明确工作目录，不冒充普通 Harness Session。与 rebase 相关的共享改动限制在工作区/编译清单及必要文档和生成索引。私有提示能力、路由归属、取消及原生镜像完整性有针对性测试。真实订阅授权与推理仍是明确的验证缺口。
