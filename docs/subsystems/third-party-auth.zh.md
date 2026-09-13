# 三方账号

[English](third-party-auth.md) | 中文

[账号模块组](../../packages/third-party-auth/README.zh.md)负责可选账号连接状态与原生 Claude 会话，使用已有凭证、授权、设置、subprocess 和客户端插槽接口。

## Connection state

认证、集成启用和模型目录可用性是独立事实。私有授权流包含尝试能力标识及提示 ID，回复需要同时提供两者。设置仅持久化非秘密偏好。GPT 授权保留在 pi-ai 记录中，未修改的 Claude CLI 管理自己的配置目录。

## Native conversations

原生会话 ID 属于可选插件，不属于默认 Harness Agent 工厂。SQLite 数据域镜像原生 SDK 会话记录，并保留子任务流以供官方恢复。显示文本是该镜像的投影，不是已发布 Harness Session 格式的转换。关闭原生流会取消当前轮次，并等待受管进程清理。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxthirdpartyauth--thirdpartyauth"></a>

### `ctx.thirdPartyAuth` — `ThirdPartyAuth`

Own account registration, preferences, and cancellable connection attempts.

```ts cordis-catalog
/**
 * Follow coalesced account invalidations without disclosing prompts or credentials.
 * @param signal - subscribing page lifetime.
 * @returns an initial readiness marker and subsequent refresh markers.
 */
async *changes(signal: AbortSignal): AsyncIterable<number>

/**
 * Contribute one account provider until its plugin unloads.
 * @param provider - owner of native login and routing.
 * @returns asynchronous disposer that waits for its login to stop.
 */
register(provider: AccountProvider): () => Promise<void>

/**
 * Describe authentication and catalog failures independently.
 * @param signal - cancellation of this read.
 * @returns secret-free provider cards.
 */
async list(signal: AbortSignal): Promise<AccountView[]>

/**
 * Stream one private authorization conversation and enable only its committed result.
 * @param id - installed account provider.
 * @param signal - originating stream lifetime.
 * @returns notices, prompts, and terminal outcome.
 */
async *connect(id: ProviderId, signal: AbortSignal): AsyncIterable<ConnectEvent>

/**
 * Reply through the capability delivered on the initiating stream.
 * @param attemptId - unguessable live attempt capability.
 * @param promptId - prompt carried by that attempt.
 * @param answer - user's answer; never persisted.
 */
answer(attemptId: AttemptId, promptId: PromptId, answer: string): void

/**
 * Disable this integration without signing out other native clients.
 * @param id - account to disconnect.
 */
async disconnect(id: ProviderId): Promise<void>

/**
 * Save a discovered model for future sessions of this provider.
 * @param id - connected provider.
 * @param model - exact catalog model id.
 * @param signal - cancellation of model discovery.
 */
async selectModel(id: ProviderId, model: string, signal: AbortSignal): Promise<void>
```

Source: [`packages/third-party-auth/third-party-auth/src/service.ts`](../../packages/third-party-auth/third-party-auth/src/service.ts)

<a id="ctxthirdpartyauthcontroller--accountcontroller"></a>

### `ctx.thirdPartyAuthController` — `AccountController`

Transport consumer for the optional account service.

