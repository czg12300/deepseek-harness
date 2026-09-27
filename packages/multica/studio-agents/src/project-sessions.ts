/** Project-local Session storage; SQLite transactions do not require filesystem hard links. */
/* oxlint-disable typescript/require-await -- SQLite implements an asynchronous interface whose failures must reject. */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import {
  SessionLogOffset, type SessionHeader, type SessionEvent, type SessionId,
} from '@deepseek-ai/dsh-session'
import {
  assertVersion, assertContiguous, materializeAppendBatch, materializeCreateHeader, validateStoredEvents,
  SessionPersistenceRevision, SessionAlreadyExistsError, SessionAlreadyOwnedError,
  SessionPersistenceNotFoundError, SessionHandleClosedError, SessionReadOnlyError,
  type SessionPersistenceStore, type SessionHandle, type SessionAccess,
  type SessionPersistenceCreateOptions, type SessionPersistenceOpenOptions,
  type SessionPersistenceStatOptions, type SessionPersistenceListOptions,
} from '@deepseek-ai/dsh-session-persistence'

/** Mounted only while its project holds the exclusive project write lock. */
type StoreBackend = SessionPersistenceStore['backend']
const SCHEMA_VERSION = 1
const APPLICATION_ID = 0x4d435353

/** SQLite implementation of the mounted project persistence operations. */
export class ProjectSessions implements StoreBackend {
  private readonly db: DatabaseSync
  private readonly writers = new Set<SessionId>()
  private readonly handles = new Set<SessionHandle>()
  private readonly pending = new Map<SessionId, { header: SessionHeader; inherited: SessionLogOffset }>()
  private closed = false
  private failure: Error | undefined

