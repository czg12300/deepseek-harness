# Agent Note: Multica project revisions belong to the project database

Status: implemented

English | [中文](2026-09-10-multica-project-revisions.zh.md)

## Problem

A creator needs to reopen project specifications, outlines and episode drafts without depending on an agent conversation. Concurrent editors can otherwise overwrite each other's work, and restoring old content can erase the evidence needed to understand a later production result.

## Decision

Multica stores each project as a stable identity with immutable aggregate revisions in SQLite. A revision contains the project specifications, outline and episode drafts. Saves compare the caller's expected revision inside the write transaction. Conflicts return the current project without writing; the browser retains the local draft for reconciliation. Archive state is versioned and enforced by the host service. Restoring historical content creates a new revision.

The [project service](../../../../packages/multica/studio-core/README.md) owns the database and exposes typed Remote operations. The [browser workspace](../../../../packages/client/ui-multica/README.md) contributes a global main panel and the left-sidebar entry “漫剧” through the existing slot registry. The Web profile mounts both through its ordinary bundle. Creating, opening and editing projects do not create Sessions or make model requests.

Project data and Session data retain separate authorities. Future agent integrations must record the exact project snapshot admitted to a model request in that Session; reading the latest database contents at replay time cannot reconstruct what the model saw. The existing [model-visible logging rule](../../../../docs/architecture.md) remains authoritative.

## Alternatives considered

**Browser-only storage.** It cannot make the host authoritative for archive state and concurrent saves, and a browser-origin change can make saved work inaccessible. SQLite provides durable transactions independently of the browser.

**Derive projects from conversations.** A project exists before its first conversation and can be edited manually. Conversation history cannot own those independent edits without making ordinary project management create artificial model work.

**Separate version tables for every future production object.** Assets, approvals and generation tasks need independent identities when those capabilities arrive. The project foundation has only specifications and text drafts, so one aggregate keeps a save atomic without implementing unvalidated later-stage relations.

## Consequences

An aggregate revision costs storage proportional to the project's text and causes conflicts even when two editors change different episodes. It gives the initial local workspace one consistent restore point and keeps history independent of browser state. Large production assets and finer-grained editing need their own version owners before media production is enabled.

The foundation mounts no professional agents, exposes no paid production action, and reports unavailable assistants explicitly. Project isolation here separates stored records; it does not introduce a multi-user authorization system.
