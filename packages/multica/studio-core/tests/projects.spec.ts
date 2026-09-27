import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StudioProjects, { SCHEMA_VERSION } from '../src/index.ts'
import type { Config, EpisodeId, Project, ProjectId, ProjectInput } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
const connections: DatabaseSync[] = []

afterEach(async () => {
  for (const db of connections.splice(0)) db.close()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-studio-core-'))
  roots.push(path)
  return path
}

function input(patch: Partial<ProjectInput> = {}): ProjectInput {
  return {
    name: '海边来信',
    concept: 'A lighthouse keeper receives letters from tomorrow.',
    sourceText: '',
    aspectRatio: '16:9',
    targetEpisodes: null,
    episodeDuration: null,
    outline: '',
    episodes: [],
    ...patch,
  }
}

async function mount(home: string, config: Config = {}): Promise<{ ctx: Context; projects: StudioProjects }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: home, ...config })
  return { ctx, projects: ctx.studioProjects }
}

function inspect(home: string): DatabaseSync {
  const db = new DatabaseSync(join(home, 'multica/studio.sqlite'))
  connections.push(db)
  return db
}

function episode(title = 'Arrival'): ProjectInput['episodes'][number] {
  return { id: randomUUID() as EpisodeId, title, script: 'The keeper opens the envelope.' }
}

