/** Portable directory admission, exclusive ownership, and device-local recent locations. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync, existsSync, unlinkSync, cpSync, lstatSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { ProjectStore } from './project-store.ts'
import type { ResolvedConfig } from './index.ts'
import type { ProjectId, StudioFolder, StudioFolderId } from './types.ts'
import type { StudioCreationId } from './workflow-types.ts'
import { projectSchema } from './validation.ts'

const manifestName = 'multica.project.json'
const manifestSchema = z.strictObject({ format: z.literal('multica-project'), version: z.literal(1), id: z.uuid() })
const locationSchema = z.strictObject({
  id: z.uuid(), path: z.string(), projectId: z.uuid().nullable(), creationId: z.uuid().nullable(), name: z.string(),
  state: z.enum(['open', 'closed', 'missing']),
  summary: z.object(projectSchema.shape).omit({ sourceText: true, outline: true, episodes: true }).extend({
    episodeCount: z.number().int().nonnegative(),
    cover: z.object({ revision: z.number().int().nonnegative(), image: z.string().nullable() }),
  }).optional(),
})

/** An open project owns its database and an OS-released SQLite write lock. */
export interface OpenProjectFolder {
  info: StudioFolder
  store: ProjectStore
  check(this: void): void
  close(): Promise<void>
}

/** Device catalog; the project remains independently openable without this catalog. */
export class ProjectFolders {
  /** Mounted directories whose exclusive ownership is still held by this service. */
  readonly opened = new Map<StudioFolderId, OpenProjectFolder>()

  /**
   * @param ctx - owning service context.
   * @param legacy - local catalog and migration source.
   * @param config - database and role defaults.
   */
  constructor(private readonly ctx: Context, private readonly legacy: ProjectStore, private readonly config: ResolvedConfig) {}

