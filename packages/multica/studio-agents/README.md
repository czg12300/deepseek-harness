---
description: "Run scoped comic-writing assistants with durable Sessions, frozen role configurations and human-applied proposals."
kind: "package-reference"
---

# @deepseek-ai/dsh-studio-agents

English | [中文](README.zh.md)

## Summary

Request outline and script proposals from dedicated planner and writer Sessions. Each explicit task captures its target, role configuration, local draft, selected skills and approved references. Resume the same conversation after restart without changing its identity. Apply and approve content through separate human project operations. No media generation tools are exposed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

An explicit task model selection overrides the role default. The LLM runtime validates provider/model/effort before admission, and each request uses that task’s frozen selection, including later tasks in the same Session. The ordinary request header records the effective model and reasoning effort.

Outline workspaces add a page-specific instruction to the recorded system prompt, including for existing role configurations. Drafting and revision requests return complete outline text through structured changes, preserving unaffected passages; analysis-only requests return explanation without edits. The supplied local input is authoritative for the task, and the assistant must not claim that a proposal has already been applied.

-----

<a id="use-this-package"></a>
## Use this package

Portable projects mount a SQLite Session store under their own `sessions/` directory through the deployment persistence provider's `registerStore()` operation. The project service holds the directory's exclusive write lock. Published Session events append transactionally; headers and committed events are immutable. Ordinary conversations retain the deployment's JSONL backend. New portable professional Sessions omit an absolute `cwd`: their task objects and mounted project identity determine scope, so relocation does not rewrite history or reuse another device's path.

Closing a project drains its Agents before removing its Session route and closing SQLite. Legacy migration copies initialized logs through read/write handles while retaining the original storage. Project logs use no hard-link publication step. The shared persistence contract and a real Loader/loop test verify a conversation continued from a copied folder in a fresh home; physical removable-disk and cross-OS validation remain separate.

The Web bundle mounts this runtime after [studio-core](../studio-core/README.md). It requires Agent, preset, Session persistence, model routing, system prompt, tool and skill services. `dshHome` selects the Harness home; the default follows `DSH_HOME`, then `~/.dsh`. Working directories live under `multica/sessions`. Configure the text provider through the existing model and credential settings; secrets do not enter role records.

Only `startAssistant()` on the project service dispatches work. Opening pages and workspaces does not create Agents. The dedicated `multica` preset has no write tools. The runtime admits only its owned task message, the shared `structured_output` capture tool and explicitly selected read-only integrations. Role publication creates a separate conversation version; previous Sessions keep their original persona and effective dependencies.

Host integrations register individual read-only tools through `registerContextTool()` and own the returned asynchronous disposer. The `source` identifies a built-in or audited MCP operation; registering an MCP server does not expose its other tools. `studio_read_approved` reads only exact approved versions captured by the current task. Skills contribute frozen text, never permissions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The project database reserves Session IDs and owns tasks and proposals. This runtime creates or resumes the corresponding Agent, logs the complete captured input as ordinary user-message content, and installs task-local structured output. Permanent scoped guards block unowned chat input and inherited tools. Cancellation awaits actual task settlement. Missing previously initialized Session history fails explicitly instead of creating a replacement log.

No `./invariant` companion is published: the project service validates durable task ownership at dispatch, and all active Agent/tool registrations are owned by Cordis effects. [Runtime tests](tests/runtime.spec.ts) mount the real Loader, loop and Session persistence, scripting only the external model response.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Project service](../studio-core/README.md) — versions, task persistence and human review.
- [Professional workspace design](../../../multica/doc/agent-workspaces.md) — roles and production authorization.
- [Shared structured output](../../subagent/subagent-in-process-driver/README.md) — capture protocol.

-----

<a id="model-experience"></a>
## Model Experience

### Professional task input

#### What the model sees

The configured persona replaces the deployment persona. The system prompt also requires the Agent to work only on the frozen target and forbids approval, direct project edits and paid production. The ordinary user message contains the creator’s prompt plus JSON fields `taskId`, `target`, `baseRevision`, `roleRevision`, `input`, `selectedSkills` and `reviewReferences`; that same content is persisted in the Session.

#### Token effect

Each task repeats its complete selected project text and skill bodies. Conversation history accumulates within the fixed workspace; other roles’ conversations are not copied.

#### KV Cache effect

The role persona and capability prefix remain fixed within a workspace. New user messages append; publishing another role version creates a separate Session and prefix.

### Proposal and read-only results

#### What the model sees

The shared `structured_output` protocol accepts `{ reply, changes: [{ field, value }] }`, with field names restricted to the task target. A selected `studio_read_approved` call returns the immutable review and its text fields. Normal tool-result logging records success or errors; no apply, review-decision or production-authorization tool is registered.

#### Token effect

Tool schemas, proposed text and explicitly requested approved content contribute tokens. No model loop polls media jobs.

#### KV Cache effect

Result messages append to the existing Session. Tool selection is frozen before the workspace’s first dispatch.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The runtime currently serves text authoring.

- Only planner and writer execute. Other registered roles require their later production services.
- Dependency resolution validates model routing and registered capabilities. Provider authentication is ultimately checked by the actual provider request.
- Cross-process cancellation is unavailable. Interrupted tasks require an explicit new request; they are not automatically resubmitted.
- Skills and read-only MCP tools must be present in the host registry; no remote write or paid tool is enabled.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
