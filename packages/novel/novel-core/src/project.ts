/** One open novel database; document writes and proposal application share its transaction. */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { transaction } from './database.ts'
import { documentSchema, projectSchema, proposalSchema, revisionSchema } from './validation.ts'
import type {
  NovelDocument,
  NovelDocumentId,
  NovelDocumentKind,
  NovelInfo,
  NovelProject,
  NovelProposal,
  NovelProposalId,
  NovelRequestId,
  NovelRevision,
  NovelSaveResult,
} from './types.ts'

/**
 * Decode only validated JSON from a durable SQLite value.
 * @param value - SQL text column.
 * @returns decoded JSON for the owner's schema validation.
 */
export function json(value: unknown): unknown {
  if (typeof value !== 'string') throw new Error('Novel database contains a non-text record')
  return JSON.parse(value) as unknown
}

const saveResultSchema = z.object({ status: z.enum(['saved', 'conflict']), document: documentSchema })

/** Owns the current project and its document-level revisions. */
export class NovelProjectStore {
  /**
   * @param db - connection owned by the registry.
   * @param directory - validated canonical directory.
   */
  constructor(
    readonly db: DatabaseSync,
    readonly directory: string,
  ) {}

  /** Read metadata and derive the current chapter count.
   * @returns current project metadata with its actual directory and chapter count.
   */
  get(): NovelProject {
    const data = projectSchema.parse(json(this.db.prepare('SELECT data FROM project WHERE singleton=1').get()?.data))
    data.directory = this.directory
    data.chapterCount = Number(
      this.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE kind='chapter'").get()?.count,
    )
    return data
  }

  /** Read ordered metadata without loading manuscript content.
   * @returns ordered metadata without document content.
   */
  documents(): Omit<NovelDocument, 'content'>[] {
    return this.db
      .prepare('SELECT metadata AS data FROM documents INDEXED BY document_metadata ORDER BY position,id')
      .all()
      .map((row) => {
        const value = json(row.data)
        return documentSchema.omit({ content: true }).parse(value)
      })
  }

  /** Validate one current document and its project ownership.
   * @param id - document owned by this project.
   * @returns current saved version.
   */
  document(id: NovelDocumentId): NovelDocument {
    const row = this.db.prepare('SELECT data FROM documents WHERE id=?').get(id)
    if (!row) throw new Error('Unknown novel document')
    const document = documentSchema.parse(json(row.data))
    if (document.novelId !== this.get().id) throw new Error('Novel document belongs to another project')
    return document
  }

  /** Read immutable versions for a document owned by this database.
   * @param id - document owned by this project.
   * @returns immutable saved versions, newest first.
   */
  history(id: NovelDocumentId): NovelRevision[] {
    this.document(id)
    return this.db
      .prepare('SELECT data FROM revisions WHERE document_id=? ORDER BY revision DESC')
      .all(id)
      .map(row =>
        z
          .object({
            documentId: z.literal(id),
            revision: revisionSchema,
            title: z.string(),
            content: z.string(),
            source: z.enum(['manual', 'assistant', 'restore']),
            createdAt: z.iso.datetime(),
          })
          .parse(json(row.data)),
      )
  }

  /**
   * Deduplicate one immutable operation input inside the caller's write transaction.
   * @param id - stable client retry identity.
   * @param input - complete operation identity and arguments.
   * @param run - mutation executed only on the first accepted request.
   * @param decode - validator for the durable retry result.
   * @returns the original result for retries with identical input.
   */
  operation<T>(id: NovelRequestId, input: unknown, run: () => T, decode: (value: unknown) => T): T {
    const encoded = JSON.stringify(input)
    const previous = this.db.prepare('SELECT input,result FROM operations WHERE id=?').get(id)
    if (previous) {
      if (previous.input !== encoded) throw new Error('Novel request ID was reused with different input')
      return decode(json(previous.result))
    }
    const result = run()
    this.db.prepare('INSERT INTO operations(id,input,result) VALUES(?,?,?)').run(id, encoded, JSON.stringify(result))
    return result
  }

  /** Commit project metadata only at the expected revision.
   * @param info - new project metadata.
   * @param expected - observed project revision.
   * @returns updated project; stale revisions throw.
   */
  updateInfo(info: NovelInfo, expected: number): NovelProject {
    return transaction(this.db, () => {
      const current = this.get()
      if (current.revision !== expected) throw new Error('Novel metadata changed; refresh before saving')
      const next = { ...current, ...info, revision: current.revision + 1, updatedAt: this.now(current.updatedAt) }
      this.db.prepare('UPDATE project SET data=? WHERE singleton=1').run(JSON.stringify(next))
      return next
    })
  }

  /** Create an empty document once per request identity.
   * @param kind - authoring document kind.
   * @param title - initial title.
   * @param requestId - creation retry identity.
   * @returns new empty document.
   */
  createDocument(kind: NovelDocumentKind, title: string, requestId: NovelRequestId): NovelDocument {
    return transaction(this.db, () =>
      this.operation(
        requestId,
        ['create-document', kind, title],
        () => {
          const project = this.get()
          const position = Number(
            this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM documents').get()?.position,
          )
          const document: NovelDocument = {
            id: randomUUID() as NovelDocumentId,
            novelId: project.id,
            kind,
            title,
            content: '',
            revision: 1,
            position,
            updatedAt: this.now(project.updatedAt),
          }
          this.db.prepare('INSERT INTO documents(id,data) VALUES(?,?)').run(document.id, JSON.stringify(document))
          this.appendRevision(document, 'manual')
          return document
        },
        value => documentSchema.parse(value),
      ),
    )
  }

