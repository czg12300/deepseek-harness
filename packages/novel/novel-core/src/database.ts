/** Per-novel SQLite transactions and immutable document history. */
import { DatabaseSync } from 'node:sqlite'
import { closeSync, lstatSync, mkdirSync, openSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/** Novel database schema, distinct from the Session log format. */
export const SCHEMA_VERSION = 2
const APPLICATION_ID = 0x4e4f564c

/**
 * Commit all related writes or restore the previous state.
 * @param db - owned SQLite connection.
 * @param run - synchronous transaction body.
 * @returns committed value.
 */
export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = run()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Open only a recognized database, or exclusively create a new one.
 * @param path - file inside the validated novel directory.
 * @param create - true only while initializing a newly owned directory.
 * @param busyTimeoutMs - bounded writer lock wait.
 * @returns an owned connection; close on plugin disposal.
 */
export function openDatabase(path: string, create: boolean, busyTimeoutMs: number): DatabaseSync {
  if (create) closeSync(openSync(path, 'wx', 0o600))
  const db = new DatabaseSync(path, { open: true })
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}; PRAGMA foreign_keys = ON`)
    if (create)
      transaction(db, () => {
        db.exec(`
        CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
        CREATE TABLE documents (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
        CREATE TABLE revisions (document_id TEXT NOT NULL REFERENCES documents(id), revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(document_id,revision)) STRICT;
        CREATE TABLE operations (id TEXT PRIMARY KEY, input TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result))) STRICT;
        CREATE TABLE conversations (document_id TEXT PRIMARY KEY REFERENCES documents(id), session_id TEXT NOT NULL UNIQUE, initialized INTEGER NOT NULL DEFAULT 0) STRICT;
        CREATE TABLE tasks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), request_id TEXT NOT NULL UNIQUE, input TEXT NOT NULL, owner_pid INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
        CREATE UNIQUE INDEX one_running_task ON tasks(document_id) WHERE state='running';
        CREATE TABLE proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id), data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
        CREATE TRIGGER immutable_revision_update BEFORE UPDATE ON revisions BEGIN SELECT RAISE(ABORT,'Novel revisions are immutable'); END;
        CREATE TRIGGER immutable_revision_delete BEFORE DELETE ON revisions BEGIN SELECT RAISE(ABORT,'Novel revisions are immutable'); END;
        PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SCHEMA_VERSION};
      `)
        addMetadataIndex(db)
      })
    if (
      db.prepare('PRAGMA application_id').get()?.application_id === APPLICATION_ID &&
      db.prepare('PRAGMA user_version').get()?.user_version === 1
    ) {
      const backups = join(dirname(path), 'backups')
      mkdirSync(backups, { recursive: true, mode: 0o700 })
      const entry = lstatSync(backups)
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error('Novel backups path must be a regular directory')
      const backup = join(backups, `schema-1-${randomUUID()}.sqlite`)
      closeSync(openSync(backup, 'wx', 0o600))
      db.prepare('VACUUM INTO ?').run(backup)
      transaction(db, () => {
        if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) return
        addMetadataIndex(db)
        db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`)
      })
    }
    if (
      db.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID ||
      db.prepare('PRAGMA user_version').get()?.user_version !== SCHEMA_VERSION
    )
      throw new Error('Unsupported novel database identity or schema version')
    db.prepare('SELECT data FROM project LIMIT 0').all()
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Indexed generated metadata avoids parsing every manuscript while listing chapters. */
function addMetadataIndex(db: DatabaseSync): void {
  db.exec(`
    ALTER TABLE documents ADD COLUMN kind TEXT GENERATED ALWAYS AS (json_extract(data,'$.kind')) VIRTUAL;
    ALTER TABLE documents ADD COLUMN position INTEGER GENERATED ALWAYS AS (json_extract(data,'$.position')) VIRTUAL;
    ALTER TABLE documents ADD COLUMN metadata TEXT GENERATED ALWAYS AS (json_remove(data,'$.content')) VIRTUAL;
    CREATE INDEX document_metadata ON documents(position,id,metadata);
    CREATE INDEX document_kind ON documents(kind);
  `)
}
