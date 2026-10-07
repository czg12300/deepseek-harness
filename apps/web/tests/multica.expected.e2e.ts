/** Multica project persistence through the shipped Web composition, without Session or model fixtures. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it, vi } from 'vitest'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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

async function projectRequest(page: Page, action: Locator, method: 'create' | 'createFromDraft' | 'prepareFolder' | 'closeFolder' | 'forgetFolder' | 'openFolder' | 'get' | 'save' | 'setArchived' | 'submitReview' | 'decideReview' | 'saveScriptDocument' | 'completeScript' | 'createProductionUnit' | 'addCanvasNode' | 'importProjectMedia'): Promise<void> {
  if (vi.isFakeTimers()) vi.setSystemTime(Date.now() + 1000)
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
  const catalog = new DatabaseSync(join(harnessHome, 'multica/studio.sqlite'), { readOnly: true })
  const paths = catalog.prepare("SELECT json_extract(document, '$.path') AS path FROM studio_locations").all()
  catalog.close()
  return paths.flatMap((row) => {
    const db = new DatabaseSync(join(String(row.path), 'project.sqlite'), { readOnly: true })
    try {
      return db.prepare(`SELECT json_extract(document, '$.name') AS name, json_extract(document, '$.outline') AS outline,
        json_extract(document, '$.archived') AS archived FROM project_revisions current
        WHERE revision = (SELECT MAX(revision) FROM project_revisions WHERE project_id = current.project_id)`).all()
    } finally { db.close() }
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

it('persists Markdown scripts, production canvases and project assets in portable folders', async () => {
  const scaffold = await launchWebScaffold()
  let chosenDirectory: string | null = null
  const pick = vi.fn(async () => chosenDirectory)
  const pickerCapability = vi.spyOn(scaffold.ctx.directoryPicker, 'capability').mockReturnValue({ kind: 'native', pick })
  try {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-10T12:00:00Z') })
    const browser = await chromium.launch()
    let failurePage: Page | undefined
    try {
      const page = await newEnglishPage(browser)
      failurePage = page
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Comics', exact: true }).click()
      const create = async (name: string, concept: string): Promise<void> => {
        await page.getByRole('button', { name: 'New project', exact: true }).first().click()
        await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name)
        await page.getByRole('textbox', { name: 'One-line concept', exact: true }).fill(concept)
        chosenDirectory = join(scaffold.workspaceCwd, name)
        await mkdir(chosenDirectory)
        await projectRequest(page, page.getByRole('button', { name: 'Choose folder', exact: true }), 'prepareFolder')
        await projectRequest(page, page.getByRole('button', { name: 'Create project', exact: true }), 'createFromDraft')
        await page.getByRole('button', { name: 'Edit document', exact: true }).waitFor()
      }
      const editDocument = async (markdown: string): Promise<void> => {
        await page.getByRole('button', { name: 'Edit document', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Edit document' })
        await dialog.getByRole('textbox', { name: 'Markdown source' }).fill(markdown)
        await projectRequest(page, dialog.getByRole('button', { name: 'Save draft', exact: true }), 'saveScriptDocument')
        await dialog.waitFor({ state: 'hidden' })
        await page.getByText(markdown, { exact: true }).waitFor()
      }
      const allProjects = async (): Promise<void> => {
        await page.getByRole('button', { name: 'Back to all projects', exact: true }).first().click()
        await page.getByRole('tab', { name: 'All projects', exact: true }).waitFor()
      }
      await create(FIRST_PROJECT, 'A lighthouse keeper saves the village.')
      await editDocument(FIRST_OUTLINE)
      const script = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      await page.getByRole('button', { name: '人物小传.md' }).click()
      await page.getByRole('complementary', { name: 'Character biography assistant' }).waitFor()
      expect(await page.getByRole('button', { name: 'Apply to outline editor' }).count()).toBe(0)
      await page.getByRole('button', { name: '故事大纲.md' }).click()
      await page.getByRole('button', { name: 'Add episode', exact: true }).click()
      const episodeDialog = page.getByRole('dialog', { name: 'Add episode' })
      await episodeDialog.getByRole('textbox', { name: 'Episode title' }).fill('Episode 01: The signal')
      await projectRequest(page, episodeDialog.getByRole('button', { name: 'Add episode' }), 'save')
      await episodeDialog.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: 'Edit document', exact: true }).waitFor()
      await editDocument('Mira lights the beacon during a storm.')
      await projectRequest(page, page.getByRole('button', { name: 'Confirm script complete' }), 'completeScript')
      await page.getByText('Script confirmed. Production is ready.').waitFor()
      await page.getByRole('button', { name: 'New production unit' }).click()
      const unitDialog = page.getByRole('dialog', { name: 'New production unit' })
      await unitDialog.getByRole('textbox', { name: 'Project name' }).fill('Episode 01 production')
      await projectRequest(page, unitDialog.getByRole('button', { name: 'Create production unit' }), 'createProductionUnit')
      await page.getByRole('heading', { name: 'Episode 01 production' }).waitFor()
      await projectRequest(page, page.getByRole('button', { name: 'Add text' }), 'addCanvasNode')
      const firstNode = page.locator('main article').first()
      const nodeBounds = await firstNode.boundingBox()
      expect(nodeBounds).not.toBeNull()
      await page.mouse.move(nodeBounds!.x + 20, nodeBounds!.y + 20)
      await page.mouse.down()
      await page.mouse.move(nodeBounds!.x + 50, nodeBounds!.y + 40, { steps: 3 })
      const [moveResponse] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/studioProjects/moveCanvasNode'),
        page.mouse.up(),
      ])
      expect(moveResponse.ok()).toBe(true)
      const canvas = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/studioProjects/importProjectMedia'),
        page.locator('input[type=file][accept^="image/png"]').setInputFiles({ name: 'beacon.png', mimeType: 'image/png', buffer: png }),
      ])
      await page.getByRole('button', { name: 'Project assets' }).click()
      await page.getByRole('button', { name: /beacon.png/ }).locator('img').waitFor()
      await page.getByRole('button', { name: /beacon.png/ }).click()
      await page.getByRole('dialog', { name: 'beacon.png' }).getByRole('img', { name: 'beacon.png' }).waitFor()
      const assets = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      await page.getByRole('dialog', { name: 'beacon.png' }).getByRole('button', { name: 'Cancel' }).click()
      const projectDb = join(scaffold.workspaceCwd, FIRST_PROJECT, 'project.sqlite')
      const db = new DatabaseSync(projectDb, { readOnly: true })
      expect(db.prepare('SELECT count(*) AS count FROM studio_script_documents').get()?.count).toBe(3)
      expect(db.prepare('SELECT count(*) AS count FROM studio_production_units').get()?.count).toBe(1)
      expect(db.prepare('SELECT count(*) AS count FROM studio_media_assets').get()?.count).toBe(1)
      db.close()
      expect(persistedProjects(scaffold.harnessHome)).toEqual([{ name: FIRST_PROJECT, outline: FIRST_OUTLINE, archived: 0 }])
      await allProjects()
      await create(SECOND_PROJECT, 'A courier crosses the desert.')
      await editDocument(SECOND_OUTLINE)
      expect(persistedProjects(scaffold.harnessHome)).toEqual([
        { name: SECOND_PROJECT, outline: SECOND_OUTLINE, archived: 0 },
        { name: FIRST_PROJECT, outline: FIRST_OUTLINE, archived: 0 },
      ])
      const warningStart = tripwire.warnings.length
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Comics', exact: true }).click()
      await page.getByRole('article', { name: FIRST_PROJECT, exact: true }).getByRole('button', { name: 'Open project' }).click()
      await page.getByRole('button', { name: 'Episode 01 production' }).click()
      await page.getByText('Mira lights the beacon during a storm.').waitFor()
      await page.getByRole('button', { name: 'Project assets' }).click()
      await page.getByRole('button', { name: /beacon.png/ }).waitFor()
      acknowledgeReloadConnectionLoss(tripwire, warningStart)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      if (scaffold.mode === 'refresh') await mkdir(EXPECTED_DIR, { recursive: true })
      await compareOrRefreshGolden(join(EXPECTED_DIR, 'ui.expected.md'),
        `## Script browser\n\n${script}\n\n## Production canvas\n\n${canvas}\n\n## Project assets\n\n${assets}`, scaffold.mode)
      await assertFixtureInventory(EXPECTED_DIR, ['ui.expected.md'])
    } catch (error) {
      if (failurePage) await saveFailureShot(failurePage, 'web-e2e-multica-workspace')
      throw error
    } finally { await browser.close() }
  } finally {
    vi.useRealTimers()
    pickerCapability.mockRestore()
    await scaffold.close()
  }
})

it('writes an assistant outline into the editor and restores its saved version after reload', async () => {
  const scaffold = await launchWebScaffold()
  try {
    const requests: GenerateOptions[] = []
    const generated = 'Premise: Mira inherits a lighthouse.\nConflict: The village wants it closed.\nEnding: She lights a safe route home.'
    scaffold.ctx.llm.registerAdapter(['outline-fixture'], new class extends LlmAdapter {
      override listModels(provider: string) { return Promise.resolve([{ provider, id: 'writer', name: 'Outline writer' }]) }
      override resolveModel(provider: string, model: string) { return Promise.resolve({ provider, id: model, name: model }) }
      override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(request)
        const id = ToolCallId('outline-proposal')
        const args = JSON.stringify({ reply: 'The outline is ready to apply.', changes: [{ field: 'outline', value: generated }] })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'structured_output', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'structured_output', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    }())
    const role = scaffold.ctx.studioProjects.roles().find(role => role.role === 'planner')!
    await scaffold.ctx.studioProjects.publishRole('planner', role.revision, { ...role.config, provider: 'outline-fixture', model: 'writer' })
    const project = scaffold.ctx.studioProjects.create({ name: 'Outline workshop', concept: 'A lighthouse keeper saves her village.', sourceText: '', aspectRatio: '16:9', targetEpisodes: null, episodeDuration: null, outline: '', episodes: [] })
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Comics', exact: true }).click()
      await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click()
      const planner = page.getByRole('complementary', { name: 'Planning assistant', exact: true })
      const outline = page.getByRole('textbox', { name: 'Story outline', exact: true })
      await outline.fill('Keep the village and the lighthouse.')
      await planner.getByRole('button', { name: 'Develop current outline', exact: true }).click()
      expect(requests).toHaveLength(0)
      await planner.getByRole('button', { name: 'Send message', exact: true }).click()
      await planner.getByText('The outline is ready to apply.', { exact: true }).waitFor()
      expect(await outline.inputValue()).toBe('Keep the village and the lighthouse.')
      expect(JSON.stringify(requests[0]?.messages)).toContain('Keep the village and the lighthouse.')
      expect(JSON.stringify(requests[0]?.messages)).toContain('complete usable outline')
      await planner.getByRole('button', { name: 'Apply to outline editor', exact: true }).click()
      await expect.poll(() => outline.inputValue(), UI_WAIT).toBe(generated)
      await planner.getByText('Story outline updated in the editor and saved as a draft version', { exact: true }).waitFor()
      expect(scaffold.ctx.studioProjects.get(project.id)?.outline).toBe(generated)
      expect(scaffold.ctx.studioProjects.reviews(project.id)).toEqual([])
      await planner.getByRole('button', { name: 'Select model, current Outline writer', exact: true }).waitFor()
      await planner.locator('[data-chat-flow]').getByText('Develop the current story outline in the editor.', { exact: false }).first().waitFor()
      await planner.getByRole('button', { name: 'New conversation', exact: true }).click()
      const composer = planner.getByRole('textbox', { name: 'Request for the professional assistant', exact: true })
      await expect.poll(() => composer.isEnabled(), UI_WAIT).toBe(true)
      await composer.fill('Keep this draft in the second conversation.')
      await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
      const conversations = planner.getByRole('navigation', { name: 'Conversations', exact: true })
      await expect.poll(() => conversations.getByRole('button').count(), UI_WAIT).toBe(2)
      await conversations.getByRole('button').nth(1).click()
      await planner.getByText('The outline is ready to apply.', { exact: true }).waitFor()
      expect(await composer.inputValue()).toBe('')
      await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
      await conversations.getByRole('button').first().click()
      await expect.poll(() => composer.inputValue(), UI_WAIT).toBe('Keep this draft in the second conversation.')
      expect(requests).toHaveLength(1)
      await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
      await conversations.getByRole('button').nth(1).click()
      await planner.getByText('The outline is ready to apply.', { exact: true }).waitFor()
      const result = await captureStableAria(page, WORKSPACE, scaffold.workspaceCwd)
      const expected = fileURLToPath(new URL('./expected/multica-outline', import.meta.url))
      if (scaffold.mode === 'refresh') await mkdir(expected, { recursive: true })
      await compareOrRefreshGolden(join(expected, 'applied.expected.md'), result, scaffold.mode)
      if (process.env.DSH_MULTICA_QA_DIR) {
        await mkdir(process.env.DSH_MULTICA_QA_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.DSH_MULTICA_QA_DIR, 'outline-applied.png'), fullPage: true })
        await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
        await planner.locator('[data-conversation-scroll]').evaluate((element) => { element.scrollTop = 0 })
        await page.screenshot({ path: join(process.env.DSH_MULTICA_QA_DIR, 'conversation-list.png'), fullPage: true })
        await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
      }
      const warningStart = tripwire.warnings.length
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Comics', exact: true }).click()
      await page.getByRole('article', { name: project.name, exact: true }).getByRole('button', { name: 'Open project', exact: true }).click()
      await expect.poll(() => outline.inputValue(), UI_WAIT).toBe(generated)
      await planner.getByRole('button', { name: 'Conversations', exact: true }).click()
      await conversations.getByRole('button').nth(1).click()
      await planner.getByText('The outline is ready to apply.', { exact: true }).waitFor()
      acknowledgeReloadConnectionLoss(tripwire, warningStart)
      expect(requests).toHaveLength(1)
      expect(tripwire.warnings).toEqual([])
      expect(tripwire.pageErrors).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