```ts cordis-catalog
/**
 * Read account cards without exposing credentials.
 * @param signal - caller cancellation.
 * @returns provider status and discovered models.
 */
@Remote list(signal: AbortSignal): Promise<AccountView[]>

/**
 * Watch account invalidations independently of private authorization streams.
 * @param signal - page subscription lifetime.
 * @returns coalesced markers requesting a fresh account read.
 */
@Remote({ mode: 'stream' }) changes(signal: AbortSignal): AsyncIterable<number>

/**
 * Start a private login stream; closing it cancels its attempt.
 * @param id - account provider.
 * @param signal - stream lifetime.
 * @returns scoped authorization notices, prompts, and settlement.
 */
@Remote({ mode: 'stream' }) connect(id: ProviderId, signal: AbortSignal): AsyncIterable<ConnectEvent>

/**
 * Submit an answer using the capability from the originating stream.
 * @param attemptId - opaque attempt capability.
 * @param promptId - pending prompt identity.
 * @param answer - user input, never returned or persisted.
 */
@Remote answer(attemptId: AttemptId, promptId: PromptId, answer: string): void

/**
 * Disconnect only this integration's account use.
 * @param id - connected account provider.
 */
@Remote async disconnect(id: ProviderId): Promise<void>

/**
 * Save one provider's default for future sessions.
 * @param id - connected provider.
 * @param model - discovered model id.
 * @param signal - caller cancellation.
 */
@Remote selectModel(id: ProviderId, model: string, signal: AbortSignal): Promise<void>

/** List native conversations in this integration.
 * @returns persisted conversation metadata.
 */
@Remote claudeList(): ClaudeSessionView[]

/**
 * Allocate a native conversation in a user-selected workspace.
 * @param cwd - absolute workspace directory.
 * @param model - discovered native model.
 * @param signal - caller cancellation.
 * @returns native conversation metadata.
 */
@Remote claudeCreate(cwd: string, model: string, signal: AbortSignal): Promise<ClaudeSessionView>

/**
 * Read displayed text from a native transcript.
 * @param id - conversation owned by the native workspace.
 * @returns native user and assistant text.
 */
@Remote claudeHistory(id: ClaudeSessionId): ClaudeMessage[]

/**
 * Run a native turn without entering the default Harness Agent factory.
 * @param id - native conversation.
 * @param text - next user message.
 * @param model - model fixed for this turn.
 * @param signal - originating stream cancellation.
 * @returns text, tool activity, and private approval events.
 */
@Remote({ mode: 'stream' }) claudeTurn(id: ClaudeSessionId, text: string, model: string, signal: AbortSignal): AsyncIterable<ClaudeTurnEvent>

/**
 * Answer one native turn's approval prompt.
 * @param attempt - private stream capability.
 * @param prompt - pending prompt identity.
 * @param answer - user's response.
 */
@Remote claudeAnswer(attempt: AttemptId, prompt: PromptId, answer: string): void

/**
 * Stop an owned native turn and acknowledge after managed-process cleanup.
 * @param attempt - private turn capability.
 */
@Remote claudeCancel(attempt: AttemptId): Promise<void>
```

Source: [`packages/third-party-auth/third-party-auth/src/controller.ts`](../../packages/third-party-auth/third-party-auth/src/controller.ts)

<a id="ctxthirdpartyclaude--nativesessions"></a>

### `ctx.thirdPartyClaude` — `NativeSessions`

Own native turns, transcript storage, and private approval interactions.

```ts cordis-catalog
/** List this integration's native conversations.
 * @returns plugin-owned native conversations, without scanning other Claude sessions.
 */
list(): ClaudeSessionView[]

/**
 * Create a conversation in the workspace the user selected.
 * @param cwd - absolute existing workspace directory.
 * @param model - native catalog model.
 * @param signal - caller cancellation.
 * @returns persisted native session metadata.
 */
async create(cwd: string, model: string, signal: AbortSignal): Promise<ClaudeSessionView>

/**
 * Project readable text from the native mirror, preserving raw records for official resume.
 * @param id - plugin-owned native conversation.
 * @returns user and assistant text from the native main transcript.
 */
history(id: ClaudeSessionId): ClaudeMessage[]

/**
 * Run a turn using official native resume and stream its output and approval questions.
 * @param id - plugin-owned native conversation.
 * @param text - the user's next message.
 * @param model - model fixed for this turn.
 * @param signal - initiating stream lifetime.
 * @returns output and private approval events until the native process exits.
 */
async *turn(id: ClaudeSessionId, text: string, model: string, signal: AbortSignal): AsyncIterable<ClaudeTurnEvent>

/**
 * Answer a pending native approval or question from its owning stream.
 * @param attempt - private turn capability.
 * @param prompt - pending question identity.
 * @param answer - user response.
 */
answer(attempt: AttemptId, prompt: PromptId, answer: string): void

/**
 * Stop the turn owned by one private stream and wait for native process cleanup.
 * @param attempt - capability delivered to the turn's initiating client.
 */
async cancel(attempt: AttemptId): Promise<void>

/** Stop all plugin-owned native turns before disconnecting this integration. */
async stop(): Promise<void>
```

Source: [`packages/third-party-auth/third-party-auth/src/native-sessions.ts`](../../packages/third-party-auth/third-party-auth/src/native-sessions.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

最新的原生账号和模型探测已通过。早期 SIGKILL 观察记录在 Host 包开发备注中。真实 SDK 会话夹具仍遇到启动 SIGKILL。单元夹具不能验证真实订阅授权和推理。
