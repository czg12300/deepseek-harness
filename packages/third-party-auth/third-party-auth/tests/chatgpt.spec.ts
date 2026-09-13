import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { ThirdPartyAuth } from '../src/service.ts'
import { chatgptProvider } from '../src/chatgpt.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
const key = credentialKey('llm-pi-ai', 'openai-codex')
async function setup(providers: Record<string, object> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings, { doc: { 'llm-pi-ai': { providers } } })
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(ThirdPartyAuth, { connectTimeoutMs: 10_000, maxQueuedEvents: 32 })
  ctx.settings.register('llm-pi-ai', Schema.object({ providers: Schema.dict(Schema.object({
    displayName: Schema.string(), apiKeyEnv: Schema.string(), defaultMaxTokens: Schema.number().default(4096),
  })).default({}) }))
  ctx.authorization.registerFlow({ key, label: 'ChatGPT', methods: [{ id: 'oauth', label: 'Sign in' }],
    async run() { await ctx.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { test: true } })) },
  })
  const provider = chatgptProvider(ctx)
  return { ctx, provider }
}

describe('ChatGPT route ownership', () => {
  it('uses the existing authorization service and activates a new route', async () => {
    const { ctx, provider } = await setup()
    const signal = new AbortController().signal
    expect(await provider.connect({ signal, notify: () => {}, prompt: async () => '' })).toBe(true)
    await provider.activate(signal)
    expect(await provider.status(signal)).toEqual({ connected: true })
    expect(ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.user).toEqual({ providers: { 'openai-codex': {} } })
    expect(ctx.thirdPartyAuth.preferences.get().accounts.chatgpt?.managedRoute).toBe(true)
  })

  it('refuses a pre-existing route without overwriting it', async () => {
    const initial = { 'openai-codex': { displayName: 'My account' } }
    const { ctx, provider } = await setup(initial)
    const signal = new AbortController().signal
    expect(await provider.status(signal)).toMatchObject({ unavailable: 'route-conflict' })
    await expect(provider.activate(signal)).rejects.toThrow('independent configuration')
    expect(ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.user).toEqual({ providers: initial })
  })

  it('removes its raw empty route despite resolved schema defaults', async () => {
    const { ctx, provider } = await setup()
    await provider.activate(new AbortController().signal)
    await provider.deactivate()
    expect(ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.user).toEqual({ providers: {} })
    expect((await ctx.credentials.describeRecord(key)).configured).toBe(false)
  })

  it('preserves user customization made after connection', async () => {
    const { ctx, provider } = await setup()
    await provider.activate(new AbortController().signal)
    await ctx.settings.update('llm-pi-ai', { providers: { 'openai-codex': { displayName: 'Edited' } } })
    await provider.deactivate()
    expect(ctx.settings.describe().find(item => item.ns === 'llm-pi-ai')?.user)
      .toEqual({ providers: { 'openai-codex': { displayName: 'Edited' } } })
    expect(ctx.thirdPartyAuth.preferences.get().accounts.chatgpt?.managedRoute).toBe(false)
  })

  it('does not treat a pasted key record as subscription authorization', async () => {
    const { ctx, provider } = await setup()
    await ctx.credentials.modifyRecord(key, async () => ({ kind: 'api-key', key: 'fixture-key' }))
    expect(await provider.status(new AbortController().signal)).toEqual({ connected: false })
  })
})
