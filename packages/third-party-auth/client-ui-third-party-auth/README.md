---
description: "Account connection and model selection in the optional third-party authorization plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-third-party-auth

English | [中文](README.zh.md)

## Summary

Manage subscription connections in Settings → Third-party authorization. The page shows connection status, private authorization prompts, and per-provider default models. ChatGPT starts an ordinary Harness conversation; Claude opens an independent native conversation window. Existing API-key settings remain separate.

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

Load the sibling bundle in the Web profile. Connect an account, choose a default from its discovered models, and select Start a session with this model. The native window requires an explicit working directory and supports conversation selection, follow-up messages, stopping, and permission answers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

This plugin mounts its own generated Remote contribution and registers `settings.section` at order 12 and an additive `shell.overlay`. It owns its locale dictionaries and stores. Closing the settings page cancels its login stream. Native conversation cancellation has a separate owner, so closing settings does not accidentally end another account operation.

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

The page does not assemble model input. It forwards explicit user model choices and, in the native conversation window, the messages and permission answers the user submits.

#### Token effect

Authorization, catalog reads, and conversation creation do not submit model prompts. Model inference uses the selected provider's quota; native turns run through `query()`.

#### KV Cache effect

ChatGPT requests use the existing `llm-pi-ai` history path. Native Claude `resume` restores official context; its runtime owns cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Account controls are unavailable to remote browsers. Provider notices retain their native language. Email is shown only when native account metadata supplies it; otherwise the card says Account connected. Native history is separate from the ordinary Harness conversation list.

Runtime invariant: no companion is published. One owner controls each attempt and stream; authentication, connection intent, and catalog availability intentionally describe different facts.

<a id="dev-note"></a>
### Dev Note

The unit interaction suite uses a scripted remote boundary. A rendered real-profile check and authorized account validation are separate evidence.
