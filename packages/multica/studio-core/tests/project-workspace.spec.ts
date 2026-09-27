import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rename, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import StudioProjects from '../src/index.ts'
import type { EpisodeId, ProjectInput, StudioCreationId } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'multica-workspace-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: join(root, 'home') })
  const input: ProjectInput = { name: 'Lighthouse', concept: 'A reel is missing', sourceText: '',
    aspectRatio: '16:9', targetEpisodes: null, episodeDuration: null, outline: '', episodes: [] }
  const creation = randomUUID() as StudioCreationId
  const folder = await ctx.studioProjects.prepareFolder(join(root, 'project'), creation, input)
  const project = ctx.studioProjects.createFromDraft(creation, 1, input)
  return { root, ctx, folder, project, input, service: ctx.studioProjects }
}

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='

it('materializes saved scripts as Markdown, then unlocks production only after explicit completion', async () => {
  const f = await fixture()
  const initial = f.service.scriptDocuments(f.project.id)
  expect(initial.map(item => item.title)).toEqual(['故事大纲.md', '人物小传.md'])
  expect(await readFile(join(f.folder.path, 'scripts', '故事大纲.md'), 'utf8')).toBe('# 故事大纲\n\n')
  expect(() => f.service.completeScript(f.project.id, 1)).toThrow('Complete')
  expect(() => f.service.createProductionUnit(f.project.id, 'whole', null, 'MV')).toThrow('Confirm')
  const episodeId = randomUUID() as EpisodeId
  f.service.save(f.project.id, 1, { ...f.input, outline: 'The reel reveals the truth',
    episodes: [{ id: episodeId, title: 'Arrival', script: 'Mira enters the cinema.' }] })
  const documents = f.service.scriptDocuments(f.project.id)
  expect(documents.map(item => item.title)).toEqual(['故事大纲.md', '人物小传.md', '第01集剧本.md'])
  expect(await readFile(join(f.folder.path, 'scripts', 'episodes', `${episodeId}.md`), 'utf8'))
    .toBe('# Arrival\n\nMira enters the cinema.')
  const biography = f.service.saveScriptDocument(f.project.id, documents[1]!.id, 1, '# 人物小传\n\nMira keeps the keys.')
  expect(biography.revision).toBe(2)
  expect(() => f.service.saveScriptDocument(f.project.id, documents[1]!.id, 1, 'stale')).toThrow('changed')
  expect(f.service.completeScript(f.project.id, 2)).toBe(true)
  expect(f.service.scriptComplete(f.project.id)).toBe(true)
  const episodeUnit = f.service.createProductionUnit(f.project.id, 'episode', episodeId, '第01集 · 序章')
  const whole = f.service.createProductionUnit(f.project.id, 'whole', null, '整片 · MV')
  expect(f.service.productionUnits(f.project.id).map(unit => unit.title)).toEqual(['第01集 · 序章', '整片 · MV'])
  expect(f.service.canvasNodes(f.project.id, episodeUnit.id)).toMatchObject([{ kind: 'script', label: 'Arrival' }])
  expect(f.service.canvasNodes(f.project.id, whole.id)).toMatchObject([{ kind: 'script', label: '完整剧本' }])
  f.service.saveScriptDocument(f.project.id, documents[0]!.id, 2, '# 故事大纲\n\nA changed ending')
  expect(f.service.scriptComplete(f.project.id)).toBe(false)
})

it('persists canvas nodes and playable project-local media without accepting arbitrary paths', async () => {
  const f = await fixture()
  const episodeId = randomUUID() as EpisodeId
  f.service.save(f.project.id, 1, { ...f.input, outline: 'Outline',
    episodes: [{ id: episodeId, title: 'Arrival', script: 'Script' }] })
  f.service.completeScript(f.project.id, 2)
  const unit = f.service.createProductionUnit(f.project.id, 'episode', episodeId, 'Arrival')
  const original = f.service.canvasNodes(f.project.id, unit.id)[0]!
  expect(f.service.moveCanvasNode(f.project.id, unit.id, original.id, 1, 245, -30)).toMatchObject({ x: 245, y: -30, revision: 2 })
  expect(() => f.service.moveCanvasNode(f.project.id, unit.id, original.id, 1, 0, 0)).toThrow('changed')
  expect(() => f.service.importProjectMedia(f.project.id, unit.id, 'bad.png', 'data:image/png;base64,QQ==')).toThrow('match')
  const asset = f.service.importProjectMedia(f.project.id, unit.id, 'reference.png', png)
  expect(f.service.projectMedia(f.project.id)).toMatchObject([{ id: asset.id, kind: 'image' }])
  expect(f.service.projectMediaData(f.project.id, asset.id)).toBe(png)
  expect(f.service.canvasNodes(f.project.id, unit.id).some(node => node.assetId === asset.id)).toBe(true)
  const artifactRoot = join(f.folder.path, 'artifacts')
  await rename(artifactRoot, `${artifactRoot}.saved`)
  await symlink(`${artifactRoot}.saved`, artifactRoot)
  expect(() => f.service.projectMediaData(f.project.id, asset.id)).toThrow('regular directory')
  expect(() => f.service.importProjectMedia(f.project.id, unit.id, 'another.png', png)).toThrow('regular directory')
  await rm(artifactRoot)
  await rename(`${artifactRoot}.saved`, artifactRoot)
  await f.service.closeFolder(f.folder.id)
  f.service.openFolder(f.folder.path)
  expect(f.service.canvasNodes(f.project.id, unit.id)).toHaveLength(2)
  expect(f.service.projectMediaData(f.project.id, asset.id)).toBe(png)
})
