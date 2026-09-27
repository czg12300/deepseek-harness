---
description: "Manage comic-production projects, manual drafts, archive state and revision history from the Multica Web workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-multica

English | [中文](README.zh.md)

## Summary

Open “Comics” in the left sidebar to manage projects, script Markdown, production canvases, and imported media. Draft scripts manually or request planner and writer proposals. Confirm a saved script before creating an episode or whole-film production unit. Review remains separate from production.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

The assistant panel preserves unsent prompts per target and displays task status, configuration version, selected skills and controlled tools. Expand “Draft export and planning assistant” on the creation page to use the planner. Sending a creation prompt first saves its independent form; creating the formal project remains a separate action. Compare before/after values and choose fields before applying. Later manual edits and locked fields are protected. Application never approves content. The review center requires a selected saved revision and a separate human decision.

Agent configuration lists all nine roles and actual capabilities. Planner and writer are enabled by the host runtime; other roles remain unavailable. Publishing a configuration opens a new version-bound conversation for subsequent tasks. Existing conversations remain readable, and running tasks retain their original role and object.

The professional input uses the main conversation card and model menu. Model and reasoning-effort choices are retained per authoring target and captured with each submitted prompt, including uncertain transport retries. Enter sends and Shift+Enter inserts a newline; composing an IME character never sends. Running tasks expose a stop button.

With no explicit draft selection, reopening a workspace restores the model and effort of its latest completed task; failed selections do not replace that choice. The widened assistant panel keeps its input visible while messages scroll independently.


The story-outline assistant offers drafting, development and logic-check prompts using the current project and local outline. Shortcuts fill the composer without sending or replacing an unsent request. Outline proposals show the complete replacement and apply to the editor with one explicit action that saves a draft revision; locks and stale-content checks still apply. Work history and settings are collapsed beside the task-focused dialogue.

-----

<a id="use-this-package"></a>
## Use this package

“New project” opens a centered dialog above the project catalog or current project. The top-right close button, Escape and backdrop dismiss the dialog while preserving the creation draft for reopening. The form scrolls within the viewport and the create button remains visible.

Each work owns one folder. Choose a new or empty folder below the project name in the creation form; the picker binds that folder directly to this work. Project cards show their saved paths. Use “Open project” in the home header or the “Create or open a project” card to choose an existing folder and recover its content and professional conversations on another device. Cancelling the picker leaves the home page unchanged; opening failures appear on the home page. Each folder-backed card has a top-right “Delete” button. Confirmation removes only its device catalog entry, even when its directory or database is missing. It does not save drafts, close the project or stop its tasks; in-memory drafts remain available. “Open project” can register an available folder again. Project settings provide a complete backup copy. The close action saves the current text buffer, stops local professional tasks and waits for file release before reporting that the directory can be copied or the drive ejected. Failed saves retain the editor and show the host error. Model credentials remain configured on each device.

“All projects” and “Actor library” are tabs in one Multica workspace. Switching tabs keeps the current browser location and library selection. Create independent libraries, add actors with portrait and full-body reference images, search by name, filter by period and region, export a ZIP, or import and merge an archive into the selected library. The Host service owns the SQLite databases and files; the browser only carries user-selected image and archive bytes to the typed Remote calls.

Inside a folder-backed project, the left directory lists story Markdown, production units, and project assets. Select a script to read it in the center and use the right assistant for outline, biography or episode proposals. Biography suggestions save to their own Markdown document rather than the project outline. “Edit document” saves the complete Markdown; “Add episode” creates a new project revision and script file. Explicit script confirmation requires a nonempty saved outline and at least one nonempty episode script. Editing script content invalidates that confirmation. Production units open a draggable canvas with a floating text-assistant composer; its reply becomes a text node only when added explicitly. Import a PNG, JPEG, WebP, MP4, MP3, WAV or OGG file up to 16 MiB into a production unit. The asset catalog filters media and previews images at adjustable scale or plays video and audio in a dialog.

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

Folder-backed projects provide script Markdown, production canvases and imported media alongside project management.

- Unsaved drafts are in memory; browser reload, plugin replacement or closing the page discards them unless saved or exported.
- History and save conflicts operate on complete projects, including all episode drafts. There is no automatic field merge or separate episode revision counter.
- Other windows' edits are discovered on project reads or saves; the service provides no live project-change subscription.
- Model-driven image, video, and audio generation, budgets, timeline editing, and final export are unavailable. The canvas assistant provides text suggestions through the existing planner or writer target; imported files are the only media assets. Actor reference images and actor-library ZIPs do not produce project media. Unconfigured assistants report their actual failure.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
