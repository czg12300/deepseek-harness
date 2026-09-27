/** Account activation and failed authorization through the shipped Web composition. */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { launchWebScaffold, compareOrRefreshGolden, watchConsole } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const EXPECTED_DIR = fileURLToPath(new URL('./expected/third-party-auth', import.meta.url))

it.each(['success', 'failure'] as const)('shows the %s of a ChatGPT token exchange and recovers without a reload', async (outcome) => {
  const scaffold = await launchWebScaffold()
  const originalFetch = globalThis.fetch
  const token = `header.${Buffer.from(JSON.stringify({
    'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account' },
  })).toString('base64url')}.signature`
  let rejectExchange = outcome === 'failure'
  let exchanges = 0
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://auth.openai.com/api/accounts/deviceauth/usercode') {
      return Response.json({ device_auth_id: 'fixture-device', user_code: 'fixture-code', interval: 0 })
    }
    if (url === 'https://auth.openai.com/api/accounts/deviceauth/token') {
      return Response.json({ authorization_code: 'fixture-authorization', code_verifier: 'fixture-verifier' })
    }
    if (url === 'https://auth.openai.com/oauth/token') {
      exchanges++
      return rejectExchange
        ? Response.json({ error: 'private-upstream-response' }, { status: 403 })
        : Response.json({ access_token: token, refresh_token: 'fixture-refresh', expires_in: 3600 })
    }
    return originalFetch(input, init)
  })
  try {
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const console = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.getByRole('button', { name: 'Third-party authorization', exact: true }).click()
      const login = async (): Promise<void> => {
        await settings.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click()
        const dialog = page.locator('dialog[open]')
        await dialog.getByRole('combobox').selectOption('device_code')
        await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
      }
      await login()
      if (outcome === 'failure') {
        await settings.getByText(/Authorization or credential storage failed/).waitFor()
        expect(await settings.innerText()).not.toContain('private-upstream-response')
        const snapshot = await settings.getByRole('status').filter({ hasText: 'Authorization or credential storage failed.' }).ariaSnapshot()
        if (scaffold.mode === 'refresh') await mkdir(EXPECTED_DIR, { recursive: true })
        await compareOrRefreshGolden(join(EXPECTED_DIR, 'failure.expected.md'), snapshot, scaffold.mode)
        rejectExchange = false
        await login()
      }
      await settings.getByText('Account connected.', { exact: true }).waitFor()
      expect(await settings.getByRole('article', { name: 'ChatGPT', exact: true })
        .getByRole('button', { name: 'Disconnect', exact: true }).isVisible()).toBe(true)
      expect(exchanges).toBe(outcome === 'failure' ? 2 : 1)
      const credentials = await readFile(join(scaffold.harnessHome, '.credentials.yaml'), 'utf8')
      expect(credentials.includes('fixture-refresh')).toBe(true)
      expect(scaffold.ctx.settings.get('third-party-auth')).toMatchObject({ accounts: { chatgpt: { enabled: true } } })
      expect(scaffold.ctx.settings.get('llm-pi-ai')).toMatchObject({ providers: { 'openai-codex': {} } })
      expect(console.pageErrors).toEqual([])
      if (outcome === 'success') {
        const snapshot = await settings.getByRole('status').filter({ hasText: 'Account connected.' }).ariaSnapshot()
        if (scaffold.mode === 'refresh') await mkdir(EXPECTED_DIR, { recursive: true })
        await compareOrRefreshGolden(join(EXPECTED_DIR, 'success.expected.md'), snapshot, scaffold.mode)
      }
    } finally { await browser.close() }
  } finally {
    fetchSpy.mockRestore()
    await scaffold.close()
  }
})
