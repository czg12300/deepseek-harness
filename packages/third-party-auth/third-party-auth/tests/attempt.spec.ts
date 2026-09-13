import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PromptId } from '../src/types.ts'
import { ConnectAttempt } from '../src/attempt.ts'

describe('private account authorization', () => {
  it('only accepts a live prompt from its own attempt', async () => {
    const attempt = new ConnectAttempt(new AbortController().signal, 10_000, 8)
    try {
      const events = attempt.stream()
      expect((await events.next()).value?.kind).toBe('started')
      const answer = attempt.prompt({ kind: 'text', message: 'Authorization code' })
      const event = (await events.next()).value
      if (event?.kind !== 'prompt') throw new Error('expected prompt')
      expect(() => attempt.answer(brandString<PromptId>('foreign'), 'secret')).toThrow('no longer available')
      attempt.answer(event.id, 'secret')
      await expect(answer).resolves.toBe('secret')
      expect(() => attempt.answer(event.id, 'again')).toThrow('no longer available')
      expect((await events.next()).value).toEqual({ kind: 'withdrawn', id: event.id })
      await events.return(undefined)
    } finally { attempt.close() }
  })

  it('withdraws a prompt independently without aborting the login', async () => {
    const attempt = new ConnectAttempt(new AbortController().signal, 10_000, 8)
    const prompt = new AbortController()
    try {
      const answer = attempt.prompt({ kind: 'secret', message: 'Code', signal: prompt.signal })
      const rejection = expect(answer).rejects.toThrow('withdrawn')
      prompt.abort()
      await rejection
      expect(attempt.signal.aborted).toBe(false)
    } finally { attempt.close() }
  })

  it('cancels pending input with the originating stream', async () => {
    const parent = new AbortController()
    const attempt = new ConnectAttempt(parent.signal, 10_000, 8)
    try {
      const answer = attempt.prompt({ kind: 'text', message: 'Code' })
      const rejection = expect(answer).rejects.toThrow('withdrawn')
      parent.abort()
      await rejection
      expect(attempt.signal.aborted).toBe(true)
    } finally { attempt.close() }
  })

  it('rejects choices the provider did not offer', async () => {
    const attempt = new ConnectAttempt(new AbortController().signal, 10_000, 8)
    try {
      const events = attempt.stream()
      await events.next()
      const answer = attempt.prompt({ kind: 'select', message: 'Account', options: [{ id: 'a', label: 'Account A' }] })
      const event = (await events.next()).value
      if (event?.kind !== 'prompt') throw new Error('expected prompt')
      expect(() => attempt.answer(event.id, 'b')).toThrow('invalid authorization choice')
      attempt.answer(event.id, 'a')
      await expect(answer).resolves.toBe('a')
      await events.return(undefined)
    } finally { attempt.close() }
  })

  it('bounds unread notices and still delivers settlement', async () => {
    const attempt = new ConnectAttempt(new AbortController().signal, 10_000, 4)
    for (let index = 0; index < 10; index++) attempt.notify({ message: 'progress' })
    expect(attempt.signal.aborted).toBe(true)
    attempt.push({ kind: 'settled', status: 'cancelled' })
    attempt.close()
    const events = []
    for await (const event of attempt.stream()) events.push(event)
    expect(events).toHaveLength(4)
    expect(events.at(-1)).toEqual({ kind: 'settled', status: 'cancelled' })
  })
})
