# Agent Note: 默认 Web 账号和漫剧插件

Status: implemented

[English](2026-09-15-default-web-account-and-comics-plugins.md) | 中文

## Problem

普通 Web 启动必须显示账号登录和漫剧，不能要求用户记住额外的 patch 文件。仅安装包不会注册导航入口。

## Decision

[Web bundle](../../../../packages/bundle/web-app/README.zh.md)在已有 Multica 项目服务、专业 Agent 和漫剧 UI 之外，挂载授权服务、账号服务及其设置 UI。其清单将每个挂载包声明为运行依赖。账号登录仍需要用户主动操作。

独立账号 bundle 用于不包含这些配置项的自定义 Profile；将其叠加到默认 Web Profile 会重复注册服务。[独立账号决策](2026-09-09-isolated-third-party-accounts.zh.md)继续负责 Provider 和原生会话隔离。[Multica 版本决策](2026-09-10-multica-project-revisions.zh.md)继续负责项目持久化和默认漫剧组合。这两份记录的独立决策继续适用，因此保持有效。

## Alternatives considered

- 要求启动时指定 patch：普通重启会遗漏导航入口。
- 将账号 Provider 加入共享 base：会在不需要账号 UI 的 headless 和 SDK 组合中加载 Web 账号功能。
- 启动时强制登录：混淆功能可用性与用户连接账号的选择。

## Consequences

默认 Web 启动会加载账号运行时，并在登录前打开本地会话存储。设置和侧栏入口使用已有的本地化插槽。设置页浏览器用例基于正式组合检查两个账号登录控件和漫剧入口；中英文预期输出记录设置导航。Multica 浏览器用例覆盖项目持久化。真实订阅授权和推理不属于本次配置修改。
