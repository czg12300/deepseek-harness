import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { ClaudeRuntime, claudeExecutable } from '../src/claude-runtime.ts'
import { claudeModels } from '../src/claude-sdk.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

describe.skipIf(claudeExecutable() === undefined)('pinned native account runtime', () => {
  it('reads an isolated signed-out account without touching the user login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-account-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SubprocessLocal)
    const config = { cwd: root, nativeConfigDir: root, graceMs: 3000, outputBytes: 65_536, statusTimeoutMs: 30_000 }
    const runtime = new ClaudeRuntime(ctx, config)
    expect(await runtime.status(new AbortController().signal)).toMatchObject({ loggedIn: false, authMethod: 'none' })
  }, 40_000)

  it('discovers native models without submitting an inference prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-catalog-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await ctx.plugin(SubprocessLocal)
    const models = await claudeModels(ctx, {
      cwd: root, nativeConfigDir: root, graceMs: 3000, outputBytes: 65_536, statusTimeoutMs: 30_000,
    }, new AbortController().signal)
    expect(models.length).toBeGreaterThan(0)
    expect(models.every(model => model.id.length > 0 && model.name.length > 0)).toBe(true)
  }, 40_000)
})
