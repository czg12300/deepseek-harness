# Agent Note: Novel documents own revisions and authors apply model proposals

Status: implemented

English | [中文](2026-09-19-novel-document-revisions.zh.md)

## Problem

Long novels need independent directories, document-level history and continuing conversations. Whole-book snapshots rewrite unrelated chapters, and an asynchronous model reply can overwrite edits made while it was running.

## Decision

Each novel stores its SQLite project data and JSONL Sessions in its own directory. The global index records directories and Session ownership. Chapters, outlines, characters and settings have independent immutable text revisions; ordering is separate from text versions.

Assistant tasks capture the document, revision, editable ranges and reference text. A scoped policy permits only the active task structured response and rejects messages from ordinary conversation entry points. Models cannot invoke manuscript mutation methods. Human application checks the base revision and commits a new text revision and proposal disposition in one SQLite transaction. Request IDs prevent duplicate application.

Novel Session routing reuses the JSONL provider in isolated service realms that receive the same Host Session events. Committed log generations are neither moved nor rewritten; ordinary Sessions keep their existing root.

## Alternatives considered

**Whole-project revisions.** Multica aggregate revisions serve its project-save semantics. Novel chapters are edited independently, so novels use independent revisions. Multica retains its own storage decision.

**Bidirectional manuscript files and database.** Two writable authorities require another conflict and recovery protocol. The project database owns manuscript text; importing a novel directory registers its location without guessing external text edits.

**Direct model saves.** They bypass the author comparison and may overwrite a newer revision. Structured proposals and human application have separate authority.

## Consequences

Save cost follows the current document length rather than the whole book. Chapter lists read an indexed metadata projection instead of parsing manuscript bodies. Suggestions based on stale revisions cannot apply automatically; authors retain local drafts and can request another suggestion. Offline, moved or duplicate project directories require explicit handling. The database and Session logs remain separate durable resources; model failures never roll back saved manuscript text.

Loader integration tests cover directories, conflicts, history, proposals and cancellation. Real Agent Loop tests cover recorded requests, tool denial and project-local logs. Browser component tests cover creation fields, target binding, comparisons and local draft retention.
