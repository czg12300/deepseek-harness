/** Canonical folder registration; each novel owns its own database and Session root. */
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { openDatabase, transaction } from './database.ts'
import { NovelProjectStore, json } from './project.ts'
import { markerSchema } from './validation.ts'
import type { NovelCreate, NovelId, NovelProject, NovelSessionRoute } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Registry records stay local to the Host; content stays in each registered directory. */
export class NovelRegistry {
  private readonly db: DatabaseSync
  private readonly books = new Map<NovelId, NovelProjectStore>()

  /**
   * @param home - resolved Harness home.
   * @param busyTimeoutMs - SQLite contention budget.
   */
  constructor(
    home: string,
    private readonly busyTimeoutMs: number,
  ) {
    const directory = join(home, 'novels')
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'registry.sqlite')
    if (!existsSync(path)) closeSync(openSync(path, 'wx', 0o600))
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA busy_timeout=${busyTimeoutMs}; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL`)
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS novels(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,hidden INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS creations(id TEXT PRIMARY KEY,input TEXT NOT NULL,novel_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS session_routes(session_id TEXT PRIMARY KEY,novel_id TEXT NOT NULL)',
    )
  }

  /** Close every owned SQLite connection after assistant teardown. */
  close(): void {
    for (const book of this.books.values()) book.db.close()
    this.books.clear()
    this.db.close()
  }

  /** List visible registered novels in most-recently-updated order.
 * @returns registered, visible novels, newest first; inaccessible directories fail explicitly.
 */
  list(): NovelProject[] {
    return this.db
      .prepare('SELECT id FROM novels WHERE hidden=0')
      .all()
      .map(row => this.open(row.id as NovelId).get())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  }

  /** Open the validated project directory and retain its database connection.
 * @param id - registered novel identity.
   * @returns the project's owned database.
 */
  open(id: NovelId): NovelProjectStore {
    const row = this.db.prepare('SELECT path FROM novels WHERE id=?').get(id)
    if (!row || typeof row.path !== 'string') throw new Error('Unknown novel project')
    const path = this.canonical(row.path)
    const marker = this.marker(path)
    if (marker.id !== id) throw new Error('Novel directory identity changed')
    const cached = this.books.get(id)
    if (cached) return cached
    this.regular(join(path, '.novel'), 'directory')
    this.regular(join(path, '.novel', 'project.sqlite'), 'file')
    const store = new NovelProjectStore(
      openDatabase(join(path, '.novel', 'project.sqlite'), false, this.busyTimeoutMs),
      path,
    )
    try {
      if (store.get().id !== id) throw new Error('Novel database and marker disagree')
      this.books.set(id, store)
      return store
    } catch (error) {
      store.db.close()
      throw error
    }
  }

  /**
   * Create only a new child directory; retries recover a completed same-request directory.
   * @param input - validated three-field form with stable request ID.
   * @returns the new or previously created project.
   */
  create(input: NovelCreate): NovelProject {
    const parent = this.canonical(input.parentDirectory)
    const encoded = JSON.stringify({ ...input, parentDirectory: parent })
    const prior = this.db.prepare('SELECT input,novel_id FROM creations WHERE id=?').get(input.requestId)
    if (prior) {
      if (prior.input !== encoded) throw new Error('Novel creation request ID was reused')
      return this.open(prior.novel_id as NovelId).get()
    }
    let name = input.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '')
    if (!name || name === '.' || name === '..') throw new Error('Novel title cannot form a directory name')
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
    const directory = join(parent, name)
    const digest = createHash('sha256').update(encoded).digest('hex')
    if (existsSync(directory)) {
      const marker = this.marker(this.canonical(directory))
      if (marker.requestId !== input.requestId || marker.createDigest !== digest)
        throw new Error('Novel directory already exists; choose another title or parent directory')
      const project = this.import(directory)
      this.db
        .prepare('INSERT INTO creations(id,input,novel_id) VALUES(?,?,?)')
        .run(input.requestId, encoded, project.id)
      return project
    }
    mkdirSync(directory, { mode: 0o700 })
    const root = realpathSync(directory)
    mkdirSync(join(root, '.novel'), { mode: 0o700 })
    mkdirSync(join(root, '.novel', 'sessions'), { mode: 0o700 })
    mkdirSync(join(root, 'assets'), { mode: 0o700 })
    mkdirSync(join(root, 'exports'), { mode: 0o700 })
    const id = randomUUID() as NovelId
    const now = new Date().toISOString()
    const data: NovelProject = {
      id,
      title: input.title,
      synopsis: input.synopsis,
      directory: root,
      revision: 1,
      chapterCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    const db = openDatabase(join(root, '.novel', 'project.sqlite'), true, this.busyTimeoutMs)
    try {
      db.prepare('INSERT INTO project(singleton,data) VALUES(1,?)').run(JSON.stringify(data))
    } finally {
      db.close()
    }
    // The marker publishes a complete project; an unmarked partial creation is never imported.
    writeFileSync(
      join(root, 'novel.json'),
      JSON.stringify({ format: 'dsh-novel', version: 1, id, requestId: input.requestId, createDigest: digest }) + '\n',
      { flag: 'wx', mode: 0o600 },
    )
    transaction(this.db, () => {
      this.db.prepare('INSERT INTO novels(id,path) VALUES(?,?)').run(id, root)
      this.db.prepare('INSERT INTO creations(id,input,novel_id) VALUES(?,?,?)').run(input.requestId, encoded, id)
    })
    return this.open(id).get()
  }

  /**
   * Register an existing complete project without moving any files.
   * @param directory - directory on the serving Host.
   * @returns validated project metadata.
   */
  import(directory: string): NovelProject {
    const path = this.canonical(directory)
    const marker = this.marker(path)
    const existing = this.db.prepare('SELECT path FROM novels WHERE id=?').get(marker.id)
    if (existing && existing.path !== path)
      throw new Error('This novel identity is already registered at another directory')
    this.regular(join(path, '.novel'), 'directory')
    this.regular(join(path, '.novel', 'project.sqlite'), 'file')
    const db = openDatabase(join(path, '.novel', 'project.sqlite'), false, this.busyTimeoutMs)
    let project: NovelProject
    let sessions: SessionId[]
    try {
      project = new NovelProjectStore(db, path).get()
      if (project.id !== marker.id) throw new Error('Novel database and marker disagree')
      sessions = db
        .prepare('SELECT session_id FROM conversations')
        .all()
        .map(row => row.session_id as SessionId)
    } finally {
      db.close()
    }
    transaction(this.db, () => {
      this.db
        .prepare('INSERT INTO novels(id,path,hidden) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET hidden=0')
        .run(marker.id, path)
      for (const sessionId of sessions) this.registerSession(marker.id, sessionId)
    })
    return project
  }

  /**
   * Hide a project while preserving files and the Session routing record.
   * @param id - registered novel identity.
   */
  remove(id: NovelId): void {
    this.open(id)
    this.db.prepare('UPDATE novels SET hidden=1 WHERE id=?').run(id)
  }

  /** List registered Session routes without opening project databases.
 * @returns durable Session ownership, including hidden projects.
 */
  sessionRoutes(): NovelSessionRoute[] {
    return this.db
      .prepare('SELECT n.id,n.path,s.session_id FROM session_routes s JOIN novels n ON n.id=s.novel_id')
      .all()
      .map(row => ({
        novelId: row.id as NovelId,
        directory: String(row.path),
        sessionId: row.session_id as SessionId,
      }))
  }

  /**
   * Register a reserved Session before the runtime can publish its first log.
   * @param id - project containing the authoritative conversation record.
   * @param sessionId - reserved Session identity.
   */
  registerSession(id: NovelId, sessionId: SessionId): void {
    const existing = this.db.prepare('SELECT novel_id FROM session_routes WHERE session_id=?').get(sessionId)
    if (existing && existing.novel_id !== id) throw new Error('Novel Session identity belongs to another project')
    this.db.prepare('INSERT OR IGNORE INTO session_routes(session_id,novel_id) VALUES(?,?)').run(sessionId, id)
  }

  private canonical(path: string): string {
    const absolute = resolve(path)
    this.regular(absolute, 'directory')
    return realpathSync(absolute)
  }

  private marker(path: string) {
    const file = join(path, 'novel.json')
    this.regular(file, 'file')
    return markerSchema.extend({ createDigest: z.string() }).parse(json(readFileSync(file, 'utf8')))
  }

  private regular(path: string, kind: 'file' | 'directory'): void {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory()))
      throw new Error(`Novel path must be a regular ${kind}: ${path}`)
  }
}
