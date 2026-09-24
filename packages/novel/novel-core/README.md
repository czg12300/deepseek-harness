---
description: "Save each novel in its own directory, edit chapters independently, and preserve immutable revisions. Import an existing project without moving it. Assistant suggestions stay separate from saved text until the author applies them."
kind: "package-reference"
---
# @deepseek-ai/dsh-novel-core

English | [中文](README.zh.md)

## Summary

Save each novel in its own directory, edit chapters independently, and preserve immutable revisions. Import an existing project without moving it. Assistant suggestions stay separate from saved text until the author applies them.

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

Create with a title, synopsis, parent directory and stable request ID. The service creates a child directory containing novel.json and .novel/project.sqlite. Duplicate paths are refused. Renaming changes metadata only; removing a registration leaves its directory and Session routes intact.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Opening a supported older database creates a consistent backup in `.novel/backups` before updating its schema. Unknown newer schemas are refused.

Each document has its own monotonically increasing revision. Saves compare the expected revision under the SQLite writer lock. A conflict returns the current saved document and changes nothing. Restoring history adds a new revision. Proposal application updates the text, revision, disposition and retry receipt in one transaction.

No invariant companion is published: saved state and operation results derive from the same transaction or existing JSONL handle, with no independently updated authoritative copy.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Novel subsystem](../../../docs/subsystems/novel.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through the novel Agent runtime, which logs the frozen task and read-only references before requesting model output.

#### KV Cache effect

Project mutations do not make model requests. A later assistant task records a fresh document snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Registered directories must remain available at their recorded paths. Relocation and portable backup commands are not exposed.
- External Markdown edits are not imported automatically; SQLite is the manuscript authority.
- A failed creation before its marker is published leaves an incomplete directory for operator inspection.

<a id="dev-note"></a>
### Dev Note

None.
