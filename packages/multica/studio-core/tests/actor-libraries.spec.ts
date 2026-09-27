import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, expect, it } from 'vitest'
import StudioProjects from '../src/index.ts'
import type { ActorInput } from '../src/types.ts'

const contexts: Context[] = []
const homes: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'multica-actors-'))
  homes.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: home })
  return { home, ctx, service: ctx.studioProjects }
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const actor: ActorInput = { name: '林澈', description: '调查员', period: '现代', region: '中国', portrait: png, fullBody: png }

it('stores independent actor libraries with their own databases and relative image files', async () => {
  const f = await fixture()
  const a = f.service.createActorLibrary('主演员库')
  const b = f.service.createActorLibrary('配角库')
  const saved = f.service.saveLibraryActor(a.id, null, actor)
  expect(saved).toMatchObject(actor)
  expect(f.service.libraryActors(a.id, '林', '现代', '中国', 0)).toMatchObject({ total: 1, actors: [{ id: saved.id }] })
  expect(f.service.libraryActors(b.id, '', '', '', 0).total).toBe(0)
  expect(a.path).toBe(join(f.home, 'multica', 'actor', a.id))
  expect((await readFile(join(a.path, 'actor-library.json'), 'utf8'))).toContain(a.id)
  expect((await readFile(join(a.path, 'library.sqlite'))).length).toBeGreaterThan(0)
  expect((await readdir(join(a.path, 'assets', saved.id))).length).toBe(1)
})

it('exports a complete ZIP, installs it independently, and merges conflicts without overwriting actors', async () => {
  const a = await fixture()
  const source = a.service.createActorLibrary('来源')
  const original = a.service.saveLibraryActor(source.id, null, actor)
  const archive = a.service.exportActorLibrary(source.id)
  expect(archive.name).toContain(source.id)
  const bytes = Buffer.from(archive.dataUrl.split(',')[1]!, 'base64')
  const entries = unzipSync(bytes)
  expect(Object.keys(entries)).toContain('library.sqlite')
  expect(Object.keys(entries).some(key => key.startsWith(`assets/${original.id}/`))).toBe(true)
  const b = await fixture()
  const installed = b.service.importActorLibrary(archive.dataUrl, null)
  expect(installed.library.id).toBe(source.id)
  expect(b.service.libraryActor(source.id, original.id)?.portrait).toBe(png)
  b.service.saveLibraryActor(source.id, original.id, actor)
  expect(b.service.importActorLibrary(archive.dataUrl, source.id)).toMatchObject({ added: 0, skipped: 1, conflicts: 0 })
  const target = b.service.createActorLibrary('目标')
  expect(b.service.importActorLibrary(archive.dataUrl, target.id)).toMatchObject({ added: 1, conflicts: 0, skipped: 0 })
  expect(b.service.importActorLibrary(archive.dataUrl, target.id)).toMatchObject({ added: 0, conflicts: 0, skipped: 1 })
  a.service.saveLibraryActor(source.id, original.id, { ...actor, description: '侦探' })
  const next = a.service.exportActorLibrary(source.id)
  expect(b.service.importActorLibrary(next.dataUrl, target.id)).toMatchObject({ added: 1, conflicts: 1 })
  expect(b.service.importActorLibrary(next.dataUrl, target.id)).toMatchObject({ added: 0, skipped: 1 })
  expect(b.service.libraryActors(target.id, '', '', '', 0).total).toBe(2)
  expect(b.service.libraryActor(target.id, original.id)?.description).toBe('调查员')
})

it('rejects hostile ZIP entries and missing image bytes without modifying the destination', async () => {
  const f = await fixture()
  const source = f.service.createActorLibrary('来源')
  f.service.saveLibraryActor(source.id, null, actor)
  const target = f.service.createActorLibrary('目标')
  const entries = unzipSync(Buffer.from(f.service.exportActorLibrary(source.id).dataUrl.split(',')[1]!, 'base64'))
  const badPath = zipSync({ ...entries, '../outside.txt': strToU8('bad') })
  expect(() => f.service.importActorLibrary(`data:application/zip;base64,${Buffer.from(badPath).toString('base64')}`, target.id)).toThrow('unexpected')
  const image = Object.keys(entries).find(key => key.startsWith('assets/'))!
  const extra = zipSync({ ...entries, [`assets/${randomUUID()}/${image.split('/')[2]}`]: entries[image]! })
  expect(() => f.service.importActorLibrary(`data:application/zip;base64,${Buffer.from(extra).toString('base64')}`, target.id))
    .toThrow('unreferenced')
  const missing = zipSync(Object.fromEntries(Object.entries(entries).filter(([name]) => name !== image)))
  expect(() => f.service.importActorLibrary(`data:application/zip;base64,${Buffer.from(missing).toString('base64')}`, target.id)).toThrow('missing')
  expect(f.service.libraryActors(target.id, '', '', '', 0).total).toBe(0)
})
