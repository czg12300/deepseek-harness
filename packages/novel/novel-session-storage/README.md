---
description: "Keep novel conversations beside the novel while ordinary conversations retain their configured JSONL root. The provider uses the existing JSONL generation format, migration and write leases."
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-session-storage

English | [中文](README.zh.md)

## Summary

Keep novel conversations beside the novel while ordinary conversations retain their configured JSONL root. The provider uses the existing JSONL generation format, migration and write leases.

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

Compose this provider with novel-core instead of the ordinary JSONL provider. Its root configuration names the existing ordinary Session directory. compression accepts none or zstd. Novel ownership selects .novel/sessions under the registered project directory.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Each JSONL provider mounts in an isolated service realm that shares Session events with the Host. Session handles, committed generations and file locks remain owned by that provider. Router teardown disposes all provider fibers and reports failures.

No invariant companion is published: saved state and operation results derive from the same transaction or existing JSONL handle, with no independently updated authoritative copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Novel subsystem](../../../docs/subsystems/novel.md)

<a id="model-experience"></a>
## Model Experience

None, as this provider only routes Session persistence operations and adds no model context.

#### KV Cache effect

Persistence routing does not change the model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Project directories must remain mounted while their Sessions are in use.
- Session discovery is limited to novels registered on this Host.

<a id="dev-note"></a>
### Dev Note

None.
