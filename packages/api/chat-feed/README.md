---
description: "Open validated Session event journals for independently mounted Chat Feed views without changing the selected main conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-chat-feed

English | [中文](README.zh.md)

## Summary

Open validated Session event journals for independently mounted Chat Feed views without changing the selected main conversation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this browser service. [Chat Feed](../../client/ui-chat-feed/README.md) requests an unopened reader from `ctx.chatFeedTransport`, opens it while a transcript is mounted, and awaits its disposal after the last reader releases it. This package reuses the Session Controller journal protocol and supplies no configuration fields.

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

- The caller owns opening, pagination and disposal. A reserved Session must be published before its journal can be read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
