/** Inspect the optional account bundle through the production Profile loader. */
import type {} from '../../../src/service.ts'
import type {} from '../../../src/native-sessions.ts'
import { fileURLToPath } from 'node:url'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const bundlePath = process.argv[2]
if (bundlePath === undefined) throw new Error('account loader fixture requires a bundle patch')
const ctx = await bootProductionProfile({ binName: 'third-party-auth-loader', profile: 'headless',
  overlayPaths: [bundlePath, fileURLToPath(new URL('./accounts.patch.yml', import.meta.url))] })
try {
  const accounts = await ctx.thirdPartyAuth.list(new AbortController().signal)
  process.stdout.write(JSON.stringify({
    accounts: accounts.map(account => ({ id: account.id, enabled: account.enabled, connected: account.connected })),
    nativeSessions: ctx.thirdPartyClaude.list().length,
  }))
} finally { await ctx.fiber.dispose() }
