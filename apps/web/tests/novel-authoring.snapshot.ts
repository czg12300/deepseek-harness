/** Novel authoring through the shipped Web profile and a recorded, keyless model response. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import type {} from '@deepseek-ai/dsh-novel-core'

const ROOT = fileURLToPath(new URL('../../../snapshots/web/novel-authoring', import.meta.url))
const FIXTURE = join(ROOT, 'session.v3.jsonl')
const MODE = webSnapshotMode()

it('creates a novel, applies an Agent proposal in the editor, and reloads its saved text and conversation', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: FIXTURE,
    replayProviders: [{ id: 'mock', models: [{ id: 'creative' }] }],
    extraOverlayPath: join(ROOT, 'cordis.patch.yml'),
    compareReplaySession: true,
  })
  const browser = await chromium.launch()
  let page: Page | undefined
  const failures: unknown[] = []
  const diagnostics: string[] = []
  try {
    page = await newEnglishPage(browser)
    page.on('pageerror', error => diagnostics.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') diagnostics.push(message.text()) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const novels = page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Novels', exact: true })
    await novels.click()
    await page.getByRole('button', { name: 'Create novel', exact: true }).click()
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('The letter')
    await page.getByRole('textbox', { name: 'Synopsis', exact: true }).fill('A missing letter.')
    await page.getByRole('button', { name: 'Choose folder', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a folder on the Host' })
    await picker.getByRole('textbox', { name: 'Folder path' }).fill(scaffold.workspaceCwd)
    await picker.getByRole('button', { name: 'Choose this folder' }).click()
    await page.getByRole('button', { name: 'Create novel', exact: true }).click()
    await page.getByRole('heading', { name: 'Open a document to start writing' }).waitFor()
    await page.getByRole('button', { name: 'New document', exact: true }).first().click()
    const creation = page.getByRole('dialog', { name: 'New document' })
    await creation.getByRole('textbox', { name: 'Document title' }).fill('The quay')
    await creation.getByRole('button', { name: 'Save', exact: true }).click()
    const manuscript = page.getByRole('textbox', { name: 'Document text', exact: true })
    await manuscript.waitFor()
    await page.getByRole('textbox', { name: 'Tell the Agent how to change this document…' }).fill('Write the opening.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByText('The lamp reveals a new clue.', { exact: true }).waitFor()
    const project = scaffold.ctx.novelProjects.list().find(p => p.title === 'The letter')
    if (!project) throw new Error('The browser did not create its novel project')
    const document = scaffold.ctx.novelProjects.documents(project.id)[0]
    if (!document) throw new Error('The browser did not create its chapter')
    expect(scaffold.ctx.novelProjects.readDocument(project.id, document.id).content).toBe('')
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await manuscript.waitFor()
    await expect.poll(() => manuscript.inputValue()).toBe('The lamp went out before he could read the letter.')
    const db = new DatabaseSync(join(project.directory, '.novel/project.sqlite'), { readOnly: true })
    try {
      const stored = db.prepare("SELECT json_extract(data,'$.content') AS content FROM documents").get()
      expect(stored?.content).toBe('The lamp went out before he could read the letter.')
      expect(db.prepare('SELECT count(*) AS count FROM revisions').get()?.count).toBe(2)
    } finally { db.close() }
    const sessionId = scaffold.ctx.novelProjects.conversation(project.id, document.id).sessionId
    if (MODE === 'refresh' || MODE === 'record') await recordFixture(scaffold, sessionId, FIXTURE)
    await mkdir(ROOT, { recursive: true })
    await compareOrRefreshGolden(join(ROOT, 'ui.expected.md'), await captureStableAria(page, 'section[aria-label="Novels"]', scaffold.workspaceCwd), MODE)
    await page.reload({ waitUntil: 'load' })
    await novels.click()
    await page.getByRole('button', { name: 'The letter', exact: true }).click()
    await page.getByRole('button', { name: 'The quay', exact: true }).click()
    await expect.poll(() => manuscript.inputValue()).toBe('The lamp went out before he could read the letter.')
    await page.getByText('The lamp reveals a new clue.', { exact: true }).waitFor()
    const imageDirectory = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
    await mkdir(imageDirectory, { recursive: true })
    await page.screenshot({ path: join(imageDirectory, 'novel-authoring-success.png'), fullPage: true })
    await manuscript.fill('The author keeps the revised chapter and adds a final sentence.')
    await page.getByText('Saved · v3', { exact: true }).waitFor()
    expect(scaffold.ctx.novelProjects.readDocument(project.id, document.id).content)
      .toBe('The author keeps the revised chapter and adds a final sentence.')
  } catch (error) {
    if (page) await saveFailureShot(page, 'novel-authoring')
    failures.push(error)
    if (diagnostics.length) failures.push(new Error(diagnostics.slice(-10).join('\n')))
  } finally {
    await browser.close().catch((error: unknown) => failures.push(error))
    await scaffold.close().catch((error: unknown) => failures.push(error))
  }
  if (failures.length) throw new AggregateError(failures, 'Novel authoring scenario failed')
})
