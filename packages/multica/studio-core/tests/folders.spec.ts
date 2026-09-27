import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import StudioProjects from '../src/index.ts'
import type { ProjectInput, StudioCreationId } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'multica-portable-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: join(root, 'home') })
  return { root, ctx, projects: ctx.studioProjects }
}
const input: ProjectInput = { name: 'Letters', concept: 'A lighthouse story', sourceText: 'Source', aspectRatio: '16:9', targetEpisodes: null, episodeDuration: null, outline: '', episodes: [] }
async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID() as StudioCreationId
  const folder = await f.projects.prepareFolder(join(f.root, 'work'), id, input)
  const project = f.projects.createFromDraft(id, 1, input)
  return { folder, project }
}

it('opens a copied project with no original home, preserving revisions, reviews, covers and recovery drafts', async () => {
  const a = await fixture()
  const { folder, project } = await create(a)
  a.projects.save(project.id, 1, { ...input, outline: 'Saved outline' })
  const review = a.projects.submitReview({ kind: 'outline', projectId: project.id }, 2)
  a.projects.decideReview(review.id, 'approved', 'Ready')
  a.projects.saveEditorDraft(project.id, 2, { ...input, outline: 'Unpublished edit' })
  await a.projects.closeFolder(folder.id)
  const b = await fixture()
  const destination = join(b.root, 'different-path')
  await cp(folder.path, destination, { recursive: true })
  await a.ctx.fiber.dispose()
  await rm(join(a.root, 'home'), { recursive: true, force: true })
  const reopened = b.projects.openFolder(destination)
  expect(reopened.id).toBe(folder.id)
  expect(reopened.projectId).toBe(project.id)
  expect(b.projects.history(project.id)).toHaveLength(2)
  expect(b.projects.reviews(project.id)[0]?.status).toBe('approved')
  expect(b.projects.editorDraft(project.id)?.input.outline).toBe('Unpublished edit')
  expect(b.projects.get(project.id)?.outline).toBe('Saved outline')
  b.projects.save(project.id, 2, { ...input, outline: 'Edited on B' })
  expect(b.projects.history(project.id)).toHaveLength(3)
})

it('refuses a second writer and releases ownership after closing', async () => {
  const a = await fixture()
  const { folder } = await create(a)
  const b = await fixture()
  expect(() => b.projects.openFolder(folder.path)).toThrow()
  await a.projects.closeFolder(folder.id)
  expect(b.projects.openFolder(folder.path).id).toBe(folder.id)
})