  /**
   * Inspect recent paths without creating directories or opening their databases.
   * @param includeHidden - include retained ownership records for removed recent entries.
   * @returns device-local entries.
   */
  list(includeHidden = true): StudioFolder[] {
    return this.legacy.db.prepare('SELECT document FROM studio_locations WHERE ? OR hidden = 0').all(includeHidden ? 1 : 0).map((row) => {
      const info = locationSchema.parse(JSON.parse(String(row.document))) as StudioFolder
      const live = this.opened.get(info.id)
      if (live) {
        try { live.check(); return this.describe(live) } catch { return { ...info, state: 'missing' } }
      }
      try {
        const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(info.path, manifestName), 'utf8')))
        return { ...info, state: manifest.id === info.id ? 'closed' : 'missing' }
      } catch { return { ...info, state: 'missing' } }
    })
  }

  /**
   * Persist navigation metadata after a committed project mutation.
   * @param folder - mounted project.
   * @returns current location.
   */
  describe(folder: OpenProjectFolder): StudioFolder {
    const project = folder.store.list()[0]
    const creation = folder.store.creationDrafts()[0]
    const linkedCreation = folder.store.db.prepare('SELECT draft_id FROM studio_creation_projects LIMIT 1').get()
    const info: StudioFolder = {
      ...folder.info, projectId: project?.id ?? null,
      creationId: creation?.id ?? (linkedCreation ? String(linkedCreation.draft_id) as StudioCreationId : folder.info.creationId),
      name: project?.name ?? creation?.name ?? '', state: 'open',
      ...project ? { summary: project } : {},
    }
    folder.info = info
    this.legacy.db.prepare('INSERT INTO studio_locations (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document')
      .run(info.id, JSON.stringify(info))
    return info
  }

  /**
   * Create an empty portable project directory without model calls.
   * @param path - absolute new or empty directory.
   * @returns opened folder.
   */
  create(path: string): OpenProjectFolder {
    if (!isAbsolute(path)) throw new Error('Project location must be an absolute directory')
    mkdirSync(path, { recursive: true })
    if (readdirSync(path).length) throw new Error('Choose an empty directory for the new project')
    writeFileSync(join(path, manifestName), `${JSON.stringify({ format: 'multica-project', version: 1, id: randomUUID() }, null, 2)}\n`, { flag: 'wx' })
    writeFileSync(join(path, '.multica-incomplete'), '', { flag: 'wx' })
    for (const name of ['assets', 'artifacts', 'exports', 'sessions']) mkdirSync(join(path, name))
    return this.open(path, true)
  }

  /**
   * Open an existing directory; a missing database is corruption, never a new empty project.
   * @param path - absolute directory.
   * @param initialize - only the creator may initialize.
   * @returns mounted project.
   */
  open(path: string, initialize = false): OpenProjectFolder {
    if (!isAbsolute(path)) throw new Error('Project location must be an absolute directory')
    const root = realpathSync(path)
    if (!initialize && existsSync(join(root, '.multica-incomplete'))) throw new Error('Project creation or migration did not finish; recover from the source project')
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, manifestName), 'utf8')))
    const id = manifest.id as StudioFolderId
    const existing = this.opened.get(id)
    if (existing) {
      existing.check()
      if (existing.info.path !== root) throw new Error('Another copy of this project is already open; close it before opening this copy')
      return this.remember(existing)
    }
    if (!initialize && !statSync(join(root, 'project.sqlite')).isFile()) throw new Error('Project database is missing')
    const identity = statSync(root)
    const lock = new DatabaseSync(join(root, '.multica-lock.sqlite'))
    let store: ProjectStore | undefined
    try {
      lock.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE')
      store = new ProjectStore(this.ctx, this.config, root, initialize ? this.legacy : undefined)
      if (initialize) store.db.prepare('INSERT INTO studio_project_identity VALUES (1, ?)').run(id)
      if (store.db.prepare('SELECT id FROM studio_project_identity WHERE slot = 1').get()?.id !== id)
        throw new Error('Project manifest does not match its database identity')
      if (store.list().length > 1) throw new Error('A portable folder must contain at most one project')
      const databaseIdentity = statSync(join(root, 'project.sqlite'))
      const openedStore = store
      let closed = false
      const check = (): void => {
        if (closed) throw new Error('Project is closed; open its folder again')
        const current = statSync(root)
        const currentDatabase = statSync(join(root, 'project.sqlite'))
        const currentManifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, manifestName), 'utf8')))
        if (current.dev !== identity.dev || current.ino !== identity.ino || currentManifest.id !== id
          || currentDatabase.dev !== databaseIdentity.dev || currentDatabase.ino !== databaseIdentity.ino)
          throw new Error('Project disk changed or disconnected; reopen the original folder')
      }
      const folder: OpenProjectFolder = {
        info: { id, path: root, projectId: null, creationId: null, name: '', state: 'open' },
        store: openedStore, check,
        close: async () => {
          if (closed) return
          await openedStore.close()
          lock.close()
          closed = true
          this.opened.delete(id)
        },
      }
      this.opened.set(id, folder)
      return this.remember(folder)
    } catch (error) {
      store?.db.close()
      lock.close()
      throw error
    }
  }

  private remember(folder: OpenProjectFolder): OpenProjectFolder {
    this.describe(folder)
    this.legacy.db.prepare('UPDATE studio_locations SET hidden = 0 WHERE id = ?').run(folder.info.id)
    return folder
  }

  /**
   * Locate a formal project among current mounts.
   * @param id - stable project identity.
   * @returns its folder if open.
   */
  project(id: ProjectId): OpenProjectFolder | undefined {
    return [...this.opened.values()].find(folder => folder.store.get(id) !== null)
  }

  /**
   * Locate a saved creation form.
   * @param id - stable form identity.
   * @returns its folder if open.
   */
  creation(id: StudioCreationId): OpenProjectFolder | undefined {
    return [...this.opened.values()].find(folder => folder.store.creationDraft(id) !== null)
  }

  /**
   * Hide this device's catalog entry, retaining ownership so legacy copies stay excluded.
   * Does not inspect or close project files; opening the folder restores the entry.
   * @param id - registered folder identity, including unavailable or open projects.
   */
  forget(id: StudioFolderId): void {
    this.legacy.db.prepare('UPDATE studio_locations SET hidden = 1 WHERE id = ?').run(id)
  }

  /**
   * Remove a failed mount's catalog record while retaining its diagnostic files.
   * @param id - closed failed mount identity.
   */
  discard(id: StudioFolderId): void {
    if (this.opened.has(id)) throw new Error('Close the failed mount before discarding its entry')
    this.legacy.db.prepare('DELETE FROM studio_locations WHERE id = ?').run(id)
  }

  /**
   * Publish a fully initialized folder.
   * @param folder - validated creation or migration result.
   */
  finish(folder: OpenProjectFolder): void {
    folder.check()
    unlinkSync(join(folder.info.path, '.multica-incomplete'))
    this.describe(folder)
  }

  /**
   * Copy a quiescent project while its exclusive lock remains held.
   * @param folder - project with no running tasks or open Sessions.
   * @param destination - empty absolute directory.
   */
  backup(folder: OpenProjectFolder, destination: string): void {
    folder.check()
    if (!isAbsolute(destination)) throw new Error('Backup location must be an absolute directory')
    mkdirSync(destination, { recursive: true })
    if (readdirSync(destination).length) throw new Error('Choose an empty backup directory')
    const target = realpathSync(destination)
    if (target === folder.info.path || target.startsWith(`${folder.info.path}/`) || target.startsWith(`${folder.info.path}\\`))
      throw new Error('Backup must be outside the project directory')
    writeFileSync(join(target, '.multica-incomplete'), '', { flag: 'wx' })
    folder.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    for (const name of readdirSync(folder.info.path)) {
      if (name === manifestName || name.startsWith('.multica-lock.sqlite')) continue
      cpSync(join(folder.info.path, name), join(target, name), {
        recursive: true, errorOnExist: true, force: false,
        filter: (source) => {
          if (lstatSync(source).isSymbolicLink()) throw new Error('Project contains an external link; import its files before copying')
          return true
        },
      })
    }
    cpSync(join(folder.info.path, manifestName), join(target, manifestName), { errorOnExist: true, force: false })
    unlinkSync(join(target, '.multica-incomplete'))
  }
}
