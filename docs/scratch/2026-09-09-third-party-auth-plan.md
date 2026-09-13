---
description: "Development plan for third-party authorization settings, covering ChatGPT sign-in, Claude Code connection, model selection, continuing sessions, and acceptance."
---

# Third-party authorization plugin development plan

English | [中文](2026-09-09-third-party-auth-plan.zh.md)

## Summary

This plan takes the approved Settings → Third-party authorization mockup as input and delivers account connection, status, and model selection for ChatGPT and Claude. API keys remain in the existing model settings. ChatGPT uses the existing pi-ai Codex route; Claude executes through official Claude Code, whose own flow manages sign-in. This is an implementation plan, not evidence that sign-in or continuing sessions have been validated.

Owner: Third-party authorization implementer. Created: 2026-09-09. Expires: 2026-10-09. Promotion target: Package READMEs, subsystem documentation, and an Agent Note during implementation; delete this temporary plan after completion.

## Implementation progress

Implementation is concentrated in three packages under `packages/third-party-auth/`: `third-party-auth` (Host and providers), `client-ui-third-party-auth` (settings and independent Claude window), and `third-party-auth-bundle` (composition). Existing business modules are unchanged; shared changes are compiler/dependency manifests, documentation indexes, and generated artifacts.

Build, Profile loading, the real Web settings page, and focused tests have been checked. Mocked SDK cases cover native continuation, model selection, denied permissions, and disconnection. The latest two real native-runtime probes pass; the earlier Node-child SIGKILL observations have no established cause. Real-account OAuth and inference remain unverified, so the complete feature is not accepted yet.

## Table of Contents

