---
description: "Multica project storage and revision services for the comic-production workspace."
kind: "package-group"
---

# packages/multica

English | [中文](README.zh.md)

## Summary

Multica lets creators save independent comic-production projects and reopen their drafts and history. This group owns project persistence; the browser workspace lives in the client group. Project creation and editing do not start agents or media production.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The project service owns saved content and revision checks.

| Package | Role |
|---|---|
| [studio-core](studio-core/README.md) | Stores projects and immutable revisions, including episode drafts and archive state |

The [professional runtime](studio-agents/README.md) executes explicitly submitted text tasks through dedicated Sessions. Project storage owns immutable role configurations, proposals and human reviews.

<a id="related-documentation"></a>
## Related documentation

- [Multica subsystem](../../docs/subsystems/multica.md) — project identity and revision semantics.
- [Browser workspace](../client/ui-multica/README.md) — project navigation and editing.
- [Product design](../../multica/doc/index.md) — planned production workflows and visual references.

<a id="dev-note"></a>
## Dev Note

None.
