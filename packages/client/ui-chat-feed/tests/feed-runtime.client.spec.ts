/** Session readers are independent of the main Chat selection and close before reopening. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionEventStreamOptions } from '@deepseek-ai/dsh-api-session-controller/client'
import { inspectRequestPrompt } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { inspectSystemPrompt } from '../../ui-conversation/src/client/contract/system-prompt.ts'

const transport = { instances: [] as Array<{
  id: string
  options: SessionEventStreamOptions
  open: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}> }
class TestStream {
  readonly open = vi.fn(async () => {})
  readonly dispose = vi.fn(async () => {})
  readonly prepend = vi.fn(async () => {})
  readonly restart = vi.fn()
  constructor(id: string, options: SessionEventStreamOptions) {
    transport.instances.push({ id, options, open: this.open, dispose: this.dispose })
  }
}
import { FeedRuntime } from '../src/client/feed-runtime.ts'

const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  transport.instances.length = 0
})

function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('uiConversation', { inspectSystemPrompt, inspectRequestPrompt } as never)
  ctx.provide('chatFeedTransport', { reader: (id: SessionId, options: SessionEventStreamOptions) => new TestStream(id, options) } as never)
  const runtime = new FeedRuntime(ctx, 50)
  return runtime
}

async function flush() { await Promise.resolve(); await Promise.resolve() }

describe('independently addressed transcript readers', () => {
  it('opens only retained Session IDs and shares a stream until its last reader releases', async () => {
    const runtime = fixture()
    const id = 'feed-one' as SessionId
    runtime.source(id)
    expect(transport.instances).toHaveLength(0)
    const releaseA = runtime.retain(id)
    const releaseB = runtime.retain(id)
    await flush()
    expect(transport.instances.map(value => value.id)).toEqual([id])
    const stream = transport.instances[0]!
    expect(stream.open).toHaveBeenCalledWith({ maxMessages: 50 })
    releaseA()
    await flush()
    expect(stream.dispose).not.toHaveBeenCalled()
    releaseB()
    releaseB()
    await flush()
    expect(stream.dispose).toHaveBeenCalledTimes(1)
  })

  it('ignores a released stream and preserves independent histories and scroll anchors', async () => {
    const runtime = fixture()
    const first = 'first' as SessionId
    const second = 'second' as SessionId
    const releaseFirst = runtime.retain(first)
    await flush()
    const old = transport.instances[0]!
    runtime.saveScroll(first, { anchorKey: 'first-row', anchorTop: 2, scrollTop: 50 })
    releaseFirst()
    const releaseSecond = runtime.retain(second)
    await flush()
    old.options.failed(new Error('late failure'))
    expect(runtime.source(first).getSnapshot().openError).toBeNull()
    expect(runtime.source(second).getSnapshot().openError).toBeNull()
    expect(runtime.readScroll(first)?.anchorKey).toBe('first-row')
    expect(runtime.readScroll(second)).toBeNull()
    releaseSecond()
  })

  it('waits for asynchronous stream disposal before reopening the same Session', async () => {
    const runtime = fixture()
    const id = 'same' as SessionId
    const release = runtime.retain(id)
    await flush()
    let finish!: () => void
    const closed = new Promise<void>((resolve) => { finish = resolve })
    transport.instances[0]!.dispose.mockReturnValue(closed)
    release()
    const releaseAgain = runtime.retain(id)
    await flush()
    expect(transport.instances).toHaveLength(1)
    finish()
    await flush()
    await flush()
    expect(transport.instances).toHaveLength(2)
    releaseAgain()
  })
})
