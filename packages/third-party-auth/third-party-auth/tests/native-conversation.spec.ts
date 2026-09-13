import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { startMessagesFixture, type MessagesBehavior } from '../../../subagent/subagent-claude-code/tests/messages-fixture.ts'
import { ThirdPartyAuth } from '../src/service.ts'
import { NativeSessions } from '../src/native-sessions.ts'
import { claudeExecutable } from '../src/claude-runtime.ts'
import { claudeModels } from '../src/claude-sdk.ts'
import type { AttemptId, ClaudeTurnEvent } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() }, 15_000)

async function setup(behavior: MessagesBehavior | ((root: string) => MessagesBehavior)) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-native-conversation-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  const nativeConfigDir = join(root, 'claude')
  await mkdir(cwd); await mkdir(nativeConfigDir)
  const fixture = await startMessagesFixture(typeof behavior === 'function' ? behavior(root) : behavior)
  cleanups.push(() => fixture.close())
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(ThirdPartyAuth, { connectTimeoutMs: 30_000, maxQueuedEvents: 64 })
  await ctx.thirdPartyAuth.preferences.update({ accounts: { claude: { enabled: true } } })
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  // Only native network/auth inputs are replaced. The SDK, CLI, process owner, and mirror remain real.
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn({ ...spec, env: { ...spec.env,
    ANTHROPIC_API_KEY: 'local-fixture-key', ANTHROPIC_BASE_URL: fixture.baseUrl,
    ANTHROPIC_MODEL: undefined, ANTHROPIC_SMALL_FAST_MODEL: undefined,
    CLAUDE_CONFIG_DIR: nativeConfigDir, XDG_CONFIG_HOME: root,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost',
  } }))
  const config = { cwd, nativeConfigDir, databasePath: join(root, 'native.db'),
    graceMs: 3000, statusTimeoutMs: 30_000, outputBytes: 65_536, turnTimeoutMs: 60_000, maxTurnEvents: 2048 }
  const native = new NativeSessions(ctx, config)
  const models = await claudeModels(ctx, config, new AbortController().signal)
  const model = models.find(item => item.id === 'sonnet') ?? models[0]
  if (model === undefined) throw new Error('native runtime offered no models')
  const session = await native.create(cwd, model.id, new AbortController().signal)
  expect(fixture.requests).toHaveLength(0)
  return { root, ctx, native, config, fixture, model: model.id, session }
}

async function drain(stream: AsyncIterable<ClaudeTurnEvent>): Promise<ClaudeTurnEvent[]> {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

describe.skipIf(claudeExecutable() === undefined)('real native SDK conversations with local Messages', () => {
  it('streams a reply and resumes the official mirrored history for a second turn', async () => {
    const { native, fixture, model, session } = await setup({ kind: 'complete', text: 'NATIVE_FIXTURE_REPLY' })
    const first = await drain(native.turn(session.id, 'First native fixture question', model, new AbortController().signal))
    expect(first.at(-1)).toEqual({ kind: 'completed', outcome: 'success' })
    expect(first.filter(event => event.kind === 'text').map(event => event.text).join('')).toBe('NATIVE_FIXTURE_REPLY')
    expect(native.history(session.id).some(message => message.text === 'NATIVE_FIXTURE_REPLY')).toBe(true)
    const second = await drain(native.turn(session.id, 'Second native fixture question', model, new AbortController().signal))
    expect(second.at(-1)).toEqual({ kind: 'completed', outcome: 'success' })
    const history = JSON.stringify(fixture.requests.at(-1)?.body.messages)
    expect(history).toContain('First native fixture question')
    expect(history).toContain('NATIVE_FIXTURE_REPLY')
    expect(history).toContain('Second native fixture question')
  }, 75_000)

  it('honors a denied native Write and leaves the target absent', async () => {
    const { root, native, model, session } = await setup(root => ({ kind: 'tool-use', toolName: 'Write',
      input: { file_path: join(root, 'outside.txt'), content: 'must not be written' }, finalText: 'DENIAL_OBSERVED' }))
    let attempt: AttemptId | undefined
    let permissions = 0
    for await (const event of native.turn(session.id, 'Write the requested fixture file', model, new AbortController().signal)) {
      if (event.kind === 'started') attempt = event.attemptId
      if (event.kind === 'prompt') {
        if (attempt === undefined) throw new Error('permission arrived without its private capability')
        permissions++
        native.answer(attempt, event.id, 'deny')
      }
    }
    expect(permissions).toBeGreaterThan(0)
    await expect(stat(join(root, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 75_000)

  it('stops an actual native request and releases its turn before cancellation returns', async () => {
    const { native, fixture, model, session } = await setup({ kind: 'hold' })
    let attempt: AttemptId | undefined
    const events: ClaudeTurnEvent[] = []
    const reading = (async () => {
      for await (const event of native.turn(session.id, 'Hold this fixture request', model, new AbortController().signal)) {
        events.push(event)
        if (event.kind === 'started') attempt = event.attemptId
      }
    })()
    await fixture.requestStarted
    if (attempt === undefined) throw new Error('native request started without its private capability')
    await native.cancel(attempt)
    await reading
    expect(events.at(-1)).toEqual({ kind: 'completed', outcome: 'cancelled' })
  }, 75_000)
})
