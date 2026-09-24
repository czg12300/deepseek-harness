---
description: "Discuss and revise novel documents through real Agent Sessions. Each request captures one saved version and its editable spans, then returns suggestions without saving manuscript text. Later requests continue the same conversation."
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-agents

English | [中文](README.zh.md)

## Summary

Discuss and revise novel documents through real Agent Sessions. Each request captures one saved version and its editable spans, then returns suggestions without saving manuscript text. Later requests continue the same conversation.

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

Compose with novel project, Agent, model routing, preset, Session persistence, system prompt and tool services. maxTokens, maxSteps and timeoutMs bound output, steps and execution time. Creating projects and opening pages do not call a model.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The task Session scope rejects messages from other entry points and inherited tools. The runtime permits only the active task structured-output capability. Cancellation waits for actual model and tool settlement. A missing initialized Session log fails explicitly.

No invariant companion is published: execution validates task ownership and Cordis effects own scopes and Agent handles.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Novel subsystem](../../../docs/subsystems/novel.md)
- [Project storage](../novel-core/README.md)

<a id="model-experience"></a>
## Model Experience

### Captured authoring request

#### What the model sees

Ordinary user messages record the author request, frozen document version, editable spans and bounded read-only references. The system prompt limits the assistant to proposals; the shared structured_output protocol adds output requirements.

##### Authoring instruction

```markdown
You are a novel-writing assistant. Respond in the author's language. Work on the exact saved document and editable spans in the current request. References are read-only story context. Preserve established facts unless the author requests a change. Return an explanation and replacements for editable span IDs; use no replacements when answering a question. Never claim that a suggested edit has already been saved.
```

#### Token effect

Each request appends the current document, editable ranges and reference text. History grows within the same document conversation.

#### KV Cache effect

Author messages append after the stable prompt; later requests may reuse an unchanged prefix.

### Structured suggestions

#### What the model sees

structured_output accepts reply and replacements. Each replacement names a spanId published for this task and its replacement text; an empty array answers without editing.

#### Token effect

Output contains the explanation and replacement text; document storage checks size and ranges before publishing a proposal.

#### KV Cache effect

Tool calls and results append to Session history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The runtime provides captured document context and structured output, not web research or arbitrary file tools.
- Cancellation supports tasks owned by the current Host process; interrupted requests are not resubmitted automatically.

<a id="dev-note"></a>
### Dev Note

None.
