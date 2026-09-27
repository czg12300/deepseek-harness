# Agent Note: Isolated third-party account plugins

Status: implemented

English | [中文](2026-09-09-isolated-third-party-accounts.zh.md)

## Problem

Account sign-in and model selection need a settings entry, but putting provider-specific logic in the settings shell, session controller, or global Agent factory creates repeated upstream rebase conflicts. Native Claude also owns an agent loop and transcript format that cannot be treated as an ordinary model HTTP adapter.

## Decision

Keep the Host implementation, UI, and optional bundle under [one package group](../../../../packages/third-party-auth/README.md). Register settings and an independent native window through existing slots. Consume public services in one direction, without original modules importing the new feature. GPT reuses the existing authorization flow and grants. Claude uses its official CLI and SDK with an integration-owned configuration directory and SQLite transcript mirror.

The [default Web plugin decision](2026-09-15-default-web-account-and-comics-plugins.md) owns default activation. This note retains ownership of provider isolation and native conversations.

The [credential-record decision](2026-08-13-credential-records-and-authorization-flows.md) remains the authority for stored grants. The [one-shot product-provider decision](../feature/2026-08-04-claude-code-and-codex-subagent-backends.md) remains the authority for existing subagents; its files and semantics are not replaced. Neither note is superseded by this separate account consumer.

## Alternatives considered

- Add provider branches to the ordinary Agent factory and session controllers: couples native execution to upstream control flow.
- Reuse Claude subscription tokens as model API credentials: bypasses the official native execution and credential ownership.
- Copy or extract the existing one-shot subagent implementation: expands this change into code owned by a different consumer.

## Consequences

Settings and API-key behavior remain independent. Native conversations retain their own history and require explicit workspaces; they do not appear as ordinary Harness Sessions. The Web bundle declares the account packages as runtime dependencies; provider-specific behavior remains outside the settings shell and ordinary Agent factory. Private prompt capabilities, route ownership, cancellation, and native mirror integrity have focused tests. Live subscription authorization and inference remain explicit verification gaps.
