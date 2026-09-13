/** Multica project persistence through the shipped Web composition, without Session or model fixtures. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria,
  compareOrRefreshGolden, launchWebScaffold, watchConsole,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const EXPECTED_DIR = fileURLToPath(new URL('./expected/multica', import.meta.url))
const WORKSPACE = 'section[aria-label="Comics workspace"]'
const UI_WAIT = { timeout: 15_000 }
const FIRST_PROJECT = 'Lighthouse Keepers'
const SECOND_PROJECT = 'Desert Couriers'
const FIRST_OUTLINE = 'Mira repairs the lighthouse before the winter fleet returns.'
const SECOND_OUTLINE = 'A courier crosses the desert to deliver the last seed.'

// Labels mirror packages/client/ui-multica/src/client/locales.ts. Importing
// that Client package would pull its compiler program into this Host test.

async function projectRequest(page: Page, action: Locator, method: 'create' | 'get' | 'save' | 'setArchived' | 'submitReview' | 'decideReview'): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse(candidate => candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === `/api/studioProjects/${method}`),
    action.click(),
  ])
  expect(response.ok(), `studioProjects/${method} HTTP response`).toBe(true)
  const body = await response.json() as { result?: { ok?: unknown } }
  expect(body.result?.ok, `studioProjects/${method} RPC result`).toBe(true)
}

/** Read the temp database independently of the service and browser's project state. */
function persistedProjects(harnessHome: string) {
  const db = new DatabaseSync(join(harnessHome, 'multica/studio.sqlite'), { readOnly: true })
  try {
    return db.prepare(`
      SELECT json_extract(document, '$.name') AS name,
             json_extract(document, '$.outline') AS outline,
             json_extract(document, '$.archived') AS archived
      FROM project_revisions current
      WHERE revision = (SELECT MAX(revision) FROM project_revisions WHERE project_id = current.project_id)
      ORDER BY name
    `).all()
  } finally {
    db.close()
  }
}

