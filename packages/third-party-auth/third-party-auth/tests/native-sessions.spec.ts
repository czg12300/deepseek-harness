import { Context } from '@deepseek-ai/cordis'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { ThirdPartyAuth } from '../src/service.ts'
import { ClaudeRuntime } from '../src/claude-runtime.ts'
import { NativeSessions } from '../src/native-sessions.ts'
import type { ClaudeTurnEvent } from '../src/types.ts'

const start = vi.hoisted(() => vi.fn())
vi.mock('../src/claude-sdk.ts', () => ({
  startNativeQuery: start,
  claudeModels: async () => [{ id: 'model-a', name: 'A' }, { id: 'model-b', name: 'B' }],
}))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks(); start.mockReset() })

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-native-turn-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(MemorySettings)
  await ctx.plugin(ThirdPartyAuth, { connectTimeoutMs: 10_000, maxQueuedEvents: 32 })
  await ctx.thirdPartyAuth.preferences.update({ accounts: { claude: { enabled: true } } })
  // Native account discovery is the external boundary; state and transcript storage stay real.
  vi.spyOn(ClaudeRuntime.prototype, 'status').mockResolvedValue({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })
  const native = new NativeSessions(ctx, { cwd, databasePath: ':memory:', graceMs: 1000,
    statusTimeoutMs: 5000, outputBytes: 65_536, turnTimeoutMs: 10_000, maxTurnEvents: 128 })
  const session = await native.create(cwd, 'model-a', new AbortController().signal)
  return { ctx, native, session }
}

async function drain(stream: AsyncIterable<ClaudeTurnEvent>) {
  const events: ClaudeTurnEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

describe('independent native conversations', () => {
  it('uses official resume with the mirrored transcript and fixes the model for each turn', async () => {
    const { native, session } = await setup()
    const calls: Options[] = []
    start.mockImplementation(async (_ctx: Context, _config: object, prompt: string, options: Options) => {
      calls.push(options)
      const store = options.sessionStore
      if (store === undefined) throw new Error('native query omitted its transcript mirror')
      const mirror = store
      async function* messages(): AsyncGenerator<SDKMessage> {
        await mirror.append({ projectKey: 'fixture', sessionId: session.id }, [
          { type: 'user', uuid: `user-${calls.length}`, message: { content: prompt } },
          { type: 'assistant', uuid: `assistant-${calls.length}`, message: { content: [{ type: 'text', text: 'Answer' }] } },
        ])
        yield JSON.parse('{"type":"result","subtype":"success","is_error":false}') as SDKMessage
      }
      return { query: messages() as Query, close: async () => {} }
    })
    expect((await drain(native.turn(session.id, 'First question', 'model-a', new AbortController().signal))).at(-1))
      .toEqual({ kind: 'completed', outcome: 'success' })
    await drain(native.turn(session.id, 'Follow up', 'model-b', new AbortController().signal))
    expect(calls[0]).toMatchObject({ sessionId: session.id, model: 'model-a', permissionMode: 'default' })
    expect(calls[0]?.resume).toBeUndefined()
    expect(calls[1]).toMatchObject({ resume: session.id, model: 'model-b' })
    expect(native.history(session.id)).toEqual([
      { role: 'user', text: 'First question' }, { role: 'assistant', text: 'Answer' },
      { role: 'user', text: 'Follow up' }, { role: 'assistant', text: 'Answer' },
    ])
  })

  it('denies native tool execution when the owning user refuses', async () => {
    const { native, session } = await setup()
    let permission: unknown
    start.mockImplementation(async (_ctx: Context, _config: object, _prompt: string, options: Options, signal: AbortSignal) => {
      async function* messages(): AsyncGenerator<SDKMessage> {
        if (options.canUseTool === undefined) throw new Error('native query omitted permissions')
        permission = await options.canUseTool('Write', { file_path: 'sample.txt' }, { signal, toolUseID: 'write-1', requestId: 'request-1' })
        yield JSON.parse('{"type":"result","subtype":"success","is_error":false}') as SDKMessage
      }
      return { query: messages() as Query, close: async () => {} }
    })
    let attempt
    for await (const event of native.turn(session.id, 'Write a file', 'model-a', new AbortController().signal)) {
      if (event.kind === 'started') attempt = event.attemptId
      if (event.kind === 'prompt') {
        if (attempt === undefined) throw new Error('prompt arrived before its capability')
        native.answer(attempt, event.id, 'deny')
      }
    }
    expect(permission).toEqual({ behavior: 'deny', message: 'The user denied this operation.' })
  })

  it('refuses unknown native models without starting a query', async () => {
    const { native, session } = await setup()
    const events = await drain(native.turn(session.id, 'Question', 'foreign', new AbortController().signal))
    expect(start).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ kind: 'completed', outcome: 'failed' })
  })

  it('acknowledges cancellation only after native cleanup finishes', async () => {
    const { native, session } = await setup()
    let started = (): void => {}
    let closing = (): void => {}
    let release = (): void => {}
    const ready = new Promise<void>((resolve) => { started = resolve })
    const cleanupStarted = new Promise<void>((resolve) => { closing = resolve })
    const cleanupDone = new Promise<void>((resolve) => { release = resolve })
    start.mockImplementation(async (_ctx: Context, _config: object, _text: string, _options: Options, signal: AbortSignal) => {
      started()
      async function* messages(): AsyncGenerator<SDKMessage> {
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      }
      return { query: messages() as Query, close: async () => { closing(); await cleanupDone } }
    })
    let attempt
    const events: ClaudeTurnEvent[] = []
    const reading = (async () => {
      for await (const event of native.turn(session.id, 'Question', 'model-a', new AbortController().signal)) {
        events.push(event)
        if (event.kind === 'started') attempt = event.attemptId
      }
    })()
    try {
      await ready
      if (attempt === undefined) throw new Error('native turn did not expose its capability')
      let acknowledged = false
      const cancelled = native.cancel(attempt).then(() => { acknowledged = true })
      await cleanupStarted
      expect(acknowledged).toBe(false)
      release()
      await cancelled
      await reading
      expect(events.at(-1)).toEqual({ kind: 'completed', outcome: 'cancelled' })
    } finally { release(); await native.stop(); await reading }
  })

  it('does not start native inference after the integration is disconnected', async () => {
    const { ctx, native, session } = await setup()
    await ctx.thirdPartyAuth.preferences.update({ accounts: { claude: { enabled: false } } })
    const events = await drain(native.turn(session.id, 'Question', 'model-a', new AbortController().signal))
    expect(start).not.toHaveBeenCalled()
    expect(events.at(-1)).toEqual({ kind: 'completed', outcome: 'failed' })
  })
})
