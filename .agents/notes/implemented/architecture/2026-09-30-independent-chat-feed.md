# Agent Note: Independent Chat Feed fork

Status: implemented

English | [中文](2026-09-30-independent-chat-feed.zh.md)

## Problem

Main Chat upstream synchronization and Multica embedded conversations need independent evolution; changing the shared main interface increases merge conflicts.

## Decision

`ui-chat-feed` copies message presentation from `ui-chat`, tool presentation from `ui-tool`, and the required conversation assembly code at commit `98475343dfb95a7635f7a1c8f58a08427d2f160d`. Independent registries, dictionaries and slots let it coexist with main Chat. Session transport and UI primitives remain shared infrastructure; the feed never changes the global current Session.

The `chat-feed-contract` type library lets Multica declare the slot without depending on the renderer; this avoids a cycle through the existing Conversation dependency on Multica composer types. Each dialogue binds an independent Session, with configuration revision as a dialogue attribute. One target and role revision can have several workspaces. SQLite schema 6 appends each existing workspace ID to its binding key, retaining workspace, task, proposal and Session identities.

## Alternatives considered

Extracting a shared view directly from main Chat couples local customization to upstream synchronization. Copying only React chrome retains global Session-selection and message-registry coupling. Rewriting message rendering loses established streaming and pagination behavior.

## Consequences

The fork requires deliberate uptake of upstream fixes. Clone detection excludes only this plugin directory; other code remains checked. Hosts own the conversation list, composer, submission, cancellation and proposal application. The existing [professional task policy](2026-09-11-multica-professional-tasks.md) continues to govern role versions, frozen inputs and human application.
