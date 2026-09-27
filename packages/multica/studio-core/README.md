---
description: "Save Multica projects, outline and episode drafts in SQLite, retain immutable revisions, handle conflicting edits, and archive or restore projects."
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-core

English | [中文](README.zh.md)

## Summary

Save a project's specifications, source text, outline, and ordered episode scripts, then reopen them after a restart. Each successful edit preserves the previous revision, including episode text and identity. Conflicting edits return the current project so the caller can retain and merge its local draft. Archived projects remain readable and can be restored. Creating a project does not start an agent or generate media.

## Table of Contents

- [Use this package](#use-this-package)
- [Actor libraries](#actor-libraries)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

`StudioTaskRequest.modelSelection` optionally overrides the workspace model for one task. Provider, model and reasoning effort are captured in its immutable resolved dependencies; reusing a request ID with a different selection is rejected. Workspace skills, tools and role remain fixed. Tasks without a selection use the workspace default.

Task views include the captured reasoning effort so authoring clients can restore a successful selection without reading full task inputs.


-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a Multica host composition when projects need durable manual editing and version history.

### Minimal configuration

The default mount uses the resolved Harness home (`DSH_HOME`, then `~/.dsh`) and creates missing database directories.

```yaml
- name: '@deepseek-ai/dsh-studio-core'
```

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `DSH_HOME`, then `~/.dsh` | Explicit Harness home takes precedence. |
| `databasePath` | `multica/studio.sqlite` | Home-relative or absolute database file path inside the home. |
| `busyTimeoutMs` | `5000` | SQLite writer lock wait, from 0 to 2,147,483,647 integer milliseconds. |

<a id="portable-project-folders"></a>
### Portable project folders

The creation UI calls `prepareFolder(path, draftId, input)` before publishing a project with `createFromDraft()`. The path must be absolute and new or empty. A folder contains `multica.project.json`, `project.sqlite`, project conversations under `sessions/`, and `assets/`, `artifacts/`, and `exports/`. The manifest identity survives directory moves; stored content and asset files travel with the directory. Published role configurations belong to the project. Credentials and executable plugins remain device-owned.

`openFolder()` opens an existing project or saved creation form. `projectFolders()` lists this device's recent locations without opening their databases. The local `databasePath` holds the recent index, shared role templates and legacy projects; losing that index does not prevent opening a portable folder. `create()` and creation forms without a folder retain the legacy host API. The browser creates folder-bound projects. Selecting a directory for an unpublished legacy form also copies its saved revisions and planner conversations, retaining the source.

`closeFolder()` stops owned tasks, closes their Session storage, checkpoints the project database and releases its exclusive SQLite lock. Copy the complete folder only after close succeeds. `backupFolder()` copies a quiescent project while retaining its lock, then closes the source. It refuses linked files and nonempty destinations. A disconnected or replaced directory cannot silently become a new project. A second writer and two open copies of the same manifest identity are refused.

`migrateProject()` copies one legacy project's revisions, creation history, proposals, reviews, role history and initialized conversations into an empty directory. Other projects remain outside the copy and the source remains intact. An incomplete migration marker prevents opening a partial result. `saveEditorDraft()` stores a recoverable editor buffer separately from formal revisions; reopening restores it with its original base revision for conflict detection. The device database’s `studio_locations` table stores each folder identity with its project ID, canonical path and cached summary in `document`. `forgetFolder()` marks an entry hidden without reading or changing project files, including when its directory is unavailable. Catalog removal leaves mounted runtimes and write locks unchanged; explicit closure owns their release. Metadata refreshes preserve the hidden flag. Retained ownership prevents a migrated legacy project from reappearing in the catalog; `openFolder()` restores the same entry without duplication.

Each folder-backed project stores generated and edited outline, character, and episode Markdown under `scripts/`; schema-5 `studio_script_documents` indexes the file paths and text. `completeScript()` records the digest of a nonempty saved outline and every nonempty episode script, and a later script edit invalidates it. The `studio_production_units` and `studio_canvas_nodes` tables persist episode or whole-film canvases and text or media nodes. `importProjectMedia()` copies a validated image, video, or audio file into `artifacts/<unit-id>/` and indexes it in `studio_media_assets`; `projectMediaData()` returns bytes for a selected preview. Media imports are limited to 16 MiB per file. The device catalog and actor libraries remain outside the project folder.

The folder tests exercise a copy into a fresh Harness home, a different path, recovery drafts, migration, ownership contention and missing-directory writes. Physical removable-drive fault injection and cross-OS drive testing are not covered by these fixtures. Network shares and simultaneous editing of separate copies are not a synchronization mechanism.

<a id="actor-libraries"></a>
### Actor libraries

`actorLibraries()` lists independent folders under the `actor/` directory beside the device's `studio.sqlite`. Each library has its own manifest, `library.sqlite`, and referenced images under `assets/`. `createActorLibrary()` creates one folder; `saveLibraryActor()` stores manually entered actor details and up to two PNG, JPEG or WebP references. `libraryActors()` searches one library with pagination, while `libraryActor()` reads both references for editing. No operation changes a project or starts an Agent.

`exportActorLibrary()` returns a complete ZIP; `importActorLibrary()` installs it separately or merges it into a selected library. Merge compares stable actor IDs and content fingerprints, keeps conflicting versions, and tracks imported identities so retrying an archive does not duplicate actors. The ZIP is limited to 32 MiB compressed, 64 MiB extracted, 500 files and 2 MiB per image. The [actor-library design](../../../multica/doc/actor-library.md) describes the file structure and conflict rule.

### Read and edit projects

Host consumers use `ctx.studioProjects`; clients mount the default Typert-generated contribution from `./remote`, conventionally imported as `studioProjectsRemote`, under the `studioProjects` namespace. Public data types are available from the client-safe `./types` export. Remote methods wrap the synchronous host methods; successful mutation returns only after the SQLite transaction commits.

`list()` returns live metadata for open and legacy projects, and cached summaries for closed folders, sorted by newest update then project ID; archived projects are included. `get(id)` returns the current project or `null`; a registered portable project must be open. These reads load only current documents. `history(id)` returns complete revisions oldest first, or an empty array for an unknown project, and validates historical continuity.

`create(input)` accepts the complete [editable content](src/types.ts) and returns revision 1. Names must be nonblank and contain at most 50 Unicode code points; concepts contain at most 3000. Aspect ratios are `16:9`, `9:16`, or `1:1`. Target episode counts are positive safe integers or `null`; episode durations are positive finite seconds or `null`. A target count does not create episodes. Other creative text may be empty, and every input field is required.

Projects receive a host-generated UUID. Callers assign a fresh lowercase UUID to each new episode and retain it across edits and reordering. Duplicate episode IDs and IDs ever saved by another project are rejected, even if that project has removed the episode. IDs carry distinct TypeScript brands. Project timestamps are ISO UTC strings with millisecond precision; creation time is stable, and update time never decreases.

`save(id, expectedRevision, input)` appends a revision. `setArchived(id, expectedRevision, archived)` appends an archive or restore transition without changing creative content; requesting the current archive state is a no-op. Both return `{ status, project }`: `saved` carries the result, `conflict` carries the current project when the expected revision is stale, and `archived` rejects a content save to a read-only project. A stale revision takes precedence over archived status. Rejections leave both stored history and the caller's input unchanged; the caller owns its unsaved draft.

Invalid wire input, unknown projects on writes, incompatible databases, corrupt stored documents, and filesystem or SQLite failures throw. Every current-document read checks the JSON fields, revision columns, and episode ownership. Only explicit history reads inspect older documents and check contiguous revisions, stable creation time, and nondecreasing update times. Returned documents are detached values, so caller mutations do not alter persisted history.

### Professional drafts and human review

`saveCreationDraft()` persists an independent creation form, including a blank name. `createFromDraft()` validates the completed form and publishes its project exactly once. `openWorkspace()` binds a target to an immutable role version and reserved Session ID without creating an Agent. Nine distinct roles are seeded; the execution backend reports which roles and controlled tools are actually available.

`startAssistant()` resolves dependencies, freezes the full local input and approved references, and records an idempotent task before dispatch. A workspace admits one running task. Proposals store immutable before/after values; `applyProposal()` checks selected field locks, current local values and the saved base revision in one transaction. An applied proposal creates a new draft revision. `submitReview()` and `decideReview()` are separate human operations on exact saved content; a stale or archived target cannot be approved.

Role defaults are deployment configuration under `assistantDefaults`: `maxTokens: 8192`, `maxSteps: 8`, `timeoutMs: 180000`. Published configurations retain their own limits. Restart recovery marks work interrupted only when its owning process is known to have exited; it does not resubmit model requests. Cancelling a task owned by another live process is unsupported.

Supported earlier schemas are upgraded transactionally to schema 5 after a consistent `VACUUM INTO` backup named `studio.sqlite.pre-migration-<uuid>.sqlite` beside the configured database. Restore both the compatible database and its Session logs; returning to schema-1 code requires the pre-migration backup, not a downgrade of the current database.

### Backup and restore

Stop every host using the database, copy its containing directory with all SQLite files, and reopen the copy with the same relative `databasePath` under the restored `dshHome`. The [backup test](tests/projects.spec.ts) verifies saved drafts, archive history, and permanent episode ownership after a stopped-server copy. An incompatible database is rejected without replacement or an implicit downgrade.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

SQLite schema version 5 stores one complete project document per immutable revision. A project ID identifies its revision sequence; a separate permanent episode-owner table prevents cross-project reuse. Writer transactions acquire SQLite's immediate lock before reading the expected revision and insert content and new ownership records atomically. SQL triggers reject revision updates/deletions and ownership changes. WAL with FULL synchronization preserves committed writes, and plugin disposal closes the connection.

The package publishes no `./invariant` companion: persisted document/column/owner relationships are validated on reads and task admission. Folder and Session routing entries share their owning open/close lifecycle; recent summaries are explicitly cached metadata, not a live document mirror. The [store](src/project-store.ts), [folder owner](src/project-folders.ts), and [input validators](src/validation.ts) own these checks. The [focused tests](tests/projects.spec.ts) and [folder tests](tests/folders.spec.ts) cover SQLite behavior, relocation and write ownership.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Multica architecture](../../../multica/doc/architecture-design.md) — project data ownership.
- [Multica page specifications](../../../multica/doc/page-specifications.md) — editing and archive behavior.
- [Harness architecture](../../../docs/architecture.md) — profile and plugin composition.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [professional runtime](../studio-agents/README.md), which logs and sends the exact frozen task, selected skills and approved references supplied by this service. Opening, saving and reviewing content do not invoke a model.

#### KV Cache effect

None; this package neither assembles nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The project document is the unit of persistence and conflict detection.

- Concurrent changes to different episodes still conflict at the project revision; callers must merge explicitly.
- Each save stores the complete project text. Current reads avoid history scans, but explicit history reads return all revisions without pagination.
- Episode drafts and human text reviews use project revision numbers; episodes have no independent revision counter or granular scene data.
- The service provides no live change subscription or media execution. Basic `create()` has no idempotency key; `createFromDraft()` publishes each saved creation identity only once.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
