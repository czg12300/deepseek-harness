import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { ThirdPartyAuth } from '../src/service.ts'
import type { AccountProvider, ConnectEvent } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(overrides: Partial<AccountProvider> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(ThirdPartyAuth, { connectTimeoutMs: 10_000, maxQueuedEvents: 32 })
  const provider: AccountProvider = {
    id: 'chatgpt', status: async () => ({ connected: true }),
    models: async () => [{ id: 'test-model', name: 'Test model' }],
    connect: async () => true, activate: async () => {}, deactivate: async () => {}, ...overrides,
  }
  const dispose = ctx.thirdPartyAuth.register(provider)
  return { ctx, service: ctx.thirdPartyAuth, dispose }
}

async function drain(stream: AsyncIterable<ConnectEvent>): Promise<ConnectEvent[]> {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

describe('account connection lifecycle', () => {
  it('publishes only refresh markers to a separate page and closes the subscription on cancellation', async () => {
    const { service } = await setup()
    const controller = new AbortController()
    const changes = service.changes(controller.signal)[Symbol.asyncIterator]()
    expect(await changes.next()).toEqual({ value: 0, done: false })
    const next = changes.next()
    await service.preferences.update({ accounts: { chatgpt: { enabled: false } } })
    expect(await next).toEqual({ value: 0, done: false })
    controller.abort()
    expect((await changes.next()).done).toBe(true)
  })

  it('activates a route before publishing a committed connection and persists its default', async () => {
    const order: string[] = []
    const { ctx, service } = await setup({ activate: async () => { order.push('activated') } })
    const result = await drain(service.connect('chatgpt', new AbortController().signal))
    expect(order).toEqual(['activated'])
    expect(result.at(-1)).toEqual({ kind: 'settled', status: 'connected' })
    await service.selectModel('chatgpt', 'test-model', new AbortController().signal)
    expect(ctx.settings.get('third-party-auth')).toEqual({ accounts: { chatgpt: { enabled: true, model: 'test-model' } } })
    expect((await service.list(new AbortController().signal))[0]).toMatchObject({ enabled: true, connecting: false })
  })

  it('keeps a successful native authorization disconnected when route activation fails', async () => {
    const { service } = await setup({ activate: async () => { throw new Error('secret failure payload') } })
    const result = await drain(service.connect('chatgpt', new AbortController().signal))
    expect(result.at(-1)).toEqual({ kind: 'settled', status: 'failed', reason: 'activation' })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(service.preferences.get().accounts.chatgpt).toBeUndefined()
  })

  it('does not activate a late login after the originating caller cancels', async () => {
    let complete = (_value: boolean): void => {}
    const login = new Promise<boolean>((resolve) => { complete = resolve })
    let activated = false
    const { service } = await setup({ connect: () => login, activate: async () => { activated = true } })
    const controller = new AbortController()
    const stream = service.connect('chatgpt', controller.signal)
    expect((await stream[Symbol.asyncIterator]().next()).value?.kind).toBe('started')
    controller.abort()
    complete(true)
    expect((await drain(stream)).at(-1)).toEqual({ kind: 'settled', status: 'cancelled' })
    expect(activated).toBe(false)
    expect(service.preferences.get().accounts.chatgpt).toBeUndefined()
  })

  it('reports authorization failure without exposing upstream response text', async () => {
    const { service } = await setup({ connect: async () => { throw new Error('private-token-response') } })
    const events = await drain(service.connect('chatgpt', new AbortController().signal))
    expect(events.at(-1)).toEqual({ kind: 'settled', status: 'failed', reason: 'authorization' })
    expect(JSON.stringify(events)).not.toContain('private-token-response')
  })

  it('distinguishes the login deadline from user cancellation', async () => {
    const { service } = await setup({ connect: interaction => new Promise((resolve) => {
      interaction.signal.addEventListener('abort', () => { resolve(false) }, { once: true })
    }) })
    vi.useFakeTimers()
    try {
      const stream = service.connect('chatgpt', new AbortController().signal)
      await stream[Symbol.asyncIterator]().next()
      const result = drain(stream)
      await vi.advanceTimersByTimeAsync(10_000)
      expect((await result).at(-1)).toEqual({ kind: 'settled', status: 'failed', reason: 'timeout' })
    } finally { vi.useRealTimers() }
  })

  it('refuses a second login while the first owns the provider', async () => {
    const { service } = await setup({ connect: interaction => new Promise((resolve) => {
      interaction.signal.addEventListener('abort', () => resolve(false), { once: true })
    }) })
    const controller = new AbortController()
    const first = service.connect('chatgpt', controller.signal)
    await first[Symbol.asyncIterator]().next()
    await expect(drain(service.connect('chatgpt', new AbortController().signal))).rejects.toThrow('already running')
    controller.abort()
    await drain(first)
  })

  it('retains authentication when the model catalog fails', async () => {
    const { service } = await setup({ models: async () => { throw new Error('catalog error') } })
    await drain(service.connect('chatgpt', new AbortController().signal))
    expect((await service.list(new AbortController().signal))[0]).toMatchObject({ connected: true, enabled: true, catalogFailed: true })
  })

  it('rejects a model that discovery did not report', async () => {
    const { service } = await setup()
    await drain(service.connect('chatgpt', new AbortController().signal))
    await expect(service.selectModel('chatgpt', 'foreign', new AbortController().signal)).rejects.toThrow('unavailable')
    expect(service.preferences.get().accounts.chatgpt?.model).toBeUndefined()
  })

  it('disables account use before deactivation and preserves the chosen model', async () => {
    const { service } = await setup()
    await drain(service.connect('chatgpt', new AbortController().signal))
    await service.selectModel('chatgpt', 'test-model', new AbortController().signal)
    await service.disconnect('chatgpt')
    expect(service.preferences.get().accounts.chatgpt).toEqual({ enabled: false, model: 'test-model' })
    await expect(service.selectModel('chatgpt', 'test-model', new AbortController().signal)).rejects.toThrow('not connected')
  })

  it('withdraws a provider registration on disposal', async () => {
    const { service, dispose } = await setup()
    await dispose()
    expect(await service.list(new AbortController().signal)).toEqual([])
    await expect(drain(service.connect('chatgpt', new AbortController().signal))).rejects.toThrow('not installed')
  })
})
