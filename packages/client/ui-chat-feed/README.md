---
description: "Render an application-selected Session with streaming messages, Markdown, tool cards, process folding and history paging, independently of the main Chat selection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-chat-feed

English | [中文](README.zh.md)

## Summary

Render an application-selected Session with streaming messages, Markdown, tool cards, process folding and history paging, independently of the main Chat selection.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this plugin. A host declares the root-scoped `chat-feed.view` slot from [chat-feed-contract](../chat-feed-contract/README.md), supplies its Session ID, publication state and running state, and owns the conversation list, composer and task execution. The feed opens only mounted readers and releases the stream after the last reader unmounts. Additional user text blocks can be folded as inspectable context. `pageMessages` is a positive integer configuration field with default 50. File, skill, inspection and branch actions are supplied by the host.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Ownership, copy provenance and maintenance trade-offs are recorded in the [Chat Feed decision](../../../.agents/notes/implemented/architecture/2026-09-30-independent-chat-feed.md). No invariant companion is published: registry and Session journal validation directly constrain the data this package uses; this package maintains no independent durable facts.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no model context and does not modify model requests.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The copied renderer has independent extension slots. Main-Chat-only third-party renderers do not automatically register in the feed. Reader anchors and fold state remain in memory during the plugin lifetime.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
