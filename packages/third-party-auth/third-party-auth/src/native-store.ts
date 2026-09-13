/** Append-only native Claude transcript mirror, isolated from released Harness Session files. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, openSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SessionKey, SessionStore, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { ClaudeSessionId, ClaudeSessionView } from './types.ts'

const SCHEMA_VERSION = 1
const nativeEntry = z.object({ type: z.string(), uuid: z.string().optional(), timestamp: z.string().optional() }).passthrough()
const rowSchema = z.object({ id: z.string().uuid(), title: z.string(), model: z.string(), cwd: z.string(), updatedAt: z.number() })

/** Reconstruct optional native fields only when present in the persisted JSON. */
function decodeEntry(value: unknown): SessionStoreEntry {
  const { uuid, timestamp, ...entry } = nativeEntry.parse(value)
  return { ...entry, ...(uuid === undefined ? {} : { uuid }), ...(timestamp === undefined ? {} : { timestamp }) }
}

/** Native transcripts and session metadata in the plugin's own SQLite domain. */
export class NativeStore implements SessionStore {
  private readonly db: DatabaseSync

  /**
   * Open a private database without modifying existing Harness Session generations.
   * @param path - configured database file or :memory:.
   */
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      try { closeSync(openSync(path, 'wx', 0o600)) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
    }
    this.db = new DatabaseSync(path)
    const version = this.db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 0 && version !== SCHEMA_VERSION) { this.db.close(); throw new Error('unsupported native transcript schema') }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS native_sessions (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, cwd TEXT NOT NULL, updatedAt INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS native_entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, session TEXT NOT NULL,
        subpath TEXT NOT NULL, identity TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(project,session,subpath,identity)
      ) STRICT;
      PRAGMA user_version=1;
    `)
  }

  /**
   * Allocate native conversation metadata before its first turn.
   * @param cwd - explicit workspace path.
   * @param model - chosen native model.
   * @returns the newly allocated conversation.
   */
  create(cwd: string, model: string): ClaudeSessionView {
    const id = brandString<ClaudeSessionId>(randomUUID())
    this.db.prepare('INSERT INTO native_sessions VALUES (?, ?, ?, ?, ?)').run(id, '', model, cwd, Date.now())
    return this.get(id)
  }

  /**
   * Read a conversation owned by this database.
   * @param id - native conversation id.
   * @returns persisted metadata; unknown identities reject.
   */
  get(id: ClaudeSessionId): ClaudeSessionView {
    const value = rowSchema.parse(this.db.prepare('SELECT * FROM native_sessions WHERE id=?').get(id))
    return { ...value, id: brandString<ClaudeSessionId>(value.id) }
  }

  /** List stored native conversation metadata.
   * @returns all plugin-owned native conversations, most recently used first.
   */
  list(): ClaudeSessionView[] {
    return this.db.prepare('SELECT * FROM native_sessions ORDER BY updatedAt DESC').all().map((row) => {
      const value = rowSchema.parse(row)
      return { ...value, id: brandString<ClaudeSessionId>(value.id) }
    })
  }

  /**
   * Update turn metadata without altering native transcript entries.
   * @param id - owned conversation.
   * @param model - selected model.
   * @param title - initial user text used as a bounded title.
   */
  touch(id: ClaudeSessionId, model: string, title: string): void {
    this.get(id)
    this.db.prepare('UPDATE native_sessions SET model=?, title=CASE WHEN title=\'\' THEN ? ELSE title END, updatedAt=? WHERE id=?')
      .run(model, title.slice(0, 80), Date.now(), id)
  }

  /**
   * Mirror exact native records transactionally, deduplicating only stable native UUIDs.
   * @param key - SDK-owned project/session/subpath address.
   * @param entries - native transcript batch.
   */
  async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO native_entries(project,session,subpath,identity,body) VALUES(?,?,?,?,?)')
      for (const entry of entries) {
        const parsed = nativeEntry.parse(entry)
        insert.run(key.projectKey, key.sessionId, key.subpath ?? '', parsed.uuid ?? randomUUID(), JSON.stringify(parsed))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  /**
   * Load unmodified native entries for the official resume algorithm.
   * @param key - native project/session/subpath address.
   * @returns stored entries, or null if this stream has never been mirrored.
   */
  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const rows = this.db.prepare('SELECT body FROM native_entries WHERE project=? AND session=? AND subpath=? ORDER BY seq')
      .all(key.projectKey, key.sessionId, key.subpath ?? '')
    return rows.length === 0 ? null : rows.map(row => decodeEntry(JSON.parse(String(row.body))))
  }

  /**
   * Locate native subagent transcripts during official session restoration.
   * @param key - native project/session address.
   * @returns all stored native subpaths.
   */
  async listSubkeys(key: { projectKey: string; sessionId: string }): Promise<string[]> {
    return this.db.prepare('SELECT DISTINCT subpath FROM native_entries WHERE project=? AND session=? AND subpath<>\'\'')
      .all(key.projectKey, key.sessionId).map(row => String(row.subpath))
  }

  /**
   * Read a native conversation for display without rewriting its stored payloads.
   * @param id - plugin-owned native session.
   * @returns main-stream native records in append order.
   */
  records(id: ClaudeSessionId): SessionStoreEntry[] {
    this.get(id)
    return this.db.prepare('SELECT body FROM native_entries WHERE session=? AND subpath=\'\' ORDER BY seq')
      .all(id).map(row => decodeEntry(JSON.parse(String(row.body))))
  }

  /** Close the native database after all owned turns have settled. */
  close(): void { this.db.close() }
}
