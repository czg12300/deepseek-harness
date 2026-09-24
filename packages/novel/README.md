---
description: "Directory-backed novel projects, document revisions and controlled Agent authoring."
kind: "package-group"
---
# novel/ — Novel authoring

English | [中文](README.zh.md)

## Summary

Each novel owns a directory for its content and Sessions. Project storage preserves versions, the runtime produces suggestions, and persistence routing retains ordinary Session locations. The browser page belongs to the client group.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

These packages own saved manuscripts, model execution and Session locations.

| Package | Role |
|---|---|
| [novel-core](novel-core/README.md) | Projects, documents, history and proposals |
| [novel-agents](novel-agents/README.md) | Agent execution over frozen task context |
| [novel-session-storage](novel-session-storage/README.md) | JSONL Session routing into project directories |

<a id="related-documentation"></a>
## Related documentation

- [Novel subsystem](../../docs/subsystems/novel.md)
- [Browser workspace](../client/ui-novel/README.md)

<a id="dev-note"></a>
## Dev Note

None.
