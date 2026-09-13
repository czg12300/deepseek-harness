---
description: "Account connection and model selection in the optional third-party authorization plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-third-party-auth

English | [中文](README.zh.md)

## Summary

Connect ChatGPT and Claude accounts without entering API keys in a second settings surface. ChatGPT uses the existing OAuth credential store and Codex route. Claude uses the pinned official runtime and a separate native conversation store. Account authentication, integration enablement, and model discovery remain distinct states.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use the sibling bundle over a local Web profile with credentials, authorization, settings, LLM, and subprocess providers. The controller rejects account management when the Web server binds all interfaces. `connectTimeoutMs`, `maxQueuedEvents`, `cwd`, `graceMs`, `statusTimeoutMs`, `outputBytes`, `databasePath`, `turnTimeoutMs`, `maxTurnEvents`, and `nativeConfigDir` are deployment configuration fields; their defaults and validation are declared in `src/index.ts`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Account operations use a private Remote stream whose attempt capability is disclosed only to its initiator. GPT grants remain under `llm-pi-ai/openai-codex`; independently configured routes are refused, and disconnect removes only an unchanged route created by this plugin. Claude sign-in runs the unmodified CLI with an integration-owned configuration directory. Native conversations mirror official SDK records in a separate SQLite domain at schema version 1 and use those records for official resume. They do not enter the default Harness Agent factory or change released Harness Session files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Account subsystem](../../../docs/subsystems/third-party-auth.md) describes connection and native-session ownership.

-----

<a id="model-experience"></a>
## Model Experience

### Account-backed conversations

#### What the model sees

The selected ChatGPT model receives the ordinary Harness request. Native Claude receives the user's explicit message, selected workspace and model, its native context, and tool permission answers. Native tool execution is owned by Claude Code rather than repeated by the Harness loop.

#### Token effect

Authorization, catalog reads, and conversation creation do not submit model prompts. Model inference uses the selected provider's quota; native turns run through `query()`.

#### KV Cache effect

ChatGPT requests use the existing `llm-pi-ai` history path. Native Claude `resume` restores official context; its runtime owns cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- One account per provider is supported. Catalog entries are not proof of account entitlements. Native model activity requires a Host that can launch the pinned CLI; startup failures remain failures. Native conversations have their own history and do not support ordinary Harness Session fork/export or cross-executor context conversion. Closing their stream stops the current turn. Changes already made by native tools are not rolled back.

Runtime invariant: no companion is published. One owner controls each attempt and stream; authentication, connection intent, and catalog availability intentionally describe different facts.

<a id="dev-note"></a>
### Dev Note

Native account and model probes pass in the latest run on the development Host. Earlier runs observed SIGKILL, whose cause was not established. The real SDK conversation, permission, and cancellation fixtures still encounter SIGKILL during startup, before caller cancellation or managed termination. Real-account browser authorization and model inference also require account-specific validation.
