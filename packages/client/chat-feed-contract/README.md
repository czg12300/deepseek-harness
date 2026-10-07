---
description: "Type application-owned Session selection and navigation callbacks for an embedded Chat Feed without importing its implementation."
kind: "package-library"
---

# @deepseek-ai/dsh-client-chat-feed-contract

English | [中文](README.zh.md)

## Summary

Type application-owned Session selection and navigation callbacks for an embedded Chat Feed without importing its implementation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import this package for types and the `chat-feed.view` slot declaration. Applications own the root slot declaration and provide `FeedOwnerProps`; [ui-chat-feed](../ui-chat-feed/README.md) registers its renderer there. This library registers no plugin and opens no Session.

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

- The contract provides one root slot declaration owner per composition; it does not define conversation persistence or task execution.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
