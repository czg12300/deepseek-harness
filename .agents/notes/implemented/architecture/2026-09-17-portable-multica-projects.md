# Agent Note: Multica project folders own their portable data

Status: implemented

English | [中文](2026-09-17-portable-multica-projects.zh.md)

## Problem

A creator moving a work to another device needs its revisions, saved drafts, role configuration and conversations together. A device-wide project database and a separate global conversation store make copying a directory insufficient. Absolute execution paths and process IDs cannot identify a project's current location or writer on another device.

## Decision

Each browser-created work starts in an empty directory with a versioned manifest, a project SQLite database and project-local Session storage. The manifest identity survives moves; the device database holds recent locations and legacy projects. Opening a folder acquires an exclusive SQLite lock retained until its tasks, Agents and databases close. Project ownership, rather than a foreign PID, determines restart recovery. Incomplete creation or migration results remain marked and cannot be opened as complete projects.

The creation form owns its directory selector beneath the project name. A successful selection binds only that creation draft; cancellation leaves it unbound. The project catalog header and creation card share the same existing-folder picker; each project card displays its saved location. The client declares the directory-picker Remote dependency so the button can invoke the composed host service.

The deployment's JSONL provider routes explicitly owned Session identities to mounted project stores. Portable professional Sessions use SQLite transactions and omit an absolute working directory; their frozen task objects and current project mount determine scope. Published events are logged through the existing Session extension point. The Agent loop and ordinary conversation storage are unchanged. Project Session headers and committed events are immutable.

Legacy migration copies one project's relational closure and initialized conversations, retaining the source. Close saves the selected editor buffer separately from formal revisions; restoring that buffer preserves its base revision. Backup retains project ownership while copying, rejects external links, and publishes the destination manifest only after data copying. Credentials and executable plugins are device-owned.

The [project revision decision](2026-09-10-multica-project-revisions.md) and [professional task decision](2026-09-11-multica-professional-tasks.md) remain active: aggregate versions, frozen inputs, role permissions and human review remain authoritative. This note owns directory portability and Session placement.

## Alternatives considered

**Move only the project database.** Professional history still depends on the original device, so it does not satisfy a complete folder transfer.

**Use the ordinary JSONL publication algorithm unchanged.** Its POSIX hard-link publication requires filesystem capabilities unavailable on exFAT. Project-scoped SQLite storage avoids that requirement while retaining the shared persistence interface and append-only semantics.

**Store credentials inside the project.** Moving creative work does not authorize copying account credentials. Missing providers are reported when needed, while manual content remains accessible.

## Consequences

Recent locations are reconstructible by opening project folders. Catalog deletion retains a hidden device ownership record so the untouched legacy migration source cannot reappear as a separate project. Deletion changes only the device catalog and works without the project disk. It neither saves drafts nor closes mounted runtimes, because those operations require the missing disk and would block removal. Metadata refreshes retain the hidden flag; only an explicit successful open restores visibility. The folder, revisions, assets and in-memory drafts remain intact. Two copies with the same identity cannot be mounted together; copies are not synchronized or merged. A project lock prevents a second writer, but cannot coordinate independently copied directories on separate devices. Published role settings travel; installed tools and provider accounts may need configuration on the destination.

Focused folder tests cover migration, backups, missing paths and write ownership. The shared Session persistence contract runs against the project store, and a Loader/Agent-loop test continues the same conversation after copying only its project directory into a fresh Harness home. Browser expectations cover the folder creation and editing path. Physical removable-drive faults and cross-OS drive behavior require separate validation.
