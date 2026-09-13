import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StudioProjects from '../src/index.ts'
import { openDatabase, transaction, SCHEMA_VERSION } from '../src/database.ts'
import type { Config, ProjectInput } from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []
const connections: DatabaseSync[] = []

afterEach(async () => {
  for (const db of connections.splice(0)) db.close()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-studio-database-'))
  roots.push(value)
  return value
}

function connect(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  connections.push(db)
  return db
}

function service(config: Config): StudioProjects {
  const ctx = new Context()
  contexts.push(ctx)
  return new StudioProjects(ctx, config)
}

const input: ProjectInput = {
  name: 'Project',
  concept: '',
  sourceText: '',
  aspectRatio: '1:1',
  targetEpisodes: 12,
  episodeDuration: null,
  outline: '',
  episodes: [],
}

describe('Multica SQLite configuration and failure recovery', () => {
  it('resolves database files inside explicit home and does not create target episodes', async () => {
    const home = await root()
    const projects = service({ dshHome: home, databasePath: 'custom/projects.sqlite', busyTimeoutMs: 0 })
    const first = projects.create(input)
    expect(first.episodes).toEqual([])
    expect(first.targetEpisodes).toBe(12)
    const db = connect(join(home, 'custom/projects.sqlite'))
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_revisions').get()?.n).toBe(1)
    expect(service({ dshHome: home, databasePath: join(home, 'custom/projects.sqlite') }).get(first.id)).toEqual(first)
  })

  it('uses DSH_HOME when omitted and honors explicit home over the environment', async () => {
    const envHome = await root()
    const explicit = await root()
    vi.stubEnv('DSH_HOME', envHome)
    const implicitProject = service({}).create(input)
    expect(service({ dshHome: explicit }).list()).toEqual([])
    expect(service({ dshHome: envHome }).get(implicitProject.id)).toEqual(implicitProject)
  })

  it.each(['..', '../outside.sqlite', '', '.'])('rejects a database path that does not name a child file: %j', async (databasePath) => {
    const home = await root()
    expect(() => service({ dshHome: home, databasePath })).toThrow()
  })

  it.each([-1, 1.5, Infinity, NaN, 2_147_483_648])('rejects invalid busy timeout %s', async (busyTimeoutMs) => {
    const home = await root()
    expect(() => service({ dshHome: home, busyTimeoutMs })).toThrow()
  })

  it('applies the configured lock wait and rejects a competing transaction without partial writes', async () => {
    const home = await root()
    const path = join(home, 'studio.sqlite')
    const first = openDatabase(path, 0)
    connections.push(first)
    const second = openDatabase(path, 1234)
    connections.push(second)
    expect(second.prepare('PRAGMA busy_timeout').get()?.timeout).toBe(1234)
    expect(first.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
    expect(first.prepare('PRAGMA synchronous').get()?.synchronous).toBe(2)
    expect(first.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1)
    second.exec('BEGIN IMMEDIATE')
    try {
      expect(() => {
        transaction(first, () => {
          first.exec("INSERT INTO projects (id) VALUES ('must-not-appear')")
        })
      }).toThrow(/locked/)
    } finally {
      second.exec('ROLLBACK')
    }
    expect(first.prepare('SELECT * FROM projects').all()).toEqual([])
    expect(transaction(first, () => 'recovered')).toBe('recovered')
  })

  it.each(['future', 'foreign', 'unstamped', 'missing-table', 'foreign-key'])(
    'refuses incompatible or corrupt databases without replacing user data: %s',
    async (kind) => {
      const home = await root()
      const path = join(home, 'studio.sqlite')
      const db = openDatabase(path, 0)
      db.close()
      const corrupt = new DatabaseSync(path)
      if (kind === 'future') corrupt.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
      if (kind === 'foreign') corrupt.exec('PRAGMA application_id = 1234')
      if (kind === 'unstamped') corrupt.exec('PRAGMA user_version = 0; PRAGMA application_id = 0')
      if (kind === 'missing-table') corrupt.exec('DROP TABLE episode_owners')
      if (kind === 'foreign-key') {
        corrupt.exec("PRAGMA foreign_keys = OFF; INSERT INTO episode_owners VALUES ('orphan', 'missing')")
      }
      corrupt.close()
      const before = await readFile(path)
      expect(() => openDatabase(path, 0)).toThrow()
      expect(await readFile(path)).toEqual(before)
      const probe = connect(path)
      expect(probe.prepare('SELECT name FROM sqlite_master WHERE name = ?').get('project_revisions')?.name).toBe('project_revisions')
    },
  )

  it('refuses arbitrary existing SQLite files and non-database bytes', async () => {
    const home = await root()
    const path = join(home, 'other.sqlite')
    const db = new DatabaseSync(path)
    db.exec("CREATE TABLE unrelated (content TEXT); INSERT INTO unrelated VALUES ('preserve')")
    db.close()
    expect(() => openDatabase(path, 0)).toThrow('Unsupported')
    expect(connect(path).prepare('SELECT content FROM unrelated').get()?.content).toBe('preserve')
    const textPath = join(home, 'plain.txt')
    await writeFile(textPath, 'Keep these bytes')
    expect(() => openDatabase(textPath, 0)).toThrow()
    expect(await readFile(textPath, 'utf8')).toBe('Keep these bytes')
  })

  it('propagates filesystem errors and rolls back a failed operation', async () => {
    const home = await root()
    const path = join(home, 'directory')
    await mkdir(path)
    expect(() => openDatabase(path, 0)).toThrow()
    const parentFile = join(home, 'file')
    await writeFile(parentFile, 'parent')
    expect(() => openDatabase(join(parentFile, 'database.sqlite'), 0)).toThrow()
    expect(() => openDatabase(join(home, 'x'.repeat(300)), 0)).toThrow()
    const db = openDatabase(join(home, 'ok.sqlite'), 0)
    connections.push(db)
    expect(() =>
      transaction(db, () => {
        db.exec("INSERT INTO projects VALUES ('rollback')")
        throw new Error('test failure')
      }),
    ).toThrow('test failure')
    expect(db.prepare('SELECT * FROM projects').all()).toEqual([])
  })
})
