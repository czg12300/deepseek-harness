# Agent Note: Project scripts and production share a portable project folder

Status: implemented

English | [中文](2026-09-24-multica-project-workspace.zh.md)

## Problem

The project editor stored the outline and episode scripts as project revisions but exposed no document directory or place to organize production output. A project copied to another device needs its script files, production arrangement and media together, while the device catalog remains independent.

## Decision

Folder-backed projects mirror saved outline, character biography and episode scripts as Markdown in `scripts/`. Project SQLite schema 5 indexes those documents and stores an explicit script-completion digest, episode or whole-film production units, positioned canvas nodes, and imported media references. The media bytes reside in `artifacts/` in the same project folder. The UI selects a script, canvas or asset catalog from one left directory and keeps the existing right assistant only for scripts; production uses a floating composer on the canvas.

Script completion requires a saved nonempty outline and at least one saved nonempty episode script. Changing the script invalidates the digest and prevents creation of new production units until reconfirmed. Existing units and media remain readable. The planner and writer can provide text suggestions, which enter a canvas only after the user adds them; they cannot generate image, video or audio files through this feature.

## Alternatives considered

**Store production only in the device catalog.** A copied project would lose its canvas and media index, violating the portable folder model.

**Treat project save or content approval as production authorization.** A save may be incomplete, while review decides a specific content version. Explicit script confirmation keeps production readiness separate from both operations.

**Render a fixed assistant sidebar in every stage.** The canvas and media grid need the available width. Script reading retains the sidebar; production keeps a compact composer beside its nodes.

## Consequences

Schema migration backs up the database before adding the project-content tables. Script Markdown is a human-readable mirror of saved project content; project revisions remain authoritative for outline and episodes. Imported files are limited to 16 MiB each and remain in the project folder. Model-driven media generation, timeline editing and final video export remain separate capabilities.

## Testing

Host tests cover schema migration, Markdown files, script invalidation, production units, canvas revisions, media import and reopening a folder. A keyless Web test creates a project, edits scripts, confirms them, creates a unit, imports media, previews it and reloads the workspace.