  /** Save a complete permutation of document identities.
   * @param ids - complete document ordering.
   * @returns saved metadata in the requested order.
   */
  reorder(ids: NovelDocumentId[]): Omit<NovelDocument, 'content'>[] {
    return transaction(this.db, () => {
      const current = this.documents()
      if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some(d => !ids.includes(d.id)))
        throw new Error('Document order must contain every document exactly once')
      ids.forEach((id, position) => {
        this.db.prepare("UPDATE documents SET data=json_set(data,'$.position',?) WHERE id=?").run(position, id)
      })
      return this.documents()
    })
  }

  /**
   * Save one document without touching other documents.
   * @param id - target document.
   * @param expected - revision captured when editing began.
   * @param title - document title.
   * @param content - complete edited text.
   * @param requestId - stable retry identity.
   * @returns saved version or the current conflicting version.
   */
  save(
    id: NovelDocumentId,
    expected: number,
    title: string,
    content: string,
    requestId: NovelRequestId,
  ): NovelSaveResult {
    return transaction(this.db, () =>
      this.operation(
        requestId,
        ['save', id, expected, title, content],
        () => this.replace(id, expected, title, content, 'manual'),
        value => saveResultSchema.parse(value),
      ),
    )
  }

  /**
   * Restore text as a new version, preserving every committed revision.
   * @param id - target document.
   * @param expected - current revision observed by the caller.
   * @param revision - saved version to restore.
   * @param requestId - stable retry identity.
   * @returns new revision or conflict.
   */
  restore(id: NovelDocumentId, expected: number, revision: number, requestId: NovelRequestId): NovelSaveResult {
    return transaction(this.db, () =>
      this.operation(
        requestId,
        ['restore', id, expected, revision],
        () => {
          const old = this.history(id).find(entry => entry.revision === revision)
          if (!old) throw new Error('Unknown novel revision')
          return this.replace(id, expected, old.title, old.content, 'restore')
        },
        value => saveResultSchema.parse(value),
      ),
    )
  }

  /** Read a saved immutable before/after comparison.
   * @param id - proposal owned by this database.
   * @returns validated immutable comparison.
   */
  proposal(id: NovelProposalId): NovelProposal {
    const row = this.db.prepare('SELECT data FROM proposals WHERE id=?').get(id)
    if (!row) throw new Error('Unknown novel proposal')
    return proposalSchema.parse(json(row.data))
  }

  /**
   * Apply exactly the saved comparison under the SQLite writer lock.
   * @param id - persisted proposal, not browser-supplied replacement text.
   * @param expected - current version observed by the caller.
   * @param requestId - stable retry identity.
   * @returns the committed document or a conflict with no partial changes.
   */
  apply(id: NovelProposalId, expected: number, requestId: NovelRequestId): NovelSaveResult {
    return transaction(this.db, () =>
      this.operation(
        requestId,
        ['apply', id, expected],
        () => {
          const proposal = this.proposal(id)
          const current = this.document(proposal.documentId)
          if (proposal.status === 'applied') return { status: 'saved' as const, document: current }
          if (proposal.status !== 'pending') throw new Error('This novel proposal was discarded')
          if (current.revision !== expected || current.revision !== proposal.baseRevision)
            return { status: 'conflict' as const, document: current }
          let content = current.content
          for (const change of [...proposal.changes].sort((a, b) => b.start - a.start)) {
            if (content.slice(change.start, change.end) !== change.before)
              throw new Error('Novel proposal no longer matches its base text')
            content = content.slice(0, change.start) + change.after + content.slice(change.end)
          }
          const result = this.replace(current.id, expected, current.title, content, 'assistant')
          const next: NovelProposal = { ...proposal, status: 'applied', appliedRevision: result.document.revision }
          this.db.prepare('UPDATE proposals SET data=? WHERE id=?').run(JSON.stringify(next), id)
          return result
        },
        value => saveResultSchema.parse(value),
      ),
    )
  }

  /** Record an author decision without editing text.
   * @param id - pending proposal.
   * @returns its terminal disposition without modifying text.
   */
  discard(id: NovelProposalId): NovelProposal {
    return transaction(this.db, () => {
      const proposal = this.proposal(id)
      if (proposal.status === 'applied') throw new Error('Applied novel proposals cannot be discarded')
      const next: NovelProposal = { ...proposal, status: 'discarded' }
      this.db.prepare('UPDATE proposals SET data=? WHERE id=?').run(JSON.stringify(next), id)
      return next
    })
  }

  private replace(
    id: NovelDocumentId,
    expected: number,
    title: string,
    content: string,
    source: NovelRevision['source'],
  ): NovelSaveResult {
    const current = this.document(id)
    if (current.revision !== expected) return { status: 'conflict', document: current }
    const next = { ...current, title, content, revision: current.revision + 1, updatedAt: this.now(current.updatedAt) }
    this.db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify(next), id)
    this.appendRevision(next, source)
    return { status: 'saved', document: next }
  }

  private appendRevision(document: NovelDocument, source: NovelRevision['source']): void {
    const version: NovelRevision = {
      documentId: document.id,
      revision: document.revision,
      title: document.title,
      content: document.content,
      source,
      createdAt: document.updatedAt,
    }
    this.db
      .prepare('INSERT INTO revisions(document_id,revision,data) VALUES(?,?,?)')
      .run(document.id, document.revision, JSON.stringify(version))
    this.db.prepare("UPDATE project SET data=json_set(data,'$.updatedAt',?) WHERE singleton=1").run(document.updatedAt)
  }

  private now(previous: string): string {
    return new Date(Math.max(Date.now(), Date.parse(previous))).toISOString()
  }
}
