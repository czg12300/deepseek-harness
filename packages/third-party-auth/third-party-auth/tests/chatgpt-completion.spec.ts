import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, expect, it, vi } from 'vitest'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { catalogProvider } from '../../../llm/llm-pi-ai/src/catalog.ts'
import { ThirdPartyAuth } from '../src/service.ts'
import { chatgptProvider } from '../src/chatgpt.ts'
import type { ConnectEvent } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  vi.restoreAllMocks()
})

it('settles a browser callback and enables the real Codex model route', async () => {
  const oauth = catalogProvider('openai-codex')?.auth.oauth
  if (oauth === undefined) throw new Error('missing Codex OAuth provider')
  vi.spyOn(oauth, 'login').mockImplementation(async (interaction) => {
    const manual = new AbortController()
    const pending = interaction.prompt({ type: 'manual_code', message: 'Paste callback URL', signal: manual.signal })
    const withdrawn = expect(pending).rejects.toThrow('withdrawn')
    manual.abort()
    await withdrawn
    return { type: 'oauth', access: 'fixture-access', refresh: 'fixture-refresh', expires: 1, accountId: 'fixture-account' }
  })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, { providers: {} })
  await ctx.plugin(ThirdPartyAuth, { connectTimeoutMs: 10_000, maxQueuedEvents: 32 })
  ctx.thirdPartyAuth.register(chatgptProvider(ctx))
  const events: ConnectEvent[] = []
  const signal = new AbortController().signal
  for await (const event of ctx.thirdPartyAuth.connect('chatgpt', signal)) events.push(event)
  expect(events.at(-1)).toEqual({ kind: 'settled', status: 'connected' })
  const [account] = await ctx.thirdPartyAuth.list(signal)
  expect(account).toMatchObject({ connected: true, enabled: true, connecting: false, catalogFailed: false })
  expect(account?.models.length).toBeGreaterThan(0)
})
