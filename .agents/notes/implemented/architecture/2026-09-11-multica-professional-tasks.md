# Agent Note: Professional tasks retain immutable targets and require human application

Status: implemented

English | [中文](2026-09-11-multica-professional-tasks.zh.md)

## Problem

A professional conversation can outlive the page that started it. Reusing one general chat across roles can move an in-flight result to another project, silently change its persona, expose inherited write tools or overwrite intervening manual edits.

## Decision

The [project service](../../../../packages/multica/studio-core/README.md) persists role revisions, target-bound workspaces, frozen task inputs, proposals and human reviews. A workspace reserves a dedicated Session ID before any Agent runs. Publishing a role configuration creates a new workspace version. Request IDs make uncertain transport retries idempotent; one workspace admits one running task.

The [professional runtime](../../../../packages/multica/studio-agents/README.md) logs each captured task as ordinary user-message content and reuses the shared structured-output capture protocol. Permanent Agent-scoped guards reject unrelated chat and inherited tools. The safe `multica` preset contains no write capabilities. Selected skills contribute text; trusted context tools can read only within the captured task scope.

Proposal application compares selected fields against both their local before-values and the immutable saved base, checks cross-scope locks, and appends a draft revision atomically. It never approves content. Review decisions name an exact saved target version and are available only through human operations. Creation forms have independent saved identities and publish a formal project exactly once. The creation page accepts a concept or source script without requiring production specifications or a name. It derives an omitted name when the user creates the project; saving an unfinished creation draft preserves its fields verbatim. Optional settings and the planner are collapsed so manual creation does not require assistant configuration.

This extends the [project revision decision](2026-09-10-multica-project-revisions.md) without moving project state into Session history. The database owns edits and review decisions; the Session owns the exact model-visible input and output.

## Alternatives considered

**Persona-only restrictions.** Instructions cannot prevent inherited tools from writing. Scoped registration, execution guards and separate human APIs enforce the supported operations.

**Apply model patches directly.** A late response may reference an older local draft even when its saved revision is unchanged. Immutable field comparisons preserve both local and persisted edits.

## Consequences

Each task stores the full selected text and repeats it in the Session, increasing storage and model input. Recovery never blindly resubmits interrupted work. A live task in another process cannot be cancelled here; uncertain process ownership remains visible. Schema-1 databases require a consistent backup before migration to schema 2.

Only planner and writer execution is enabled. Media authorization, assets, generation backends and continuity reports retain their own later-stage requirements; registering a role or MCP source does not grant those capabilities.
