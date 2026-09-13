import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

describe('optional account bundle composition', () => {
  it('loads both disconnected account providers without changing the base profile', async () => {
    const driver = fileURLToPath(new URL('./fixtures/loader/driver.ts', import.meta.url))
    const patch = fileURLToPath(new URL('../../third-party-auth-bundle/cordis.patch.yml', import.meta.url))
    const result = await runLoaderSmoke({
      label: 'third-party accounts', tempDirPrefix: 'dsh-third-party-loader-',
      binScript: driver, libBinScript: driver, binArgs: [patch], configPath: patch,
      tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      processTimeoutMs: 60_000,
    })
    expect(JSON.parse(result.stdout)).toEqual({
      accounts: [{ id: 'chatgpt', enabled: false, connected: false }, { id: 'claude', enabled: false, connected: false }],
      nativeSessions: 0,
    })
  }, 75_000)
})