describe('Multica immutable project storage', () => {
  it('persists custom covers independently of text revisions and rejects stale, invalid and archived uploads', async () => {
    const home = await root()
    const { projects, ctx } = await mount(home, { maxCoverBytes: 128 })
    const first = projects.create(input())
    const other = projects.create(input({ name: 'Other project' }))
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    expect(projects.coverUploadLimit()).toBe(128)
    expect(projects.setCover(first.id, 0, image)).toEqual({ revision: 1, image })
    expect(() => projects.setCover(first.id, 0, null)).toThrow('changed')
    expect(() => projects.setCover(first.id, 1, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow('PNG')
    expect(() => projects.setCover(first.id, 1, 'data:image/png;base64,eA==')).toThrow('invalid')
    expect(() => projects.setCover(first.id, 1, `data:image/png;base64,${'A'.repeat(256)}`)).toThrow()
    expect(projects.history(first.id)).toEqual([first])
    expect(projects.list().find(p => p.id === other.id)?.cover).toEqual({ revision: 0, image: null })
    await ctx.fiber.dispose()
    const reopened = (await mount(home)).projects
    expect(reopened.list().find(p => p.id === first.id)?.cover).toEqual({ revision: 1, image })
    expect(reopened.setCover(first.id, 1, null)).toEqual({ revision: 2, image: null })
    reopened.setArchived(first.id, 1, true)
    expect(() => reopened.setCover(first.id, 2, image)).toThrow('active')
    expect(() => reopened.setCover(randomUUID() as ProjectId, 0, image)).toThrow('active')
  })

  it('sorts equal-time projects by ID and keeps update timestamps monotonic when the clock moves backward', async () => {
    const { projects } = await mount(await root())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = projects.create(input())
    const second = projects.create(input())
    expect(projects.list().map(project => project.id)).toEqual([first.id, second.id].sort())
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))
    const olderClock = projects.save(first.id, 1, input()).project
    expect(olderClock.updatedAt).toBe(first.updatedAt)
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    projects.save(second.id, 1, input())
    expect(projects.list().map(project => project.id)).toEqual([second.id, first.id])
  })

  it('restores a stopped-server backup copy including archived history and episode ownership', async () => {
    const source = await root()
    const backup = await root()
    const { ctx, projects } = await mount(source)
    const draft = input({ episodes: [episode()] })
    const first = projects.create(draft)
    const second = projects.save(first.id, 1, { ...draft, outline: 'Saved outline' }).project
    const archived = projects.setArchived(first.id, 2, true).project
    await ctx.fiber.dispose()
    await cp(join(source, 'multica'), join(backup, 'multica'), { recursive: true })
    const restored = (await mount(backup)).projects
    expect(restored.history(first.id)).toEqual([first, second, archived])
    expect(restored.get(first.id)).toEqual(archived)
    expect(() => restored.create(draft)).toThrow('another Multica project')
    expect(restored.setArchived(first.id, 3, false).project).toMatchObject({ revision: 4, archived: false })
    expect((await mount(source)).projects.get(first.id)).toEqual(archived)
  })

  it('persists the current database schema and reopens full project and episode revisions', async () => {
    const home = await root()
    const { ctx, projects } = await mount(home)
    const draft = input({ episodes: [episode()], sourceText: 'Imported source', targetEpisodes: 3, episodeDuration: 30.5 })
    const first = projects.create(draft)
    const edited = input({ ...draft, outline: 'A storm closes the harbor.', episodes: [{ ...draft.episodes[0]!, script: 'New script' }] })
    const second = projects.save(first.id, first.revision, edited)
    expect(second.status).toBe('saved')
    expect(second.project.revision).toBe(2)
    expect(second.project.createdAt).toBe(first.createdAt)
    expect(new Date(first.createdAt).toISOString()).toBe(first.createdAt)
    const bytes = await readFile(join(home, 'multica/studio.sqlite'))
    expect(bytes.subarray(0, 16).toString()).toBe('SQLite format 3\0')
    const db = inspect(home)
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_revisions').get()?.n).toBe(2)
    await ctx.fiber.dispose()
    const reopened = (await mount(home)).projects
    expect(reopened.get(first.id)).toEqual(second.project)
    expect(reopened.history(first.id)).toEqual([first, second.project])
    expect(reopened.list()).toEqual([
      {
        id: first.id,
        cover: { revision: 0, image: null },
        name: first.name,
        concept: first.concept,
        aspectRatio: first.aspectRatio,
        targetEpisodes: 3,
        episodeDuration: 30.5,
        episodeCount: 1,
        archived: false,
        revision: 2,
        createdAt: first.createdAt,
        updatedAt: second.project.updatedAt,
      },
    ])
  })

  it('uses database revision state across connections and preserves both drafts on conflict', async () => {
    const home = await root()
    const left = (await mount(home)).projects
    const right = (await mount(home)).projects
    const original = left.create(input())
    const pending = input({ outline: 'Unsaved local draft' })
    const winner = left.save(original.id, 1, input({ outline: 'Committed elsewhere' }))
    expect(right.save(original.id, 1, pending)).toEqual({ status: 'conflict', project: winner.project })
    expect(pending.outline).toBe('Unsaved local draft')
    expect(right.history(original.id)).toEqual([original, winner.project])
    expect(right.setArchived(original.id, 1, true)).toEqual({ status: 'conflict', project: winner.project })
  })

  it('archives read-only and restores as a new immutable revision with unchanged content', async () => {
    const { projects } = await mount(await root())
    const first = projects.create(input({ episodes: [episode()] }))
    const archived = projects.setArchived(first.id, 1, true)
    expect(archived.project).toMatchObject({ archived: true, revision: 2, episodes: first.episodes })
    expect(projects.save(first.id, 1, input())).toEqual({ status: 'conflict', project: archived.project })
    expect(projects.save(first.id, 2, input())).toEqual({ status: 'archived', project: archived.project })
    expect(projects.setArchived(first.id, 2, true)).toEqual(archived)
    const restored = projects.setArchived(first.id, 2, false)
    expect(restored.project).toMatchObject({ archived: false, revision: 3, episodes: first.episodes })
    const fourth = projects.save(first.id, 3, input({ outline: 'After restoration' }))
    expect(fourth.project.revision).toBe(4)
    expect(projects.history(first.id)).toEqual([first, archived.project, restored.project, fourth.project])
  })

  it('keeps permanent episode ownership after removal and rolls back partial claims', async () => {
    const home = await root()
    const { projects } = await mount(home)
    const owned = episode()
    const first = projects.create(input({ episodes: [owned] }))
    const second = projects.create(input({ name: 'Another project' }))
    projects.save(first.id, 1, input())
    const fresh = episode()
    expect(() => projects.save(second.id, 1, input({ episodes: [fresh, owned] }))).toThrow('another Multica project')
    expect(projects.get(second.id)).toEqual(second)
    expect(projects.history(second.id)).toEqual([second])
    expect(inspect(home).prepare('SELECT * FROM episode_owners WHERE episode_id = ?').get(fresh.id)).toBeUndefined()
    expect(() => projects.create(input({ episodes: [owned] }))).toThrow('another Multica project')
    expect(projects.list()).toHaveLength(2)
    const restored = projects.save(first.id, 2, input({ episodes: [owned] }))
    expect(restored.project.episodes).toEqual([owned])
    expect(projects.history(first.id)[0]?.episodes).toEqual([owned])
  })

  it('returns detached documents and preserves episode identity and order across drafts', async () => {
    const { projects } = await mount(await root())
    const draft = input({ episodes: [episode('First'), episode('Second')] })
    const first = projects.create(draft)
    draft.episodes[0]!.script = 'Input mutation'
    first.episodes[0]!.script = 'Result mutation'
    const stored = projects.get(first.id)!
    expect(stored.episodes[0]!.script).toBe('The keeper opens the envelope.')
    const reordered = projects.save(first.id, 1, input({ episodes: [...stored.episodes].reverse() }))
    expect(reordered.project.episodes.map(value => value.id)).toEqual(stored.episodes.map(value => value.id).reverse())
    const history = projects.history(first.id)
    history[0]!.name = 'Mutation'
    expect(projects.history(first.id)[0]!.name).toBe('海边来信')
  })

  it('rejects direct SQL changes to revisions and episode ownership', async () => {
    const home = await root()
    const { projects } = await mount(home)
    projects.create(input({ episodes: [episode()] }))
    const db = inspect(home)
    expect(() => {
      db.exec('DELETE FROM project_revisions')
    }).toThrow('immutable')
    expect(() => {
      db.exec("UPDATE project_revisions SET document = '{}'")
    }).toThrow('immutable')
    expect(() => {
      db.exec('DELETE FROM episode_owners')
    }).toThrow('permanent')
    expect(() => {
      db.exec("UPDATE episode_owners SET episode_id = 'changed'")
    }).toThrow('permanent')
  })

  it('returns empty reads for unknown projects and rejects missing-project writes', async () => {
    const { projects } = await mount(await root())
    const missing = randomUUID() as ProjectId
    expect(projects.get(missing)).toBeNull()
    expect(projects.history(missing)).toEqual([])
    expect(projects.list()).toEqual([])
    expect(() => projects.save(missing, 1, input())).toThrow('not found')
    expect(() => projects.setArchived(missing, 1, true)).toThrow('not found')
  })

  it.each([
    { name: '' },
    { name: ' \n ' },
    { name: '文'.repeat(51) },
    { concept: '文'.repeat(3001) },
    { aspectRatio: '4:3' },
    { sourceText: 1 },
    { outline: null },
    { targetEpisodes: 0 },
    { targetEpisodes: 1.5 },
    { targetEpisodes: Number.MAX_SAFE_INTEGER + 1 },
    { episodeDuration: -1 },
    { episodeDuration: 0 },
    { episodeDuration: Infinity },
    { episodeDuration: NaN },
    { archived: true },
    { episodes: [{ id: 'bad', title: '', script: '' }] },
    { episodes: [{ id: randomUUID(), title: 'Missing script' }] },
  ])('rejects invalid wire content without persisting it: %j', async (patch) => {
    const { projects } = await mount(await root())
    const valid = projects.create(input())
    const invalid = { ...input(), ...patch } as unknown as ProjectInput
    expect(() => projects.create(invalid)).toThrow()
    expect(() => projects.save(valid.id, 1, invalid)).toThrow()
    expect(projects.list()).toHaveLength(1)
    expect(projects.history(valid.id)).toEqual([valid])
  })

  it('validates required fields, UUIDs, duplicate episodes, revision and boolean wire arguments', async () => {
    const { projects } = await mount(await root())
    const duplicate = episode()
    expect(() => projects.create(input({ episodes: [duplicate, duplicate] }))).toThrow('unique')
    expect(() => projects.create(input({ episodes: [{ ...duplicate, id: duplicate.id.toUpperCase() as EpisodeId }] }))).toThrow()
    const incomplete: Partial<ProjectInput> = input()
    delete incomplete.outline
    expect(() => projects.create(incomplete as ProjectInput)).toThrow()
    const first = projects.create(input({ name: '🌊'.repeat(50), concept: '🌊'.repeat(3000) }))
    for (const revision of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => projects.save(first.id, revision, input())).toThrow()
      expect(() => projects.setArchived(first.id, revision, true)).toThrow()
    }
    for (const id of ['invalid', first.id.toUpperCase()]) {
      expect(() => projects.get(id as ProjectId)).toThrow()
      expect(() => projects.history(id as ProjectId)).toThrow()
    }
    expect(() => projects.setArchived(first.id, 1, 'false' as unknown as boolean)).toThrow()
    expect(projects.history(first.id)).toEqual([first])
  })

  it.each(['columns', 'json', 'timestamp', 'ownership', 'duplicate'])(
    'rejects durable corruption consistently for every reader and writer: %s',
    async (kind) => {
      const home = await root()
      const { projects } = await mount(home)
      const first = projects.create(input({ episodes: [episode()] }))
      const second = projects.save(first.id, 1, input({ episodes: first.episodes }))
      const db = inspect(home)
      db.exec('DROP TRIGGER immutable_revision_update; DROP TRIGGER immutable_revision_delete')
      const corrupt: Record<string, unknown> = { ...second.project }
      if (kind === 'columns') corrupt.revision = 9
      if (kind === 'json') corrupt.outline = 42
      if (kind === 'timestamp') corrupt.updatedAt = 'not-a-date'
      if (kind === 'ownership') corrupt.episodes = [episode()]
      if (kind === 'duplicate') corrupt.episodes = [first.episodes[0], first.episodes[0]]
      db.prepare('UPDATE project_revisions SET document = ? WHERE revision = 2').run(JSON.stringify(corrupt))
      expect(() => projects.get(first.id)).toThrow()
      expect(() => projects.list()).toThrow()
      expect(() => projects.history(first.id)).toThrow()
      expect(() => projects.save(first.id, 2, input())).toThrow()
      expect(() => projects.setArchived(first.id, 2, true)).toThrow()
      expect(db.prepare('SELECT document FROM project_revisions WHERE revision = 1').get()?.document).toBe(JSON.stringify(first))
    },
  )

  it.each(['gap', 'creation-time', 'update-time', 'invalid-old-json'])(
    'checks historical continuity only when history is requested: %s',
    async (kind) => {
      const home = await root()
      const { projects } = await mount(home)
      const first = projects.create(input())
      const second = projects.save(first.id, 1, input({ outline: 'Latest body' })).project
      const db = inspect(home)
      db.exec('DROP TRIGGER immutable_revision_update; DROP TRIGGER immutable_revision_delete')
      const corrupt: Record<string, unknown> = { ...first }
      if (kind === 'gap') db.exec('DELETE FROM project_revisions WHERE revision = 1')
      else {
        if (kind === 'creation-time') corrupt.createdAt = '2000-01-01T00:00:00.000Z'
        if (kind === 'update-time') corrupt.updatedAt = '9999-01-01T00:00:00.000Z'
        if (kind === 'invalid-old-json') corrupt.outline = 42
        db.prepare('UPDATE project_revisions SET document = ? WHERE revision = 1').run(JSON.stringify(corrupt))
      }
      expect(projects.get(first.id)).toEqual(second)
      expect(projects.list()).toMatchObject([{ id: first.id, revision: 2 }])
      expect(() => projects.history(first.id)).toThrow()
    },
  )

  it('rejects empty revision histories and malformed JSON even when SQLite checks are bypassed', async () => {
    const home = await root()
    const { projects } = await mount(home)
    const first = projects.create(input())
    const db = inspect(home)
    db.exec('DROP TRIGGER immutable_revision_update; PRAGMA ignore_check_constraints = ON')
    db.exec("UPDATE project_revisions SET document = '{'")
    expect(() => projects.get(first.id)).toThrow()
    db.exec('DROP TRIGGER immutable_revision_delete; DELETE FROM project_revisions')
    expect(() => projects.get(first.id)).toThrow('no revisions')
    expect(() => projects.history(first.id)).toThrow('no revisions')
    expect(() => projects.list()).toThrow('no revisions')
  })

  it('releases the database and service on plugin disposal', async () => {
    const home = await root()
    const { ctx, projects } = await mount(home)
    const first = projects.create(input())
    await ctx.fiber.dispose()
    expect(ctx.get('studioProjects')).toBeUndefined()
    expect(() => projects.list()).toThrow()
    expect((await mount(home)).projects.get(first.id)).toEqual(first)
  })

  it('boots a cordis.yml through Loader with no agent service and saves durable output', async () => {
    const home = await root()
    const configPath = join(home, 'cordis.yml')
    await writeFile(configPath, '- name: "@deepseek-ai/dsh-studio-core"\n')
    vi.stubEnv('DSH_HOME', home)
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = `${pathToFileURL(home).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-studio-core') throw new Error(`Unexpected import: ${specifier}`)
        return { default: StudioProjects }
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const projects = ctx.studioProjects
    expect(projects.typertRemote).toMatchObject({ serviceKey: 'studioProjects', namespace: 'studioProjects' })
    expect(remoteMethods(projects).map(method => method.method)).toEqual([
      'actorLibraries', 'createActorLibrary', 'libraryActors', 'libraryActor', 'saveLibraryActor', 'exportActorLibrary', 'importActorLibrary',
      'scriptDocuments', 'scriptDocument', 'saveScriptDocument', 'scriptComplete', 'completeScript', 'productionUnits',
      'createProductionUnit', 'canvasNodes', 'addCanvasNode', 'moveCanvasNode', 'projectMedia', 'importProjectMedia', 'projectMediaData',
      'projectFolders', 'openFolder', 'prepareFolder', 'closeFolder', 'forgetFolder', 'revealFolder', 'migrateProject', 'backupFolder', 'saveEditorDraft', 'editorDraft',
      'list',
      'coverUploadLimit',
      'setCover',
      'get',
      'create',
      'save',
      'setArchived',
      'history',
      'creationDrafts',
      'creationDraft',
      'saveCreationDraft',
      'createFromDraft',
      'assistantCatalog',
      'roles',
      'publishRole',
      'openWorkspace',
      'workspace',
      'startAssistant',
      'waitTask',
      'cancelAssistant',
      'applyProposal',
      'ignoreProposal',
      'setFieldLocks',
      'submitReview',
      'reviews',
      'reviewQueue',
      'decideReview',
    ])
    expect(ctx.get('agents')).toBeUndefined()
    const first = projects.create(input())
    const archived = projects.setArchived(first.id, 1, true).project
    const restored = projects.setArchived(first.id, 2, false).project
    expect(projects.history(first.id)).toEqual([first, archived, restored])
    const db = inspect(home)
    const stored = db
      .prepare('SELECT document FROM project_revisions ORDER BY revision')
      .all()
      .map(row => JSON.parse(row.document as string) as Project)
    expect(stored).toEqual([first, archived, restored])
  })
})
