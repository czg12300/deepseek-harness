---
description: "Manage comic-production projects, manual drafts, archive state and revision history from the Multica Web workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-multica

English | [中文](README.zh.md)

## Summary

Open “Comics” in the left sidebar to manage comic projects and immutable text revisions. Draft outlines and scripts manually or request proposals from the planner and writer. Select proposed fields explicitly, then submit saved content for human review. Recover saved creation forms, publish role configurations and keep conversations attached to their original objects. Media production remains unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The assistant panel preserves unsent prompts per target and displays task status, configuration version, selected skills and controlled tools. Expand “Draft export and planning assistant” on the creation page to use the planner. Sending a creation prompt first saves its independent form; creating the formal project remains a separate action. Compare before/after values and choose fields before applying. Later manual edits and locked fields are protected. Application never approves content. The review center requires a selected saved revision and a separate human decision.

Agent configuration lists all nine roles and actual capabilities. Planner and writer are enabled by the host runtime; other roles remain unavailable. Publishing a configuration opens a new version-bound conversation for subsequent tasks. Existing conversations remain readable, and running tasks retain their original role and object.

-----

<a id="use-this-package"></a>
## Use this package

The [Web bundle](../../bundle/web-app/README.md) mounts this browser plugin alongside the [project service](../../multica/studio-core/README.md). It has no plugin configuration fields. The sidebar entry is “Comics” in English and “漫剧” in Chinese; it remains available as an icon with a tooltip when the sidebar is collapsed.

Create a project with one concept or source script. “More settings (optional)” contains the name and production specifications; the initial aspect ratio is 16:9 and episode count and duration are undecided. An omitted name uses the first 50 Unicode code points of the trimmed concept, or “Untitled project” in the current locale when only source text is supplied. All fields remain editable in project settings. Importing a UTF-8 `.txt` or `.md` file copies its source text into the draft; it does not generate episodes. The project sidebar selects the outline, episode list, individual scripts, settings and history. Project settings also rename, archive and restore the project.

Each save submits the complete project against its draft's expected revision. A conflict displays the current saved content alongside the local draft. The user can export the local draft, explicitly discard it and load the current saved version, or confirm the local content as a new version. Confirming local content replaces the complete remote project content; it is not a field-level merge. Archived projects remain read-only until restored.

Unsaved drafts and the selected page survive project navigation and main-panel remounts during the plugin's lifetime. Save or export before reloading or closing the browser. Export downloads a local JSON draft; it is not a complete database backup or a project import format.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser entry registers the `multica` main panel and sidebar icon through the existing slots. A declared store holds navigation and unsaved drafts; a separate Remote query model publishes observed saved projects through an injected framework hook. Requests retain their project identity across navigation. Read sequencing and revision checks reject stale observations, while disposal suppresses late publications. The host service remains authoritative for persistence and archive state.

No `./invariant` companion is published: this plugin owns viewing state and pending drafts, and the host checks durable project relationships. The [revision decision](../../../.agents/notes/implemented/architecture/2026-09-10-multica-project-revisions.md) explains project-level versioning and Session separation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these owners for persistence, navigation registration and the full production design.

- [Project service](../../multica/studio-core/README.md) — data location, validation, revisions and backup.
- [Sidebar](../ui-sidebar/README.md) — panel entries and collapsed controls.
- [Multica design](../../../multica/doc/index.md) — page specifications and later production stages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through explicit dialogue submissions to the [professional runtime](../../multica/studio-agents/README.md), which logs and sends the captured draft and prompt. Navigation and human review do not submit model requests.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The project foundation provides manual text editing and project management.

- Unsaved drafts are in memory; browser reload, plugin replacement or closing the page discards them unless saved or exported.
- History and save conflicts operate on complete projects, including all episode drafts. There is no automatic field merge or separate episode revision counter.
- Other windows' edits are discovered on project reads or saves; the service provides no live project-change subscription.
- Shared media assets, generation, budgets and editing/export are unavailable. Unconfigured assistants report their actual failure; no successful model or production result is synthesized.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
