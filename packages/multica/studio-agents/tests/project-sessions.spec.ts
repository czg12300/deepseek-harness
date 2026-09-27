import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { runPersistenceContract } from '../../../session/session-persistence/tests/contract.ts'
import { ProjectSessions } from '../src/project-sessions.ts'

runPersistenceContract('portable project SQLite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'multica-session-contract-'))
  const ctx = new Context()
  const store = new ProjectSessions(root, () => {})
  try {
    await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'ordinary'), compression: 'none' })
    ctx.sessionPersistence.registerStore({ owns: () => true, backend: store })
  } catch (error) {
    await store.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
  return {
    persistence: ctx.sessionPersistence,
    dispose: async () => {
      await store.close()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
})