- [Scope and interaction](#scope)
- [Existing capabilities and gaps](#baseline)
- [Plugin responsibilities](#modules)
- [Code isolation and upstream synchronization](#isolation)
- [State and data obligations](#contracts)
- [Development tasks and order](#tasks)
- [Acceptance matrix](#acceptance)
- [Validation and delivery](#validation)
- [Dev Note](#dev-note)

<a id="scope"></a>
## Scope and interaction

Add a separate Third-party authorization settings section after Models and before Plugins. The settings shell uses the existing `settings.section` registration, and the page owns its copy and state; the entry does not return to the model cards. The first release connects one account per Provider, with reconnect and disconnect; account pools, shared quotas, and automatic rotation are out of scope.

| Page element | Intended behavior |
|---|---|
| ChatGPT card | Show connection status; sign in through an authorization link; then show available account information and model selection |
| Claude card | Show Claude Code runtime prerequisites and connection status; invoke official sign-in; then show model selection |
| Default model | Persist this Provider's default for new sessions; do not overwrite other Provider defaults or active requests |
| Session model selection | GPT uses the existing request route; Claude uses its session executor; changes within one executor apply on the next turn |
| Disconnect | Cancel authorization attempts owned by this page and prevent new use; retain history; distinguish disconnecting Harness from global native sign-out |
| Failure states | Show cancellation, timeout, expired authorization, missing runtime, unavailable models, and recovery actions |

Switching between GPT and Claude changes the executor and session context. In an existing session, the first release directs users to create a session for the other executor rather than silently converting context. Opening the page does not invoke model inference, request an API key, or assume that email, plan, and quota can be queried.

<a id="baseline"></a>
## Existing capabilities and gaps

These findings come from static inspection of the current source, without real-account authorization or model requests.

| Existing implementation | Reuse and gap |
|---|---|
| [pi-ai login bridge](../../packages/llm/llm-pi-ai/src/login.ts) and [credential adapter](../../packages/llm/llm-pi-ai/src/auth.ts) | Reuse ChatGPT OAuth, credential records, and refresh locking; the new plugin does not rewrite the protocol |
| [Authorization service](../../packages/credentials/authorization/README.md) | Reuse interaction, one-attempt-per-credential handling, and commit confirmation; it currently fits flows that write Harness credential records, so native Claude sign-in must not write a fake record to satisfy it |
| [Base composition](../../packages/bundle/base/cordis.patch.yml) | Credentials and pi-ai are mounted; the new installation layer must explicitly compose authorization, controllers, and UI |
| [Settings slots](../../packages/client/ui-settings/src/client/contract/slots.ts) | Add the page through `settings.section` without hardcoding GPT or Claude into the shell |
| [Model catalog](../../packages/api/session-controller/src/catalog.ts) | Currently builds from `ctx.llm`; adding a model name alone cannot connect the Claude Code executor |
| [Session model projection](../../packages/api/session-controller/src/model-selection-projection.ts) | Reuse recorded selection intent; executor identity and default precedence need explicit definitions |
| [Claude Code subagent plugin](../../packages/subagent/subagent-claude-code/README.md) | Reuse the pinned official runtime and process-management experience; it offers only one-shot tasks, static models, and final text, without login management, continuing sessions, or interactive approvals |
| [Agent factory](../../packages/core/agent/src/index.ts) | Currently registers one factory; independent Claude integration must verify whether existing lifecycle interfaces suffice, without assuming a global factory change or replacement |

<a id="modules"></a>
## Plugin responsibilities

The product feature is Third-party authorization; code uses `auth` / `authorization`, not `author`. New source, tests, assets, and package documentation stay under `packages/third-party-auth/`, following the existing two-level `packages/<group>/<package>/` workspace layout. These are proposed package locations, not existing packages; T1 finalizes packaging and avoids empty forwarding packages.

| Proposed location | Responsibility |
|---|---|
| `packages/third-party-auth/auth/` | Service Definition and orchestration: Provider registration, redacted connection views, connection enablement, model catalogs, and default selection; credentials remain in existing storage or the native client |
| `packages/third-party-auth/chatgpt/` | Provider: invoke existing pi-ai authorization, manage the plugin-owned Codex route, and read the supported model catalog |
| `packages/third-party-auth/claude-code/` | Provider and native runtime adapter: official sign-in, status and model discovery, continuing sessions, cancellation, approvals, and event projection without reading or storing Claude tokens |
| `packages/third-party-auth/controller/` | Consumer: the plugin's own Typert Remote namespace, authorization-attempt events, prompt answers, caller ownership, and error projection |
| `packages/third-party-auth/ui/` | Consumer: settings section, cards, authorization dialog, model selection, state store, and English/Chinese dictionaries; separate Host/Client compiler entry points under existing conventions |
| `packages/third-party-auth/bundle/` | Independent installation layer: compose Host, Client, Providers, and runtime dependencies; release registrations and active work on unload |

Claude sign-in and continuing sessions share a native runtime module inside this group's `claude-code` package, directly using the official SDK and existing public subprocess interfaces. The existing one-shot Claude subagent plugin is a behavior and testing reference only: do not move its files, extract its internals, or add a reverse dependency on this group; do not copy existing public process-management implementations either.

<a id="isolation"></a>
## Code isolation and upstream synchronization

Minimizing conflicts when rebasing onto master is an implementation constraint. Feature logic stays in new directories, with existing modules generally consumed as dependencies; the plugin owns its registrations, configuration, and state. Monkey patches, internal-path imports, or copies of entire existing modules are not acceptable ways to claim zero changes.

| Integration point | Default strategy |
|---|---|
| Settings navigation | Register `settings.section` from the new UI plugin without editing the settings shell or existing model page |
| Authorization and credentials | Call existing services; keep orchestration local without rewriting authorization, credentials, or pi-ai internals |
| API and state | Own Remote and settings namespaces and a client store rather than adding feature logic to existing settings/session controllers |
| Claude execution | Own the runtime and lifecycle adapter, verifying public interfaces first; no default agent-loop change, global factory replacement, or fake LLM route |
| Plugin activation | Add a bundle with its own `cordis.patch.yml`; retain existing base, web-app, and default preset files |
| Shared manifests | Add only required workspace resolution, dependency lock, type-index, and generated-catalog entries; do not reorder existing content or hand-edit generated output |
| Documentation and snapshots | Prefer ownership in the new group; update subsystem, architecture, and both SDKs where actual interface changes require it |

Dependencies point from new plugins to existing public services. The normal path adds no dependency from existing modules to third-party authorization. If a generic extension point is missing, T1 first records the specific unusable interface, minimum changed files, consumers, and necessity; commit that interface separately from feature implementation without GPT/Claude cases in it. If no low-intrusion path satisfies continuing sessions, report the conflict and alternatives rather than silently expanding a core refactor or removing functionality.

Keep required public extension points, independent plugin implementation, and shared-manifest/generated updates distinguishable in commits; related READMEs and Agent Notes accompany their logical changes, and the final PR remains complete and buildable. Each stage lists changes outside the new group and why they are required; exclude unrelated formatting, renaming, and existing-module moves. Before a needed rebase, inspect the working tree and remote state; regenerate lockfiles and derived catalogs through existing workflows instead of resolving conflicts by retaining entire old files.

<a id="contracts"></a>
## State and data obligations

Represent account authorization, Harness connection enablement, and model-catalog availability separately. If native sign-in succeeds but catalog discovery fails, show Connected, models failed to load rather than clearing authentication or pretending models are available.

| Data or operation | Obligation |
|---|---|
| Provider identity | Stable branded IDs; execution targets distinguish `llm-route` from `external-agent` explicitly rather than inferring from model names |
| Connection state | Disconnected, connecting, connected, reauthorization required, or prerequisites missing; errors include recovery actions and retain no secrets |
| Authorization attempt | Branded attempt ID, owner, and independent cancellation signal; notices and prompts reach only the initiator, without broadcasting authorization codes |
| Prompt answer | Validate attempt, prompt, owner, and lifetime; reject answers after termination; the client cannot declare successful sign-in |
| ChatGPT credential | Reuse `llm-pi-ai/openai-codex`; persist connection settings and credentials separately, explicitly reconciling partial success on startup |
| Claude sign-in | Owned by the official runtime, never copied into the Harness credential store; enable the connection only after native status confirms success |
| Model catalog | Distinguish built-in catalogs, native discovery, and verified callability; do not promise all account models without entitlement information |
| Default precedence | Existing explicit session selection wins; apply a Provider default only after selecting that Provider for a new session; otherwise retain the existing global default |
| Active request | Fix account connection, executor, and model at request start; selection changes apply next turn; authorization failure never falls back to another account or API key |
| Disconnect and reconnect | Disable the connection and invalidate unfinished sign-in results before cancelling plugin-related requests; delete GPT credentials under the refresh lock; leave other tools' native Claude sign-in intact |
| Persistence | Settings contain only non-secret preferences and connection intent; Session records model choices and executor-session facts; tokens, authorization codes, and temporary links never enter Session logs |

If users already configured an `openai-codex` route or an `apiKeyEnv` override, expose the conflict and a reviewable adjustment rather than overwriting configuration. If the first release cannot reliably distinguish plugin-owned routes, implementing ownership is mandatory in T2; disconnect must not delete the entire Provider configuration as a substitute.

<a id="tasks"></a>
## Development tasks and order

Complete T1 → T2 → T3 → T4 → T5 → T6 in dependency order. Both GPT and Claude must satisfy complete acceptance; a clickable sign-in button or a subagent returning text does not complete the feature.

### T1: Verify native capabilities and finalize executor design

Inspect the public entry points of the installed pi-ai and pinned Claude Agent SDK / CLI, and produce a minimal verification scenario launched through a `dsh` test Profile. Check ChatGPT sign-in, cancellation, and refresh; check native Claude sign-in status, official login launch, model discovery, two-turn continuation, stop, and resume. The user completes official real-account interaction without the implementation reading local credentials; missing accounts or permissions remain explicit unverified items while independent work continues.

Verify whether public Agent registration, lifecycle, and UI extension interfaces let this plugin own continuing Claude sessions while joining the existing experience; do not presume a global factory-dispatch change. First list the minimum changes outside the new group, distinguishing business source, shared manifests, documentation, and generated artifacts. Propose a separate generic extension only when a public interface is missing, identifying all consumers, Session events, and both SDK impacts. Do not disguise Claude Agent SDK as an `LlmAdapter`, which could execute tools twice through two loops.

Completion: identify official capabilities and pinned-version gaps, catalog provenance, browser-callback and runtime-Host placement, executor entry points, and recovery, and show that no business changes outside the new group are avoidable. If full Claude context or required resume events are unavailable, resolve the recording design in this task; final-text-only storage cannot be presented as satisfying Session reconstruction requirements.

### T2: Implement the authorization module and both Providers

Implement registration and redacted views; reuse existing ChatGPT authorization, activate its route after connection, persist default selection, and reconcile on restart. Implement native Claude prerequisites, sign-in launch, and status confirmation, separating the Harness connection switch from global native sign-out. Initially allow only local management clients with reliable ownership identification; callback forwarding for remote browsers is not implicit support.

Completion: define outcomes for authorized-but-route-activation-failed, duplicate clicks, late success after cancellation, refresh racing disconnect, plugin unload, and external native sign-out; no credential enters logs or return values. Add an executed invariant companion only where independent observations can diverge.

### T3: Implement Remote API and settings section

Expose proposed business operations `listProviders`, `beginConnect`, `answerPrompt`, `cancelConnect`, `disconnect`, `listModels`, and `setDefaultModel` through Typert Remote. These are proposed interfaces, not existing APIs. Carry authorization flows through existing streams constrained to the caller, without a new public callback server or generic token-read interface.

Implement the approved separate page for initially disconnected, connecting, connected, catalog failure, and reauthorization states. Generic cards render data while Providers determine connection guidance and button copy. Example email addresses and models must not become production defaults; display Account connected when email is unavailable. Confirm saved defaults immediately, and refresh other windows through invalidation events.

Completion: page reload or closure cancels its owned sign-in attempt; other clients cannot see or answer prompts; keyboard focus, cancellation, light/dark themes, and narrow screens work. The existing API-key page gains no fields and retains its behavior.

### T4: Connect model selection and continuing sessions

First complete ChatGPT through the existing `ctx.llm` route, catalog, and recorded-selection path. Then implement the Claude driver according to T1, covering new sessions, two-turn conversations, streamed text, native tool activity, approvals, user questions, stop, reopening, and model selection. The pinned runtime and native session identity have explicit lifetimes, with no unmanaged host-CLI fallback.

Claude native tools execute once in the Claude runtime. Map approvals and questions to existing Harness interaction capabilities rather than treating the one-shot plugin's deny-all behavior as completed interaction, and never enable `bypassPermissions` by default. Record actually observable model input, output, tool results, and configuration; resolve unobservable portions through T1's design rather than inventing reasoning content or claiming complete replay.

Completion: session catalogs distinguish execution targets; disconnect makes models unavailable and old sessions explicitly request reconnection; same-executor changes apply next turn; cross-executor changes direct users to a new session. New model-visible events update projections, replay, and TypeScript/Python SDK expected outputs; structural format changes use adjacent migrations and preserve predecessor files.

### T5: Composition, recovery, and distribution

Declare exports, Host/Client compiler entry points, resolver dependencies, and the Profile installation layer in the independent bundle without editing existing base/web-app compositions; activate plugins only through existing `dsh` launch paths. Verify real Web and Desktop carriers separately, without a new backend HTTP listener on Desktop; handle official OAuth's own loopback callback according to the actual runtime environment. Missing Claude platform payloads produce actionable prerequisite states, without silent downloads or version substitution.

Completion: installation adds the settings section; restart preserves connection intent and defaults; shutdown or unload releases streams, callbacks, processes, and registrations; uninstall retains history and global Claude sign-in. New connection attempts obey configured timeouts and disposal periods, with no unmanaged children.

### T6: Complete acceptance and documentation

Add meaningful behavior tests, keyless tests using the real runtime, authorized real-service acceptance, and recorded-session snapshots. Record verification per Provider; mock success is not account-entitlement evidence. Update affected READMEs, subsystem references, public JSDoc, and an Agent Note; factory or catalog extensions also update architecture and all consumers.

Completion: every case below has a result, with unverified real-account conditions explicitly identified; a PR with product-visible GUI changes includes a GIF recorded from the real server and model flow. Simulated authorization in the mockup is not that evidence.

<a id="acceptance"></a>
## Acceptance matrix

Each item covers success, refusal, and recovery where relevant to its responsibility. Concurrency tests use isolated directories, dynamic ports, and controlled synchronization rather than timing sleeps.

| Scenario | Required result |
|---|---|
| ChatGPT complete flow | Official sign-in → model loading → new session → streamed reply → tool call → follow-up conversation |
| Claude complete flow | Native sign-in → connection → model selection → new session → tools and approvals → follow-up → stop → reopen |
| Credentials and runtime | Expiry, user sign-out, missing/damaged runtime, and version mismatch have distinct diagnostics without incorrect fallback |
| Concurrent sign-in | Double-click starts once; clients cannot receive each other's prompts; late completion after closure, cancellation, or unload never reenables a connection |
| Settings consistency | Defaults survive restart, leave active requests unchanged, update other windows, and recover from configuration conflicts |
| Model permission | Empty catalogs, discovery failure, removed models, and permission errors have clear feedback; static catalogs are not entitlement proof |
| Data and security | Return values, Remote events, Session logs, diagnostics, and errors contain no tokens; only the initiator receives authorization prompts |
| Session persistence | Reopening preserves executor and selection, restores required native context, and never overwrites released Session generations |
| Regression | Existing API-key models, DeepSeek sessions, one-shot Claude subagents, and settings navigation pass focused checks |
| Isolation and synchronization | New business logic stays in the new group; no reverse dependencies or internal-path coupling; every external change is justified; existing Profiles boot after bundle removal |
| GUI | English/Chinese, light/dark themes, keyboard operation, and narrow layouts work; the real-flow GIF matches the delivered version |

<a id="validation"></a>
## Validation and delivery

This delivery contains only the plan. During implementation, use dsh-pre-push-checks to choose tests for the actual diff and dsh-ci-test-reliability for sign-in and subprocess tests; do not default to repository-wide tests or coverage. New packages require type checking, configuration parsing, source-launch verification, and built-artifact loading; Session changes add both SDKs and snapshots, while documentation runs pairing, link, and doc-sync checks.

The sequence permits validating and delivering the GPT phase first, but the complete feature includes continuing Claude sessions. T1 runtime evidence determines official dependency upgrades or minimum public extension points; global Agent factory changes are not the default. Until those results exist, do not estimate the feature as settings-page work alone or promise conflict-free future rebases.

<a id="dev-note"></a>
## Dev Note

Pre-implementation checks: whether the pinned official Claude runtime exposes safe login/status calls; whether discovery represents account entitlements; Claude model changes, native Session resume, and model-input observability; account ownership and callback reachability across Hosts. T1 resolves each question with executed evidence and a selected design, never fake data or hidden degradation.

External references: [OpenAI authentication](https://learn.chatgpt.com/docs/auth), [Claude authentication and integration rules](https://code.claude.com/docs/en/legal-and-compliance), and [Claude Agent SDK subscription guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Earlier research opened these official pages; recheck before integration, and do not equate a third-party library's OAuth implementation with official authorization for third-party applications.
