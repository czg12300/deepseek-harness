/** Copy one legacy project's relational closure without changing its source records. */
import type { SQLOutputValue } from 'node:sqlite'
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { transaction } from './database.ts'
import type { ProjectStore } from './project-store.ts'
import type { ProjectId, StudioCreationId } from './types.ts'

function copyRows(target: ProjectStore, table: string, rows: Record<string, SQLOutputValue>[]): void {
  for (const row of rows) {
    const columns = Object.keys(row)
    target.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row))
  }
}

/** Copy a single project's historical records into an empty folder database.
 * @param source - legacy database owner.
 * @param target - empty folder database with matching role history.
 * @param id - project to copy.
 * @returns initialized Session identities whose logs must accompany the database.
 */
export function copyProjectRecords(source: ProjectStore, target: ProjectStore, id: ProjectId): SessionId[] {
  return transaction(source.db, () => {
    if (!source.get(id)) throw new Error('Legacy project not found')
    source.history(id)
    const drafts = new Set(source.db.prepare('SELECT draft_id FROM studio_creation_projects WHERE project_id = ?').all(id).map(row => String(row.draft_id)))
    const workspaces = source.db.prepare('SELECT * FROM studio_workspaces').all().filter((row) => {
      const document = JSON.parse(String(row.document)) as { target: { kind: string; projectId?: string; draftId?: string } }
      return document.target.projectId === id || (document.target.draftId !== undefined && drafts.has(document.target.draftId))
    })
    const workspaceIds = new Set(workspaces.map(row => String(row.id)))

    transaction(target.db, () => {
      for (const row of source.db.prepare('SELECT role, revision, document FROM studio_roles').all()) {
        target.db.prepare('INSERT OR IGNORE INTO studio_roles VALUES (?, ?, ?)')
          .run(z.string().parse(row.role), z.number().int().positive().parse(row.revision), z.string().parse(row.document))
      }
      for (const table of ['projects', 'project_revisions', 'episode_owners', 'project_covers', 'studio_reviews', 'studio_edit_drafts']) {
        const column = table === 'projects' ? 'id' : 'project_id'
        copyRows(target, table, source.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).all(id))
      }
      for (const table of ['studio_creation_drafts', 'studio_creation_projects'])
        copyRows(target, table, source.db.prepare(`SELECT * FROM ${table}`).all().filter(row => drafts.has(String(row.draft_id))))
      copyRows(target, 'studio_workspaces', workspaces)
      for (const table of ['studio_tasks', 'studio_proposals'])
        copyRows(target, table, source.db.prepare(`SELECT * FROM ${table}`).all().filter(row => workspaceIds.has(String(row.workspace_id))))
      copyRows(target, 'studio_field_locks', source.db.prepare('SELECT * FROM studio_field_locks').all().filter((row) => {
        const target = JSON.parse(String(row.target_key)) as { projectId?: string; draftId?: string }
        return target.projectId === id || (target.draftId !== undefined && drafts.has(target.draftId))
      }))
    })
    target.history(id)
    return workspaces.filter(row => (JSON.parse(String(row.document)) as { initialized: boolean }).initialized)
      .map(row => z.string().parse(row.session_id) as SessionId)
  })
}

/** Copy an unpublished creation form and its planner history without publishing a project.
 * @param source - legacy database owner.
 * @param target - empty folder database.
 * @param id - saved form identity.
 * @returns initialized conversations to copy before mounting the destination.
 */
export function copyCreationRecords(source: ProjectStore, target: ProjectStore, id: StudioCreationId): SessionId[] {
  return transaction(source.db, () => {
    if (source.db.prepare('SELECT project_id FROM studio_creation_projects WHERE draft_id = ?').get(id))
      throw new Error('This form already created a project; migrate the project instead')
    const workspaces = source.db.prepare('SELECT * FROM studio_workspaces').all().filter((row) => {
      const document = JSON.parse(String(row.document)) as { target: { draftId?: string } }
      return document.target.draftId === id
    })
    const workspaceIds = new Set(workspaces.map(row => String(row.id)))

    transaction(target.db, () => {
      for (const row of source.db.prepare('SELECT role, revision, document FROM studio_roles').all()) {
        target.db.prepare('INSERT OR IGNORE INTO studio_roles VALUES (?, ?, ?)')
          .run(z.string().parse(row.role), z.number().int().positive().parse(row.revision), z.string().parse(row.document))
      }
      copyRows(target, 'studio_creation_drafts', source.db.prepare('SELECT * FROM studio_creation_drafts WHERE draft_id = ?').all(id))
      copyRows(target, 'studio_workspaces', workspaces)
      for (const table of ['studio_tasks', 'studio_proposals'])
        copyRows(target, table, source.db.prepare(`SELECT * FROM ${table}`).all().filter(row => workspaceIds.has(String(row.workspace_id))))
      copyRows(target, 'studio_field_locks', source.db.prepare('SELECT * FROM studio_field_locks').all().filter((row) => {
        return (JSON.parse(String(row.target_key)) as { draftId?: string }).draftId === id
      }))
    })
    return workspaces.filter(row => (JSON.parse(String(row.document)) as { initialized: boolean }).initialized)
      .map(row => z.string().parse(row.session_id) as SessionId)
  })
}