it('holds project ownership against an independent process until close completes', async () => {
  const a = await fixture()
  const { folder } = await create(a)
  const probe = async () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    try {
      db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
      console.log('open');
    } catch (error) {
      if (error.errcode !== 5) throw error;
      console.log('busy');
    } finally { db.close(); }
  `, join(folder.path, '.multica-lock.sqlite')])
  expect((await probe()).stdout.trim()).toBe('busy')
  await a.projects.closeFolder(folder.id)
  expect((await probe()).stdout.trim()).toBe('open')
})

it('persists catalog removal across restarts while preserving the folder and project identity', async () => {
  const a = await fixture()
  const { folder, project } = await create(a)
  await writeFile(join(folder.path, 'assets', 'reference.txt'), 'keep this asset')
  await a.projects.closeFolder(folder.id)
  const database = await readFile(join(folder.path, 'project.sqlite'))
  const manifest = await readFile(join(folder.path, 'multica.project.json'))
  a.projects.forgetFolder(folder.id)
  expect(a.projects.projectFolders()).toEqual([])
  expect(a.projects.list()).toEqual([])
  await a.ctx.fiber.dispose()
  const restarted = new Context()
  contexts.push(restarted)
  await restarted.plugin(StudioProjects, { dshHome: join(a.root, 'home') })
  expect(restarted.studioProjects.list()).toEqual([])
  expect(restarted.studioProjects.projectFolders()).toEqual([])
  expect(await readFile(join(folder.path, 'project.sqlite'))).toEqual(database)
  expect(await readFile(join(folder.path, 'multica.project.json'))).toEqual(manifest)
  expect(await readFile(join(folder.path, 'assets', 'reference.txt'), 'utf8')).toBe('keep this asset')
  expect(restarted.studioProjects.openFolder(folder.path).projectId).toBe(project.id)
  restarted.studioProjects.openFolder(folder.path)
  expect(restarted.studioProjects.projectFolders()).toHaveLength(1)
  expect(restarted.studioProjects.list().map(item => item.id)).toEqual([project.id])
  const catalog = new DatabaseSync(join(a.root, 'home', 'multica', 'studio.sqlite'), { readOnly: true })
  try {
    const rows = catalog.prepare('SELECT id, document, hidden FROM studio_locations').all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: folder.id, hidden: 0 })
    expect(JSON.parse(String(rows[0]?.document))).toMatchObject({ projectId: project.id, path: folder.path })
  } finally { catalog.close() }
})

it.each(['directory', 'database'] as const)('removes an open catalog entry with a missing %s without writing project files', async (missing) => {
  const a = await fixture()
  const { folder, project } = await create(a)
  const path = missing === 'directory' ? folder.path : join(folder.path, 'project.sqlite')
  const moved = `${path}.disconnected`
  const database = await readFile(join(folder.path, 'project.sqlite'))
  await rename(path, moved)
  try {
    expect(a.projects.projectFolders()[0]?.state).toBe('missing')
    a.projects.forgetFolder(folder.id)
    expect(a.projects.list()).toEqual([])
    expect(a.projects.projectFolders()).toEqual([])
  } finally {
    await rename(moved, path)
  }
  expect(await readFile(join(folder.path, 'project.sqlite'))).toEqual(database)
  expect(a.projects.get(project.id)?.name).toBe(input.name)
  a.projects.save(project.id, 1, { ...input, outline: 'Still open' })
  expect(a.projects.list()).toEqual([])
  expect(a.projects.projectFolders()).toEqual([])
  expect(a.projects.openFolder(folder.path).projectId).toBe(project.id)
  expect(a.projects.list().map(item => item.id)).toEqual([project.id])
  a.projects.forgetFolder(folder.id)
  await a.projects.closeFolder(folder.id)
  expect(a.projects.list()).toEqual([])
  expect(a.projects.openFolder(folder.path).projectId).toBe(project.id)
})

it('refuses missing databases, nonempty creation directories and duplicate project copies', async () => {
  const a = await fixture()
  const { folder } = await create(a)
  const destination = join(a.root, 'copy')
  await cp(folder.path, destination, { recursive: true })
  expect(() => a.projects.openFolder(destination)).toThrow('Another copy')
  const manifestPath = join(destination, 'multica.project.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { id: string }
  manifest.id = randomUUID()
  await writeFile(manifestPath, JSON.stringify(manifest))
  expect(() => a.projects.openFolder(destination)).toThrow('database identity')
  await expect(a.projects.prepareFolder(folder.path, randomUUID() as StudioCreationId, input)).rejects.toThrow('empty')
  await a.projects.closeFolder(folder.id)
  await rm(join(destination, 'project.sqlite'))
  expect(() => a.projects.openFolder(destination)).toThrow()
})

it('refuses writes after the mounted folder disappears without recreating it', async () => {
  const a = await fixture()
  const { folder, project } = await create(a)
  const moved = join(a.root, 'unmounted')
  await rename(folder.path, moved)
  expect(a.projects.projectFolders()[0]?.state).toBe('missing')
  expect(() => a.projects.save(project.id, 1, { ...input, outline: 'lost' })).toThrow()
  await rename(moved, folder.path)
  expect(a.projects.get(project.id)?.outline).toBe('')
})

it('copies one legacy project without unrelated works and retains the source', async () => {
  const a = await fixture()
  const first = a.projects.create(input)
  const other = a.projects.create({ ...input, name: 'Other' })
  a.projects.save(first.id, 1, { ...input, outline: 'Revision two' })
  const location = await a.projects.migrateProject(first.id, join(a.root, 'migrated'))
  const b = await fixture()
  await a.projects.closeFolder(location.id)
  b.projects.openFolder(location.path)
  expect(b.projects.list().map(project => project.id)).toEqual([first.id])
  expect(b.projects.history(first.id)).toHaveLength(2)
  expect(a.projects.get(other.id)?.name).toBe('Other')
  a.projects.forgetFolder(location.id)
  expect(a.projects.list().map(project => project.id)).toEqual([other.id])
  expect(() => a.projects.get(first.id)).toThrow('closed')
})

it('backs up assets and drafts, then closes the source before the copy is opened', async () => {
  const a = await fixture()
  const { folder, project } = await create(a)
  await writeFile(join(folder.path, 'assets', 'reference.txt'), 'portable source')
  const destination = join(a.root, 'backup')
  await a.projects.backupFolder(folder.id, destination)
  expect(a.projects.projectFolders()[0]?.state).toBe('closed')
  expect(a.projects.openFolder(destination).projectId).toBe(project.id)
})
