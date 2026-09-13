---
description: "Account connection and model selection in the optional third-party authorization plugins."
kind: "package-bundle"
---

# @deepseek-ai/dsh-third-party-auth-bundle

English | [中文](README.zh.md)

## Summary

Add optional ChatGPT and Claude account connections to a Web profile. The layer mounts the authorization service, account runtime, and settings UI. No existing base, Web bundle, or preset file is edited. This checkout-only bundle is not a published registry release.

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

The entry is the package-owned `cordis.patch.yml` applied above the Web profile. Build the workspace before launching the UI so all existing client artifacts are available. Registry installation and Desktop loading are not yet validated.

This source validation entry was launched with an isolated data directory; run it from the repository root.

```sh
DSH_HOME="$PWD/.artifacts/third-party-auth-preview/home" pnpm dsh --profile web --patch packages/third-party-auth/third-party-auth-bundle/cordis.patch.yml --port 0 --no-open
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The layer inserts three rows and carries explicit runtime dependencies. The account package owns credentials and native-session behavior; the UI package owns navigation and rendering. The bundle itself has no model-facing tool or alternate application launcher.

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

Mounted account providers determine model behavior. Applying the layer alone does not send a model request or automatically sign in.

#### Token effect

Authorization, catalog reads, and conversation creation do not submit model prompts. Model inference uses the selected provider's quota; native turns run through `query()`.

#### KV Cache effect

ChatGPT requests use the existing `llm-pi-ai` history path. Native Claude `resume` restores official context; its runtime owns cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The layer requires a Profile that already supplies the base services. A composition that already mounts the authorization service must avoid duplicate service registration. Missing native platform payloads leave Claude unavailable.

Runtime invariant: no companion is published. One owner controls each attempt and stream; authentication, connection intent, and catalog availability intentionally describe different facts.

<a id="dev-note"></a>
### Dev Note

The Loader composition fixture verifies registration over the shipped headless base with its one-shot runner disabled. Real account validation remains separate.
