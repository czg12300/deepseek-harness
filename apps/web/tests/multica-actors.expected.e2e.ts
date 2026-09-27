/** Actor-library creation, media references, ZIP export and merge through the shipped Web composition. */
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { assertFixtureInventory, captureStableAria, compareOrRefreshGolden, launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const EXPECTED_DIR = fileURLToPath(new URL('./expected/multica-actors', import.meta.url))
const WORKSPACE = 'section[aria-label="Comics workspace"]'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

async function libraries(home: string): Promise<Array<{ name: string; path: string; actorCount: number }>> {
  const root = join(home, 'multica', 'actor')
  const paths = await readdir(root)
  return paths.filter(path => /^[0-9a-f-]{36}$/.test(path)).map((id) => {
    const path = join(root, id)
    const db = new DatabaseSync(join(path, 'library.sqlite'), { readOnly: true })
    try {
      return { path, name: String(db.prepare('SELECT name FROM library').get()?.name),
        actorCount: Number(db.prepare('SELECT COUNT(*) AS n FROM actors').get()?.n) }
    } finally { db.close() }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

it('creates a portable actor library, exports its assets and merges another library', async () => {
  const scaffold = await launchWebScaffold()
  const browser = await chromium.launch()
  let page: import('playwright').Page | undefined
  try {
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Comics', exact: true }).click()
    const workspaceUrl = page.url()
    await page.getByRole('tab', { name: 'Actor library', exact: true }).click()
    await expect.poll(() => page.getByRole('tab', { name: 'Actor library', exact: true }).getAttribute('aria-selected')).toBe('true')
    expect(page.url()).toBe(workspaceUrl)
    await page.getByRole('button', { name: 'New library', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'New library', exact: true })
    await create.getByRole('textbox', { name: 'Library name' }).fill('Main cast')
    await create.getByRole('button', { name: 'New library', exact: true }).click()
    await page.getByRole('option', { name: 'Main cast · 0' }).waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Add actor', exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Add actor', exact: true })
    await editor.getByRole('textbox', { name: 'Actor name' }).fill('Mira')
    await editor.getByRole('textbox', { name: 'Character description' }).fill('Lighthouse keeper')
    await editor.getByRole('textbox', { name: 'Period' }).fill('Modern')
    await editor.getByRole('textbox', { name: 'Region' }).fill('Coast')
    await editor.getByLabel('Portrait reference').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png })
    await editor.locator('img').waitFor()
    await editor.getByRole('button', { name: 'Save actor', exact: true }).click()
    await page.getByRole('button', { name: 'Mira', exact: true }).waitFor()
    const source = (await libraries(scaffold.harnessHome))[0]
    expect(source).toBeDefined()
    if (!source) throw new Error('Actor library was not created')
    expect(source.name).toBe('Main cast')
    expect((await readdir(join(source.path, 'assets'))).length).toBe(1)
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name: 'Export library', exact: true }).click(),
    ])
    const downloadPath = await download.path()
    if (!downloadPath) throw new Error('Actor library ZIP download has no file')
    const zip = await readFile(downloadPath)
    await page.getByRole('button', { name: 'New library', exact: true }).click()
    const second = page.getByRole('dialog', { name: 'New library', exact: true })
    await second.getByRole('textbox', { name: 'Library name' }).fill('Guest cast')
    await second.getByRole('button', { name: 'New library', exact: true }).click()
    await page.getByRole('option', { name: 'Guest cast · 0' }).waitFor({ state: 'attached' })
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import and merge', exact: true }).click(),
    ])
    await chooser.setFiles({ name: 'cast.zip', mimeType: 'application/zip', buffer: zip })
    await page.getByRole('status').filter({ hasText: 'Import complete: 1 added' }).waitFor()
    const catalog = await libraries(scaffold.harnessHome)
    expect(catalog.map(library => library.name)).toEqual(['Guest cast', 'Main cast'])
    expect(catalog.map(library => library.actorCount)).toEqual([1, 1])
    const merged = catalog[0]
    if (!merged) throw new Error('Merged actor library is missing')
    expect((await readFile(join(merged.path, 'library.sqlite'))).length).toBeGreaterThan(0)
    const captured = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
    await page.getByRole('tab', { name: 'All projects', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search project names', exact: true }).waitFor()
    expect(page.url()).toBe(workspaceUrl)
    await page.getByRole('tab', { name: 'Actor library', exact: true }).click()
    await page.getByRole('button', { name: 'Mira', exact: true }).waitFor()
    expect(await page.getByRole('combobox', { name: 'Current library' }).inputValue()).toBe(merged.path.split('/').pop())
    expect(page.url()).toBe(workspaceUrl)
    if (process.env.DSH_MULTICA_QA_DIR) {
      await mkdir(process.env.DSH_MULTICA_QA_DIR, { recursive: true })
      await page.screenshot({ path: join(process.env.DSH_MULTICA_QA_DIR, 'actors.png'), fullPage: true })
    }
    if (scaffold.mode === 'refresh') await mkdir(EXPECTED_DIR, { recursive: true })
    await compareOrRefreshGolden(join(EXPECTED_DIR, 'actors.expected.md'), captured, scaffold.mode)
    await assertFixtureInventory(EXPECTED_DIR, ['actors.expected.md'])
  } catch (error) {
    if (page) await saveFailureShot(page, 'web-e2e-multica-actors')
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
  }
})
