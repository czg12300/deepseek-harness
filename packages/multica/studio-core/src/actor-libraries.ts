/** Portable actor libraries with an independent database and local reference files. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Unzip, UnzipInflate, strFromU8, strToU8, zipSync } from 'fflate'
import { z } from 'zod'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { ResolvedConfig } from './index.ts'
import type { Actor, ActorId, ActorImportResult, ActorInput, ActorLibraryId, ActorLibrarySummary, ActorPage } from './types.ts'

const MANIFEST = 'actor-library.json'
const DB = 'library.sqlite'
const APP_ID = 0x41435452
const MAX_ARCHIVE = 32 * 1024 * 1024
const MAX_UNPACKED = 64 * 1024 * 1024
const MAX_FILES = 500
const IMAGE_LIMIT = 2 * 1024 * 1024
const imagePath = /^assets\/([0-9a-f-]{36})\/([0-9a-f]{64})\.(png|jpg|webp)$/
const manifestSchema = z.strictObject({ format: z.literal('multica-actor-library'), version: z.literal(1), id: z.uuid() })
const inputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120), description: z.string().max(10_000),
  period: z.string().max(80), region: z.string().max(80),
  portrait: z.string().nullable(), fullBody: z.string().nullable(),
})
const rowSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), description: z.string().max(10_000),
  period: z.string().max(80), region: z.string().max(80),
  portrait_path: z.string().nullable(), body_path: z.string().nullable(),
  created_at: z.iso.datetime(), updated_at: z.iso.datetime(),
})
type Row = {
  id: string
  name: string
  description: string
  period: string
  region: string
  portrait_path: string | null
  body_path: string | null
  created_at: string
  updated_at: string
}

function uuid(value: string): string { return z.uuid().parse(value) }
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function fingerprint(row: Row): string {
  const values = [row.name, row.description, row.period, row.region,
    row.portrait_path ? imagePath.exec(row.portrait_path)?.[2] : null,
    row.body_path ? imagePath.exec(row.body_path)?.[2] : null]
  return hash(strToU8(JSON.stringify(values)))
}
function media(input: string, limit = IMAGE_LIMIT): { bytes: Buffer; ext: 'png' | 'jpg' | 'webp' } {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input)
  if (!match) throw new Error('Actor image must be a PNG, JPEG or WebP data URL')
  const encoded = match[2]
  if (!encoded) throw new Error('Actor image is missing its base64 payload')
  const bytes = Buffer.from(encoded, 'base64')
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1] as 'png' | 'webp'
  const valid = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : ext === 'jpg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!valid || bytes.length > limit || bytes.toString('base64') !== match[2]) throw new Error('Actor image is invalid or exceeds the limit')
  return { bytes, ext }
}

function imageData(root: string, path: string | null): string | null {
  if (path === null) return null
  const match = imagePath.exec(path)
  const actorId = match?.[1]
  if (!actorId || !z.uuid().safeParse(actorId).success) throw new Error('Invalid actor image path')
  const assetsRoot = join(root, 'assets')
  if (lstatSync(assetsRoot).isSymbolicLink()) throw new Error('Actor image root cannot be a link')
  const folder = join(assetsRoot, actorId)
  if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) throw new Error('Actor image directory is not a regular directory')
  const file = join(root, path)
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Actor image is not a regular file')
  const bytes = readFileSync(file)
  if (bytes.length > IMAGE_LIMIT || hash(bytes) !== match[2]) throw new Error('Actor image checksum does not match its path')
  const mime = match[3] === 'jpg' ? 'jpeg' : match[3]
  media(`data:image/${mime};base64,${bytes.toString('base64')}`)
  return `data:image/${mime};base64,${bytes.toString('base64')}`
}

function openDb(path: string, create = false, readOnly = false): DatabaseSync {
  if (!create && !statSync(path).isFile()) throw new Error('Actor library database is missing')
  const db = new DatabaseSync(path, { readOnly })
  try {
    if (create) {
      db.exec(`PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;
        CREATE TABLE library (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL) STRICT;
        CREATE TABLE actors (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
          period TEXT NOT NULL, region TEXT NOT NULL, portrait_path TEXT, body_path TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
        CREATE TABLE imported_actors (source_library_id TEXT NOT NULL, source_actor_id TEXT NOT NULL,
          source_digest TEXT NOT NULL, target_actor_id TEXT NOT NULL REFERENCES actors(id),
          PRIMARY KEY (source_library_id, source_actor_id, source_digest)) STRICT;
        PRAGMA application_id = ${APP_ID}; PRAGMA user_version = 1;`)
    } else if (db.prepare('PRAGMA application_id').get()?.application_id !== APP_ID
      || db.prepare('PRAGMA user_version').get()?.user_version !== 1) {
      throw new Error('Unsupported actor library database')
    }
    db.exec('PRAGMA foreign_keys = ON')
    const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()
    if (objects.length !== 3 || objects.some(row => row.type !== 'table' || !['library', 'actors', 'imported_actors'].includes(String(row.name))))
      throw new Error('Actor library database has unexpected objects')
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Actor library database has invalid references')
    db.prepare('SELECT id, name, created_at FROM library LIMIT 0').all()
    db.prepare('SELECT * FROM actors LIMIT 0').all()
    db.prepare('SELECT source_library_id FROM imported_actors LIMIT 0').all()
    return db
  } catch (error) { db.close(); throw error }
}

function archiveEntries(bytes: Uint8Array): Map<string, Buffer> {
  if (bytes.length > MAX_ARCHIVE) throw new Error('Actor library archive exceeds 32 MiB')
  const entries = new Map<string, Buffer>()
  let count = 0
  let total = 0
  const unzip = new Unzip((file) => {
    const name = file.name
    if (++count > MAX_FILES || entries.has(name) || (name !== MANIFEST && name !== DB && !imagePath.test(name)))
      throw new Error('Actor library archive contains an unexpected entry')
    if (file.originalSize !== undefined && file.originalSize > MAX_UNPACKED - total)
      throw new Error('Actor library archive is too large after extraction')
    const chunks: Buffer[] = []
    let size = 0
    file.ondata = (error, data, final) => {
      if (error) throw error
      size += data.length
      total += data.length
      if (total > MAX_UNPACKED || (name !== DB && name !== MANIFEST && size > IMAGE_LIMIT))
        throw new Error('Actor library archive is too large after extraction')
      chunks.push(Buffer.from(data))
      if (final) entries.set(name, Buffer.concat(chunks))
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
    const end = Math.min(offset + 64 * 1024, bytes.length)
    unzip.push(bytes.subarray(offset, end), end === bytes.length)
  }
  if (entries.size !== count || !entries.has(MANIFEST) || !entries.has(DB)) throw new Error('Actor library archive is incomplete')
  return entries
}

/** Independent actor-library storage under the directory containing the device Multica database. */
export class ActorLibraries {
  private readonly root: string

