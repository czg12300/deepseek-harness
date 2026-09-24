---
description: "Open Novels in the existing sidebar to create, import and edit directory-backed novels. Edit manuscript documents in the center and request suggestions from the assistant on the right. Compare suggestions before applying them."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-novel

English | [中文](README.zh.md)

## Summary

Open Novels in the existing sidebar to create, import and edit directory-backed novels. Edit manuscript documents in the center and request suggestions from the assistant on the right. Compare suggestions before applying them.

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

The Web composition mounts this browser plugin with the novel services. Creation asks only for title, synopsis and folder. The directory dialog targets the serving Host and supports its native chooser or browse operations. autoSaveMs controls idle saves; zero disables automatic saving.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Declared stores retain local drafts and navigation during the plugin lifetime. An independent query model publishes saved records. Requests retain document identity across navigation. Suggestions are applied only against their saved base version; conflicting local text remains editable or downloadable.

No invariant companion is published: saved state and operation results derive from the same transaction or existing JSONL handle, with no independently updated authoritative copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Novel subsystem](../../../docs/subsystems/novel.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through explicit sends to the novel Agent runtime; opening or editing a page does not start a model request.

#### KV Cache effect

Viewing state does not alter the request prefix; the runtime owns captured task input.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Assistant replies appear after the structured task settles; token-by-token streaming is not rendered.
- Unsaved browser drafts survive panel navigation but not a browser reload. Save or download them before closing.
- Other windows are observed on reads and version-checked writes, not through a live project subscription.

<a id="dev-note"></a>
### Dev Note

None.
