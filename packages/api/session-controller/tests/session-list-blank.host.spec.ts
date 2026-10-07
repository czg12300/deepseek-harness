/**
 * The summary blank bit means "conversation not started" (no turn has run),
 * not "log empty": standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it, so running /plan or /goal on a
 * fresh session keeps it list-hidden and reusable, while the first accepted
 * prompt's turn/start clears it. The host/session-added frame shares the
 * same predicate function (covered by the workspace spec's frame assertion).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createSessionTestRemote, testSessionPersistence, type TestSessionRemote } from './test-remote.ts'
import type { SessionSummary } from '../src/types.ts'

const contexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...contexts].map(ctx => ctx.fiber.dispose()))
  contexts.clear()
})

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => void }> {
  const ctx = new Context()
  contexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = conversation not started', () => {
  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create(undefined, { meta: { cwd: '/tmp' } })
    attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create(undefined, { meta: { cwd: '/tmp' } })
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })

  it('keeps project-only Sessions out of live notifications, listings, and ordinary history', async () => {
    const { ctx, remote } = await harness()
    const added = vi.fn<(summary: SessionSummary) => void>()
    ctx.on('api-session/added', added)
    const project = ctx.sessions.create(SessionId('portable-professional'), { meta: { agentPreset: 'multica' } })
    project.append('turn/start', { turn: 0 })
    const ordinary = ctx.sessions.create(SessionId('ordinary-ungrouped'), { meta: { cwd: '/tmp' } })
    ordinary.append('turn/start', { turn: 0 })
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([
        { ...project.header, id: SessionId('cold-professional') },
        { ...ordinary.header, id: SessionId('cold-ordinary') },
      ]),
    }) as never)

    expect(added.mock.calls.map(([summary]) => summary.sessionId)).toEqual([ordinary.id])
    const result = await remote.list({})
    if (!result.ok) throw new Error('list failed')
    expect(result.value.items.map(item => item.sessionId).sort()).toEqual(['cold-ordinary', ordinary.id])
    const history = await remote.page({
      address: { kind: 'session', sessionId: project.id },
      throughSeq: project.seq - 1,
    })
    expect(history).toMatchObject({ ok: false, error: { code: 'session/not-found' } })
  })
})