  constructor(config: ResolvedConfig) {
    this.root = join(dirname(resolve(resolveDshHome(config.dshHome), config.databasePath)), 'actor')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }

  private folder(id: ActorLibraryId): string {
    return join(this.root, uuid(id))
  }

  private withDb<T>(id: ActorLibraryId, run: (db: DatabaseSync, root: string) => T): T {
    const root = this.folder(id)
    if (lstatSync(root).isSymbolicLink()) throw new Error('Actor library directory cannot be a link')
    const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')))
    if (manifest.id !== id) throw new Error('Actor library manifest identity does not match')
    const db = openDb(join(root, DB))
    try {
      if (db.prepare('SELECT id FROM library').get()?.id !== id) throw new Error('Actor library database identity does not match')
      return run(db, root)
    } finally { db.close() }
  }

  /** List independently portable library folders.
   * @returns named libraries and actor counts; malformed libraries fail explicitly.
   */
  list(): ActorLibrarySummary[] {
    return readdirSync(this.root, { withFileTypes: true }).filter(entry => entry.isDirectory() && z.uuid().safeParse(entry.name).success)
      .map(entry => this.summary(entry.name as ActorLibraryId))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  /** Read one library's summary.
   * @param id - library folder identity.
   * @returns name, path and actor count.
   */
  summary(id: ActorLibraryId): ActorLibrarySummary {
    return this.withDb(id, (db, root) => ({ id, path: root,
      name: String(db.prepare('SELECT name FROM library WHERE id = ?').get(id)?.name),
      actorCount: Number(db.prepare('SELECT COUNT(*) AS n FROM actors').get()?.n),
    }))
  }

  /** Create a new empty portable library.
   * @param name - user-visible library name.
   * @returns the newly created library.
   */
  create(name: string): ActorLibrarySummary {
    const title = z.string().trim().min(1).max(120).parse(name)
    const id = randomUUID() as ActorLibraryId
    const staged = mkdtempSync(join(this.root, '.create-'))
    try {
      writeFileSync(join(staged, MANIFEST), `${JSON.stringify({ format: 'multica-actor-library', version: 1, id })}\n`, { flag: 'wx', mode: 0o600 })
      mkdirSync(join(staged, 'assets'), { mode: 0o700 })
      const db = openDb(join(staged, DB), true)
      try { db.prepare('INSERT INTO library VALUES (?, ?, ?)').run(id, title, new Date().toISOString()) } finally { db.close() }
      renameSync(staged, this.folder(id))
      return this.summary(id)
    } catch (error) { rmSync(staged, { recursive: true, force: true }); throw error }
  }

  /** Search one library, returning the first 48 matching actors with portrait previews.
   * @param id - library identity.
   * @param search - optional case-insensitive name fragment.
   * @param period - exact period filter or empty string.
   * @param region - exact region filter or empty string.
   * @param offset - non-negative result offset.
   * @returns matched actors and total count.
   */
  actors(id: ActorLibraryId, search = '', period = '', region = '', offset = 0): ActorPage {
    const query = z.string().max(120).parse(search).trim()
    const era = z.string().max(80).parse(period)
    const place = z.string().max(80).parse(region)
    const start = z.number().int().nonnegative().max(100_000).parse(offset)
    return this.withDb(id, (db, root) => {
      const where = "WHERE name LIKE ? ESCAPE '\\' AND (? = '' OR period = ?) AND (? = '' OR region = ?)"
      const args = [`%${query.replace(/[\\%_]/g, '\\$&')}%`, era, era, place, place]
      const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM actors ${where}`).get(...args)?.n)
      const rows = db.prepare(`SELECT * FROM actors ${where} ORDER BY updated_at DESC, id LIMIT 48 OFFSET ?`).all(...args, start) as Row[]
      return { total, actors: rows.map(row => this.decode(row, root, false)) }
    })
  }

  /** Read one actor with both reference images.
   * @param libraryId - owning library.
   * @param actorId - stable actor identity.
   * @returns actor or null when unknown.
   */
  actor(libraryId: ActorLibraryId, actorId: ActorId): Actor | null {
    return this.withDb(libraryId, (db, root) => {
      const row = db.prepare('SELECT * FROM actors WHERE id = ?').get(uuid(actorId)) as Row | undefined
      return row ? this.decode(row, root, true) : null
    })
  }

  private decode(row: Row, root: string, body: boolean): Actor {
    return {
      id: uuid(row.id) as ActorId, name: row.name, description: row.description,
      period: row.period, region: row.region,
      portrait: imageData(root, row.portrait_path), fullBody: body ? imageData(root, row.body_path) : null,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  private writeImage(root: string, id: ActorId, value: string | null): string | null {
    if (value === null) return null
    const { bytes, ext } = media(value)
    const relative = `assets/${id}/${hash(bytes)}.${ext}`
    const assetsRoot = join(root, 'assets')
    mkdirSync(assetsRoot, { recursive: true, mode: 0o700 })
    if (lstatSync(assetsRoot).isSymbolicLink()) throw new Error('Actor image root cannot be a link')
    const folder = join(assetsRoot, id)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    if (lstatSync(folder).isSymbolicLink()) throw new Error('Actor image directory cannot be a link')
    try {
      const fd = openSync(join(root, relative), 'wx', 0o600)
      try { writeFileSync(fd, bytes) } finally { closeSync(fd) }
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    imageData(root, relative)
    return relative
  }

  /** Add or replace an actor's manually entered details and image references.
   * @param libraryId - destination library.
   * @param actorId - existing actor, or null to create one.
   * @param input - complete actor details and optional validated image data URLs.
   * @returns committed actor with its reference images.
   */
  save(libraryId: ActorLibraryId, actorId: ActorId | null, input: ActorInput): Actor {
    const parsed = inputSchema.parse(input)
    return this.withDb(libraryId, (db, root) => {
      const id = actorId === null ? randomUUID() as ActorId : uuid(actorId) as ActorId
      const old = db.prepare('SELECT created_at FROM actors WHERE id = ?').get(id)
      if (actorId !== null && !old) throw new Error('Actor not found')
      const portrait = this.writeImage(root, id, parsed.portrait)
      const body = this.writeImage(root, id, parsed.fullBody)
      const now = new Date().toISOString()
      db.prepare(`INSERT INTO actors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
          period=excluded.period, region=excluded.region, portrait_path=excluded.portrait_path,
          body_path=excluded.body_path, updated_at=excluded.updated_at`)
        .run(id, parsed.name, parsed.description, parsed.period, parsed.region, portrait, body, old?.created_at ?? now, now)
      const saved = this.actor(libraryId, id)
      if (!saved) throw new Error('Saved actor could not be read')
      return saved
    })
  }

  /** Export one library's database and referenced files as a portable ZIP data URL.
   * @param id - library identity.
   * @returns complete ZIP and download name, or an explicit size error.
   */
  export(id: ActorLibraryId): { name: string; dataUrl: string } {
    return this.withDb(id, (db, root) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const files: Record<string, Uint8Array> = {
          [MANIFEST]: readFileSync(join(root, MANIFEST)), [DB]: readFileSync(join(root, DB)),
        }
        for (const row of db.prepare('SELECT portrait_path, body_path FROM actors').all()) {
          for (const path of [row.portrait_path, row.body_path]) if (path !== null) {
            const relative = String(path)
            imageData(root, relative)
            files[relative] = readFileSync(join(root, relative))
          }
        }
        if (Object.values(files).reduce((sum, data) => sum + data.length, 0) > MAX_UNPACKED || Object.keys(files).length > MAX_FILES)
          throw new Error('Actor library exceeds archive limits')
        const zip = zipSync(files, { level: 6 })
        if (zip.length > MAX_ARCHIVE) throw new Error('Actor library ZIP exceeds 32 MiB')
        return { name: `actor-library-${id}.zip`, dataUrl: `data:application/zip;base64,${Buffer.from(zip).toString('base64')}` }
      } finally { db.exec('COMMIT') }
    })
  }

  /** Import a ZIP as a separate library or merge it into the selected library.
   * @param dataUrl - bounded ZIP data URL from the browser.
   * @param target - selected destination, or null to install an independent library.
   * @returns destination and merge counts; invalid archives do not alter existing rows.
   */
  import(dataUrl: string, target: ActorLibraryId | null): ActorImportResult {
    const encoded = /^data:application\/zip;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)?.[1]
    if (!encoded || encoded.length > Math.ceil(MAX_ARCHIVE / 3) * 4 + 4) throw new Error('Choose an actor-library ZIP under 32 MiB')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.toString('base64') !== encoded) throw new Error('Invalid actor-library ZIP encoding')
    const files = archiveEntries(bytes)
    const manifestBytes = files.get(MANIFEST)
    const databaseBytes = files.get(DB)
    if (!manifestBytes || !databaseBytes) throw new Error('Actor library archive is incomplete')
    const manifest = manifestSchema.parse(JSON.parse(strFromU8(manifestBytes)))
    const staged = mkdtempSync(join(this.root, '.import-'))
    try {
      writeFileSync(join(staged, DB), databaseBytes, { flag: 'wx', mode: 0o600 })
      const source = openDb(join(staged, DB), false, true)
      try {
        if (source.prepare('SELECT id FROM library').get()?.id !== manifest.id) throw new Error('Imported library identity does not match')
        if (source.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('Actor library database is corrupt')
        const rows = source.prepare('SELECT * FROM actors').all().map(row => rowSchema.parse(row))
        const referenced = new Set<string>()
        for (const row of rows) {
          uuid(row.id)
          for (const path of [row.portrait_path, row.body_path]) if (path !== null) {
            const relative = path
            referenced.add(relative)
            const entry = files.get(relative)
            if (!entry || !imagePath.test(relative) || hash(entry) !== imagePath.exec(relative)?.[2])
              throw new Error('Actor library image is missing or corrupted')
            media(`data:image/${relative.endsWith('.jpg') ? 'jpeg' : relative.endsWith('.png') ? 'png' : 'webp'};base64,${entry.toString('base64')}`)
          }
        }
        for (const relative of files.keys()) {
          if (relative !== MANIFEST && relative !== DB && !referenced.has(relative))
            throw new Error('Actor library archive contains an unreferenced file')
        }
        if (target === null) {
          const id = manifest.id as ActorLibraryId
          if (existsSync(this.folder(id))) throw new Error('Actor library is already installed; select a library to merge')
          writeFileSync(join(staged, MANIFEST), manifestBytes, { flag: 'wx', mode: 0o600 })
          for (const [relative, content] of files) if (relative !== MANIFEST && relative !== DB) {
            mkdirSync(dirname(join(staged, relative)), { recursive: true, mode: 0o700 })
            writeFileSync(join(staged, relative), content, { flag: 'wx', mode: 0o600 })
          }
          renameSync(staged, this.folder(id))
          return { library: this.summary(id), added: rows.length, skipped: 0, conflicts: 0 }
        }
        let added = 0; let skipped = 0; let conflicts = 0
        this.withDb(target, (dest, root) => {
          dest.exec('BEGIN IMMEDIATE')
          try {
            for (const row of rows) {
              const digest = fingerprint(row)
              if (dest.prepare('SELECT target_actor_id FROM imported_actors WHERE source_library_id = ? AND source_actor_id = ? AND source_digest = ?')
                .get(manifest.id, row.id, digest)) { skipped++; continue }
              const existing = dest.prepare('SELECT * FROM actors WHERE id = ?').get(row.id) as Row | undefined
              if (existing && fingerprint(existing) === digest) { skipped++; continue }
              const id = existing ? randomUUID() as ActorId : row.id as ActorId
              if (existing) conflicts++
              const copyImage = (path: string | null): string | null => {
                if (path === null) return null
                const content = files.get(path)
                const ext = imagePath.exec(path)?.[3]
                if (!content || !ext) throw new Error('Actor library image is missing or corrupted')
                const mime = ext === 'jpg' ? 'jpeg' : ext
                return this.writeImage(root, id, `data:image/${mime};base64,${content.toString('base64')}`)
              }
              dest.prepare('INSERT INTO actors VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
                id, row.name, row.description, row.period, row.region, copyImage(row.portrait_path),
                copyImage(row.body_path), row.created_at, row.updated_at,
              )
              dest.prepare('INSERT INTO imported_actors VALUES (?, ?, ?, ?)').run(manifest.id, row.id, digest, id)
              added++
            }
            dest.exec('COMMIT')
          } catch (error) { dest.exec('ROLLBACK'); throw error }
        })
        return { library: this.summary(target), added, skipped, conflicts }
      } finally { source.close() }
    } finally { if (existsSync(staged)) rmSync(staged, { recursive: true, force: true }) }
  }
}