  /**
   * @param root - opened project directory.
   * @param online - verifies the mounted disk before every operation.
   */
  constructor(root: string, private readonly online: () => void) {
    online()
    mkdirSync(join(root, 'sessions'), { recursive: true })
    this.db = new DatabaseSync(join(root, 'sessions', 'sessions.sqlite'))
    try {
      this.db.exec('PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE')
      const version = this.db.prepare('PRAGMA user_version').get()?.user_version
      const application = this.db.prepare('PRAGMA application_id').get()?.application_id
      if (version === 0 && application === 0 && this.db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().length === 0) {
        this.db.exec(`
          CREATE TABLE sessions (id TEXT PRIMARY KEY, header TEXT NOT NULL, inherited INTEGER NOT NULL) STRICT;
          CREATE TABLE events (id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(id, seq)) STRICT;
          CREATE TRIGGER keep_session_header BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'Session headers are immutable'); END;
          CREATE TRIGGER keep_session BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'Sessions are immutable'); END;
          CREATE TRIGGER keep_event BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'Session events are immutable'); END;
          CREATE TRIGGER keep_event_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'Session events are immutable'); END;
          PRAGMA application_id = ${APPLICATION_ID};
          PRAGMA user_version = ${SCHEMA_VERSION};
        `)
      } else if (version !== SCHEMA_VERSION || application !== APPLICATION_ID) throw new Error('Unsupported project Session database version')
      this.db.prepare('SELECT id, header, inherited FROM sessions LIMIT 0').all()
      this.db.prepare('SELECT id, seq, event FROM events LIMIT 0').all()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private check(): void {
    if (this.closed) throw new Error('Project Session store is closed')
    this.online()
  }

  private row(id: SessionId): { header: SessionHeader; inherited: SessionLogOffset } | undefined {
    const pending = this.pending.get(id)
    if (pending) return pending
    const row = this.db.prepare('SELECT header, inherited FROM sessions WHERE id = ?').get(id)
    if (!row) return undefined
    const decoded = sessionFormatCatalog.readHeader(JSON.parse(String(row.header)))
    if (decoded.status !== 'current') throw new Error('Unsupported or malformed project Session header')
    const header = decoded.header as unknown as SessionHeader
    assertVersion(header)
    if (header.id !== id || !Number.isSafeInteger(row.inherited) || Number(row.inherited) < 0)
      throw new Error('Invalid project Session metadata')
    return { header: materializeCreateHeader(header), inherited: SessionLogOffset(Number(row.inherited)) }
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    this.check()
    options?.signal?.throwIfAborted()
    assertVersion(header)
    const copy = materializeCreateHeader(header)
    const inherited = options?.inheritedEventCount ?? 0
    if (!Number.isSafeInteger(inherited) || inherited < 0 || (copy.isSeeded ? options?.inheritedEventCount === undefined : inherited !== 0))
      throw new Error('Invalid inherited Session event count')
    if (this.row(header.id)) throw new SessionAlreadyExistsError(header.id)
    this.pending.set(header.id, { header: copy, inherited: SessionLogOffset(inherited) })
    return this.handle(copy, SessionLogOffset(inherited), 'write')
  }

  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    this.check()
    options?.signal?.throwIfAborted()
    const row = this.row(id)
    if (!row) throw new SessionPersistenceNotFoundError(id)
    if (access === 'write') {
      const events = this.db.prepare('SELECT event FROM events WHERE id = ? ORDER BY seq').all(id).map(record => JSON.parse(String(record.event)) as SessionEvent)
      assertContiguous(id, events, 0)
      validateStoredEvents(row.header, events)
    }
    return this.handle(row.header, row.inherited, access)
  }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions) {
    this.check()
    options?.signal?.throwIfAborted()
    const row = this.row(id)
    if (!row) return undefined
    const count = Number(this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE id = ?').get(id)?.n)
    return { header: row.header, eventCount: count, revision: SessionPersistenceRevision(String(count)) }
  }

  async list(options?: SessionPersistenceListOptions) {
    this.check()
    const result = []
    for (const row of [...this.db.prepare('SELECT id FROM sessions').all(), ...[...this.pending.keys()].map(id => ({ id }))]) {
      const snapshot = await this.stat(String(row.id) as SessionId, options)
      if (snapshot) result.push(snapshot)
    }
    return result
  }

  async flush(): Promise<void> {
    this.check()
    if (this.failure) throw this.failure
    for (const handle of this.handles) if (handle.access === 'write') await handle.flush()
  }

  /**
   * Persist a published event through its owned writer.
   * @param id - Session identity.
   * @param event - newly published event.
   */
  async record(id: SessionId, event: SessionEvent): Promise<void> {
    const writer = [...this.handles].find(handle => handle.id === id && handle.access === 'write')
    if (!writer) return
    try { await writer.append([event]) } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error))
      throw this.failure
    }
  }

  /**
   * Close every handle before releasing SQLite.
   * @returns completion of all handle closures.
   */
  async close(): Promise<void> {
    if (this.closed) return
    await Promise.all([...this.handles].map(handle => handle.close()))
    this.db.close()
    this.closed = true
  }

  private handle(header: SessionHeader, inherited: SessionLogOffset, access: SessionAccess): SessionHandle {
    const id = header.id
    if (access === 'write') {
      if (this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
      this.writers.add(id)
    }
    let closed = false
    const materialize = (): void => {
      const pending = this.pending.get(id)
      if (pending) {
        const header = { ...pending.header, delegationDepth: pending.header.delegationDepth ?? 0 }
        this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)')
          .run(id, JSON.stringify(sessionFormatCatalog.encodeCurrentHeader(header, pending.inherited)), pending.inherited)
      }
    }
    const check = (operation: string, write = false): void => {
      if (closed) throw new SessionHandleClosedError(id, operation)
      this.check()
      if (write && access !== 'write') throw new SessionReadOnlyError(id, operation)
    }
    const handle: SessionHandle = {
      id, header, inheritedEventCount: inherited, access,
      read: async (offset = 0, length, options) => {
        check('read')
        options?.signal?.throwIfAborted()
        if (!Number.isSafeInteger(offset) || offset < 0 || (length !== undefined && (!Number.isSafeInteger(length) || length < 0)))
          throw new Error('Session offset and length must be a non-negative safe integer')
        const events = this.db.prepare('SELECT event FROM events WHERE id = ? ORDER BY seq').all(id)
          .map(row => JSON.parse(String(row.event)) as SessionEvent)
        assertContiguous(id, events, 0)
        validateStoredEvents(header, events)
        return { eventState: 'detached', events: events.slice(offset, length === undefined ? undefined : offset + length) }
      },
      append: async (events, options) => {
        check('append', true)
        options?.signal?.throwIfAborted()
        const batch = [...materializeAppendBatch(events)]
        this.db.exec('BEGIN IMMEDIATE')
        try {
          materialize()
          const cursor = Number(this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE id = ?').get(id)?.n)
          assertContiguous(id, batch, cursor)
          const insert = this.db.prepare('INSERT INTO events VALUES (?, ?, ?)')
          for (const event of batch) insert.run(id, event.seq, JSON.stringify(event))
          this.db.exec('COMMIT')
          this.pending.delete(id)
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
      },
      flush: async (options) => {
        check('flush', true)
        options?.signal?.throwIfAborted()
        materialize()
        this.pending.delete(id)
      },
      close: async () => {
        if (closed) return
        closed = true
        this.handles.delete(handle)
        if (access === 'write') { this.writers.delete(id); this.pending.delete(id) }
      },
      [Symbol.asyncDispose]: async () => { await handle.close() },
    }
    this.handles.add(handle)
    return handle
  }
}
