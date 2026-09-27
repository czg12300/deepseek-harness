# Agent Note: 手动配置 API 密钥

Status: implemented

[English](2026-09-15-optional-api-key-onboarding.md) | 中文

## Problem

用户可以在配置模型前管理项目。自动出现的 DeepSeek 凭据弹窗会打断该流程，并预设用户选择的提供方。

## Decision

[模型插件](../../../../packages/client/ui-settings-models/README.zh.md) 在引导流程中只注册欢迎声明。API 密钥在用户手动打开的模型页面中配置。内测声明和手动模型设置仍可使用；不伪造已保存的凭据或用户确认记录。

## Alternatives considered

由启动脚本写入已完成引导标记会依赖所选数据目录，并错误表示用户操作。删除模型页面的凭据编辑器则会妨碍手动配置。

## Consequences

新安装环境进入应用时不会提示配置凭据。使用需要密钥的提供方前，用户须打开模型设置。注册测试覆盖只包含欢迎声明的引导列表；浏览器预期覆盖首次启动、刷新与手动凭据配置。
