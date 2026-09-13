/** SQLite identity, append-only schema, and transaction ownership for Multica projects. */

import { closeSync, mkdirSync, openSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Physical Multica database generation, stored in PRAGMA user_version. */
export const SCHEMA_VERSION = 3

const APPLICATION_ID = 0x4d554c54

/**
 * Execute a synchronous write transaction; errors leave no partial revision or ownership rows.
 * @param db - Connection owned by the project service.
 * @param operation - Synchronous work under SQLite's writer lock.
 * @returns The committed operation result.
 */
export function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Open an owner-only database and initialize only an empty, unstamped file.
 * @param path - Resolved file inside the configured Harness home.
 * @param busyTimeoutMs - Validated SQLite lock-wait budget in milliseconds.
 * @returns A ready connection; initialization failures close it before throwing.
 */
export function openDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let fd: number
  try {
    fd = openSync(path, 'wx', 0o600)
  } catch (error) {
    // Existing database files retain their permissions; every other filesystem error propagates.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    fd = -1
  }
  if (fd !== -1) closeSync(fd)
  const db = new DatabaseSync(path)
  try {
    db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`)
    db.exec('PRAGMA foreign_keys = ON')
    const priorVersion = db.prepare('PRAGMA user_version').get()?.user_version
    const priorApplication = db.prepare('PRAGMA application_id').get()?.application_id
    if ((priorVersion === 1 || priorVersion === 2) && priorApplication === APPLICATION_ID) {
      const backup = `${path}.pre-migration-${randomUUID()}.sqlite`
      closeSync(openSync(backup, 'wx', 0o600))
      db.prepare('VACUUM INTO ?').run(backup)
    }
    transaction(db, () => {
      const version = db.prepare('PRAGMA user_version').get()?.user_version
      const application = db.prepare('PRAGMA application_id').get()?.application_id
      const objects = db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()
      if (version === 0 && application === 0 && objects.length === 0) {
        db.exec(`
          CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
          CREATE TABLE project_revisions (
            project_id TEXT NOT NULL REFERENCES projects(id),
            revision INTEGER NOT NULL CHECK (revision > 0),
            document TEXT NOT NULL CHECK (json_valid(document)),
            PRIMARY KEY (project_id, revision)
          ) STRICT;
          CREATE TABLE episode_owners (
            episode_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id)
          ) STRICT;
          CREATE TRIGGER immutable_revision_update BEFORE UPDATE ON project_revisions
            BEGIN SELECT RAISE(ABORT, 'Project revisions are immutable'); END;
          CREATE TRIGGER immutable_revision_delete BEFORE DELETE ON project_revisions
            BEGIN SELECT RAISE(ABORT, 'Project revisions are immutable'); END;
          CREATE TRIGGER immutable_episode_update BEFORE UPDATE ON episode_owners
            BEGIN SELECT RAISE(ABORT, 'Episode ownership is permanent'); END;
          CREATE TRIGGER immutable_episode_delete BEFORE DELETE ON episode_owners
            BEGIN SELECT RAISE(ABORT, 'Episode ownership is permanent'); END;
          PRAGMA application_id = ${APPLICATION_ID};
          PRAGMA user_version = 1;
        `)
      } else if ((version !== 1 && version !== 2 && version !== SCHEMA_VERSION) || application !== APPLICATION_ID) {
        throw new Error(`Unsupported Multica database identity or schema version at ${path}: ${String(version)}`)
      }
      if (db.prepare('PRAGMA user_version').get()?.user_version === 1) {
        db.exec(`
          CREATE TABLE studio_creation_drafts (draft_id TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(draft_id, revision)) STRICT;
          CREATE TABLE studio_creation_projects (draft_id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE REFERENCES projects(id), draft_revision INTEGER NOT NULL) STRICT;
          CREATE TRIGGER immutable_creation_update BEFORE UPDATE ON studio_creation_drafts BEGIN SELECT RAISE(ABORT, 'Creation draft revisions are immutable'); END;
          CREATE TRIGGER immutable_creation_delete BEFORE DELETE ON studio_creation_drafts BEGIN SELECT RAISE(ABORT, 'Creation draft history is immutable'); END;
          CREATE TABLE studio_roles (role TEXT NOT NULL, revision INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)), PRIMARY KEY(role, revision)) STRICT;
          CREATE TABLE studio_workspaces (id TEXT PRIMARY KEY, binding_key TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL UNIQUE, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
          CREATE TABLE studio_tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id), request_id TEXT NOT NULL UNIQUE, owner_pid INTEGER NOT NULL, state TEXT NOT NULL, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
          CREATE UNIQUE INDEX studio_active_task ON studio_tasks(workspace_id) WHERE state = 'running';
          CREATE TABLE studio_proposals (id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE REFERENCES studio_tasks(id), workspace_id TEXT NOT NULL REFERENCES studio_workspaces(id), document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
          CREATE TABLE studio_field_locks (target_key TEXT PRIMARY KEY CHECK(json_valid(target_key)), document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
          CREATE TABLE studio_reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), review_key TEXT NOT NULL UNIQUE, document TEXT NOT NULL CHECK(json_valid(document))) STRICT;
          CREATE TRIGGER immutable_role_update BEFORE UPDATE ON studio_roles BEGIN SELECT RAISE(ABORT, 'Role revisions are immutable'); END;
          CREATE TRIGGER immutable_role_delete BEFORE DELETE ON studio_roles BEGIN SELECT RAISE(ABORT, 'Role revisions are immutable'); END;
          CREATE TRIGGER immutable_review_decision BEFORE UPDATE ON studio_reviews WHEN json_extract(OLD.document, '$.status') != 'pending' BEGIN SELECT RAISE(ABORT, 'Review decisions are immutable'); END;
          CREATE TRIGGER immutable_review_delete BEFORE DELETE ON studio_reviews BEGIN SELECT RAISE(ABORT, 'Review history is immutable'); END;
          CREATE TRIGGER immutable_proposal_comparison BEFORE UPDATE ON studio_proposals WHEN json_remove(NEW.document, '$.applied', '$.ignored') IS NOT json_remove(OLD.document, '$.applied', '$.ignored') BEGIN SELECT RAISE(ABORT, 'Proposal comparisons are immutable'); END;
          CREATE TRIGGER immutable_task_input BEFORE UPDATE ON studio_tasks WHEN json_remove(NEW.document, '$.status', '$.reply', '$.error', '$.finishedAt') IS NOT json_remove(OLD.document, '$.status', '$.reply', '$.error', '$.finishedAt') BEGIN SELECT RAISE(ABORT, 'Task input is immutable'); END;
          CREATE TRIGGER immutable_task_result BEFORE UPDATE ON studio_tasks WHEN OLD.state != 'running' BEGIN SELECT RAISE(ABORT, 'Settled tasks are immutable'); END;
          PRAGMA user_version = 2;
        `)
      }
      if (db.prepare('PRAGMA user_version').get()?.user_version === 2) {
        db.exec(`
          CREATE TABLE project_covers (
            project_id TEXT PRIMARY KEY REFERENCES projects(id),
            revision INTEGER NOT NULL CHECK(revision > 0),
            image TEXT
          ) STRICT;
          PRAGMA user_version = ${SCHEMA_VERSION};
        `)
      }
      db.prepare('SELECT project_id, revision, image FROM project_covers LIMIT 0').all()
      db.prepare('SELECT id, binding_key, session_id, document FROM studio_workspaces LIMIT 0').all()
      db.prepare('SELECT id, workspace_id, request_id, owner_pid, state, document FROM studio_tasks LIMIT 0').all()
      db.prepare('SELECT id FROM projects LIMIT 0').all()
      db.prepare('SELECT project_id, revision, document FROM project_revisions LIMIT 0').all()
      db.prepare('SELECT episode_id, project_id FROM episode_owners LIMIT 0').all()
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) {
        throw new Error('Invalid Multica database foreign keys')
      }
    })
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
