import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it } from 'vitest'
import StudioProjects, { SCHEMA_VERSION } from '../src/index.ts'
import type { Project, ProjectId } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
const databases: DatabaseSync[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const db of databases.splice(0)) db.close()
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})

it('backs up and migrates an S1 database while preserving every project revision byte', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-multica-migration-'))
  roots.push(home)
  const directory = join(home, 'multica')
  await mkdir(directory)
  const path = join(directory, 'studio.sqlite')
  const legacy = new DatabaseSync(path)
  const project: Project = {
    id: randomUUID() as ProjectId,
    name: 'Original S1 project',
    concept: '',
    sourceText: '',
    aspectRatio: '16:9',
    targetEpisodes: null,
    episodeDuration: null,
    outline: 'Saved before professional assistants',
    episodes: [],
    revision: 1,
    archived: false,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
  }
  const original = JSON.stringify(project)
  try {
    legacy.exec(`
      PRAGMA application_id = 1297435732; PRAGMA user_version = 1;
      CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE project_revisions (project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(project_id, revision)) STRICT;
      CREATE TABLE episode_owners (episode_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id)) STRICT;
      CREATE TRIGGER immutable_revision_update BEFORE UPDATE ON project_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
      CREATE TRIGGER immutable_revision_delete BEFORE DELETE ON project_revisions BEGIN SELECT RAISE(ABORT, 'immutable'); END;
    `)
    legacy.prepare('INSERT INTO projects VALUES (?)').run(project.id)
    legacy.prepare('INSERT INTO project_revisions VALUES (?, ?, ?)').run(project.id, 1, original)
  } finally {
    legacy.close()
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: home })
  expect(ctx.studioProjects.get(project.id)).toEqual(project)
  expect(ctx.studioProjects.roles()).toHaveLength(9)
  const files = await readdir(directory)
  const backups = files.filter(name => name.startsWith('studio.sqlite.pre-migration-'))
  expect(backups).toHaveLength(1)
  const backup = new DatabaseSync(join(directory, backups[0]!), { readOnly: true })
  databases.push(backup)
  expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
  expect(backup.prepare('SELECT document FROM project_revisions').get()?.document).toBe(original)
  expect(backup.prepare("SELECT name FROM sqlite_master WHERE name = 'studio_roles'").get()).toBeUndefined()
  const current = new DatabaseSync(path, { readOnly: true })
  databases.push(current)
  expect(current.prepare('PRAGMA user_version').get()?.user_version).toBe(SCHEMA_VERSION)
  expect(current.prepare('SELECT document FROM project_revisions').get()?.document).toBe(original)
  await ctx.fiber.dispose()
  const reopened = new Context()
  contexts.push(reopened)
  await reopened.plugin(StudioProjects, { dshHome: home })
  expect(reopened.studioProjects.history(project.id)).toEqual([project])
  expect((await readdir(directory)).filter(name => name.startsWith('studio.sqlite.pre-migration-'))).toEqual(backups)
})

it('adds cover storage to schema 2 without changing project or assistant records', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-multica-cover-migration-'))
  roots.push(home)
  const initial = new Context()
  contexts.push(initial)
  await initial.plugin(StudioProjects, { dshHome: home })
  const roles = initial.studioProjects.roles()
  await initial.fiber.dispose()
  const path = join(home, 'multica/studio.sqlite')
  const legacy = new DatabaseSync(path)
  try {
    legacy.exec(`
      DROP TABLE studio_media_assets; DROP TABLE studio_canvas_nodes; DROP TABLE studio_production_units;
      DROP TABLE studio_script_completion; DROP TABLE studio_script_documents;
      DROP TABLE studio_project_identity; DROP TABLE studio_locations; DROP TABLE studio_edit_drafts;
      DROP TABLE project_covers; PRAGMA user_version = 2;
    `)
  } finally { legacy.close() }
  const migrated = new Context()
  contexts.push(migrated)
  await migrated.plugin(StudioProjects, { dshHome: home })
  expect(migrated.studioProjects.roles()).toEqual(roles)
  expect(migrated.studioProjects.list()).toEqual([])
  const backups = (await readdir(join(home, 'multica'))).filter(name => name.startsWith('studio.sqlite.pre-migration-'))
  expect(backups).toHaveLength(1)
  const backup = new DatabaseSync(join(home, 'multica', backups[0]!), { readOnly: true })
  databases.push(backup)
  expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
  expect(backup.prepare('SELECT COUNT(*) AS count FROM studio_roles').get()?.count).toBe(roles.length)
})