it('keeps Comics projects isolated across saves, reload, archive and restore', async () => {
  const scaffold = await launchWebScaffold()
  try {
    expect(persistedProjects(scaffold.harnessHome)).toEqual([])
    expect(scaffold.ctx.sessions.list()).toEqual([])
    const sessionEvents: string[] = []
    scaffold.ctx.on('session/event', (_session, event) => { sessionEvents.push(event.type) })
    const browser = await chromium.launch()
    let failurePage: Page | undefined
    try {
      const page = await newEnglishPage(browser)
      failurePage = page
      const tripwire = watchConsole(page)
      const comics = page.getByRole('navigation', { name: 'Global panels' })
        .getByRole('button', { name: 'Comics', exact: true })
      const outline = page.getByRole('textbox', { name: 'Story outline', exact: true })
      const save = page.getByRole('button', { name: 'Save draft', exact: true })

      const allProjects = async (): Promise<void> => {
        await page.getByRole('button', { name: 'Back to all projects', exact: true }).click()
        await page.getByRole('heading', { name: 'All projects', exact: true }).waitFor()
      }
      const createProject = async (name: string, concept: string): Promise<void> => {
        await page.getByRole('button', { name: 'New project', exact: true }).first().click()
        await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
        await page.getByRole('textbox', { name: 'One-line concept', exact: true }).fill(concept)
        await projectRequest(page, page.getByRole('button', { name: 'Create project', exact: true }), 'create')
        await outline.waitFor()
        await expect.poll(() => outline.inputValue(), UI_WAIT).toBe('')
      }
      const saveOutline = async (text: string): Promise<void> => {
        await outline.fill(text)
        await projectRequest(page, save, 'save')
        await page.getByText('Saved', { exact: true }).waitFor()
      }
      const openProject = async (name: string, text: string): Promise<void> => {
        await projectRequest(page, page.getByRole('article', { name, exact: true })
          .getByRole('button', { name: 'Open project', exact: true }), 'get')
        await page.getByRole('button', { name: 'Story outline', exact: true }).click()
        await expect.poll(() => outline.inputValue(), UI_WAIT).toBe(text)
        await expect.poll(() => page.locator(WORKSPACE).getByText('Loading…', { exact: true }).count(), UI_WAIT).toBe(0)
      }

      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await comics.click()
      await expect.poll(() => comics.getAttribute('aria-current'), UI_WAIT).toBe('page')
      await page.getByRole('heading', { name: 'All projects', exact: true }).waitFor()
      await page.getByRole('button', { name: 'New project', exact: true }).first().click()
      const creation = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      expect(await page.getByRole('textbox', { name: 'Project name', exact: true }).isVisible()).toBe(true)
      expect(await page.getByRole('spinbutton').count()).toBe(0)
      expect(await page.getByRole('textbox', { name: 'Request for the professional assistant', exact: true }).isVisible()).toBe(false)
      expect(await page.getByRole('button', { name: 'Create project', exact: true }).isEnabled()).toBe(false)
      await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(FIRST_PROJECT)
      await page.getByRole('textbox', { name: 'One-line concept', exact: true }).fill('🌊'.repeat(3000))
      await projectRequest(page, page.getByRole('button', { name: 'Create project', exact: true }), 'create')
      await outline.waitFor()
      await saveOutline(FIRST_OUTLINE)
      await allProjects()
      const firstCard = page.getByRole('article', { name: FIRST_PROJECT, exact: true })
      const coverBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
      await firstCard.getByLabel('Upload cover', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: coverBytes })
      const cover = firstCard.getByRole('img', { name: `Cover for ${FIRST_PROJECT}` })
      await cover.waitFor()
      expect(await cover.getAttribute('src')).toBe(`data:image/png;base64,${coverBytes.toString('base64')}`)
      await firstCard.getByLabel('Replace cover', { exact: true }).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: coverBytes })
      await expect.poll(async () => {
        const db = new DatabaseSync(join(scaffold.harnessHome, 'multica/studio.sqlite'), { readOnly: true })
        try { return db.prepare('SELECT revision FROM project_covers').get()?.revision }
        finally { db.close() }
      }, UI_WAIT).toBe(2)
      await createProject(SECOND_PROJECT, 'A seed can change a desert.')
      await saveOutline(SECOND_OUTLINE)
      await allProjects()
      await openProject(FIRST_PROJECT, FIRST_OUTLINE)

      const reloadWarnings = tripwire.warnings.length
      await page.reload({ waitUntil: 'load' })
      await comics.click()
      await page.getByRole('heading', { name: 'All projects', exact: true }).waitFor()
      expect(await page.getByRole('img', { name: `Cover for ${FIRST_PROJECT}` }).getAttribute('src')).toBe(`data:image/png;base64,${coverBytes.toString('base64')}`)
      await openProject(SECOND_PROJECT, SECOND_OUTLINE)
      await allProjects()
      await openProject(FIRST_PROJECT, FIRST_OUTLINE)
      acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)

      await expect.poll(() => page.getByRole('textbox', { name: 'Request for the professional assistant', exact: true }).isEditable(), UI_WAIT).toBe(true)
      await projectRequest(page, page.getByRole('button', { name: 'Submit for review', exact: true }), 'submitReview')
      await page.getByRole('button', { name: 'Awaiting review', exact: true }).click()
      await page.getByRole('button', { name: /Lighthouse Keepers.*Story outline/s }).click()
      await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Ready for storyboard planning.')
      await projectRequest(page, page.getByRole('button', { name: 'Approve this version', exact: true }), 'decideReview')
      await expect.poll(() => page.getByRole('button', { name: 'Approve this version', exact: true }).isEnabled(), UI_WAIT).toBe(false)
      const reviewed = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      await page.getByRole('button', { name: 'Back to workspace', exact: true }).click()
      const editable = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      await page.getByRole('button', { name: 'Project settings', exact: true }).click()
      await projectRequest(page, page.getByRole('button', { name: 'Archive project', exact: true }), 'setArchived')
      await allProjects()
      await page.getByRole('article', { name: SECOND_PROJECT, exact: true }).waitFor()
      await expect.poll(() => page.getByRole('article', { name: FIRST_PROJECT, exact: true }).count(), UI_WAIT).toBe(0)
      await page.getByRole('button', { name: 'Archived', exact: true }).click()
      await openProject(FIRST_PROJECT, FIRST_OUTLINE)
      await expect.poll(() => outline.isEditable(), UI_WAIT).toBe(false)
      await expect.poll(() => save.isEnabled(), UI_WAIT).toBe(false)
      const archived = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)

      await page.getByRole('button', { name: 'Project settings', exact: true }).click()
      await projectRequest(page, page.getByRole('button', { name: 'Restore project', exact: true }), 'setArchived')
      await page.getByRole('button', { name: 'Story outline', exact: true }).click()
      await expect.poll(() => outline.isEditable(), UI_WAIT).toBe(true)
      const restoredOutline = `${FIRST_OUTLINE} The lantern shines again.`
      await saveOutline(restoredOutline)
      await allProjects()
      await page.getByRole('button', { name: 'Active', exact: true }).click()
      await openProject(FIRST_PROJECT, restoredOutline)
      await allProjects()
      await openProject(SECOND_PROJECT, SECOND_OUTLINE)

      expect(persistedProjects(scaffold.harnessHome)).toEqual([
        { name: SECOND_PROJECT, outline: SECOND_OUTLINE, archived: 0 },
        { name: FIRST_PROJECT, outline: restoredOutline, archived: 0 },
      ])
      expect(scaffold.ctx.sessions.list()).toEqual([])
      expect(sessionEvents).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      if (scaffold.mode === 'refresh') await mkdir(EXPECTED_DIR, { recursive: true })
      await compareOrRefreshGolden(join(EXPECTED_DIR, 'ui.expected.md'),
        `## Simple creation\n\n${creation}\n\n## Saved project\n\n${editable}\n\n## Archived project\n\n${archived}\n\n## Human-approved outline\n\n${reviewed}`, scaffold.mode)
      await assertFixtureInventory(EXPECTED_DIR, ['ui.expected.md'])
    } catch (error) {
      if (failurePage !== undefined) await saveFailureShot(failurePage, 'web-e2e-multica')
      throw error
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
