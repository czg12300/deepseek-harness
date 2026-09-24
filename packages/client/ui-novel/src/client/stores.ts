/** View state and unsubmitted drafts, separate from observed Host documents. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { NovelDocument, NovelDocumentId, NovelId, NovelRequestId } from '@deepseek-ai/dsh-novel-core/types'

/** Local editor text retains the exact saved version it was based on. */
export interface NovelDraft {
  title: string
  content: string
  revision: number
  dirty: boolean
  conflict: boolean
  edit: number
}
/** Shared view state survives navigation and panel remounts. */
export interface NovelView {
  page: 'list' | 'create' | 'writing' | 'info'
  novelId: NovelId | null
  documentId: NovelDocumentId | null
  creation: { title: string; synopsis: string; parentDirectory: string; requestId: NovelRequestId }
  drafts: Record<string, NovelDraft>
  prompts: Record<string, string>
  history: boolean
}

type NovelViewActions = {
  list: (s: NovelView) => void
  create: (s: NovelView) => void
  creationField: (s: NovelView, field: 'title' | 'synopsis' | 'parentDirectory', value: string) => void
  open: (s: NovelView, id: NovelId) => void
  info: (s: NovelView, id: NovelId) => void
  document: (s: NovelView, id: NovelDocumentId) => void
  createdDocument: (s: NovelView, novelId: NovelId, id: NovelDocumentId) => void
  createdProject: (s: NovelView, id: NovelId, requestId: NovelRequestId) => void
  received: (s: NovelView, doc: NovelDocument, discard?: boolean) => void
  change: (s: NovelView, id: NovelDocumentId, field: 'title' | 'content', text: string) => void
  saved: (s: NovelView, doc: NovelDocument, edit: number) => void
  conflict: (s: NovelView, id: NovelDocumentId) => void
  prompt: (s: NovelView, id: NovelDocumentId, value: string) => void
  submitted: (s: NovelView, id: NovelDocumentId, value: string) => void
  history: (s: NovelView, open: boolean) => void
}

/** Declare navigation and draft actions owned by one mounted novel panel.
 * @returns a scoped store definition; the renderer binds its hooks and actions.
 */
export function createNovelViewStore(): EngineStoreHandle<NovelView, NovelViewActions> {
  return defineStore({
    init: (): NovelView => ({
      page: 'list',
      novelId: null,
      documentId: null,
      creation: { title: '', synopsis: '', parentDirectory: '', requestId: randomUUID() as NovelRequestId },
      drafts: {},
      prompts: {},
      history: false,
    }),
    actions: {
      list: (s: NovelView) => {
        s.page = 'list'
      },
      create: (s: NovelView) => {
        s.page = 'create'
        s.creation = { title: '', synopsis: '', parentDirectory: '', requestId: randomUUID() as NovelRequestId }
      },
      creationField: (s: NovelView, field: 'title' | 'synopsis' | 'parentDirectory', value: string) => {
        s.creation[field] = value
      },
      open: (s: NovelView, id: NovelId) => {
        s.novelId = id
        s.documentId = null
        s.page = 'writing'
        s.history = false
      },
      info: (s: NovelView, id: NovelId) => {
        s.novelId = id
        s.page = 'info'
      },
      document: (s: NovelView, id: NovelDocumentId) => {
        s.documentId = id
        s.history = false
      },
      createdDocument: (s: NovelView, novelId: NovelId, id: NovelDocumentId) => {
        if (s.novelId === novelId && s.page === 'writing') {
          s.documentId = id
          s.history = false
        }
      },
      createdProject: (s: NovelView, id: NovelId, requestId: NovelRequestId) => {
        if (s.page === 'create' && s.creation.requestId === requestId) {
          s.novelId = id
          s.documentId = null
          s.page = 'writing'
        }
      },
      received: (s: NovelView, doc: NovelDocument, discard = false) => {
        const old = s.drafts[doc.id]
        if (old?.dirty && !discard) {
          if (doc.revision > old.revision) old.conflict = true
          return
        }
        if (old && old.revision > doc.revision) return
        s.drafts[doc.id] = {
          title: doc.title,
          content: doc.content,
          revision: doc.revision,
          dirty: false,
          conflict: false,
          edit: (old?.edit ?? 0) + 1,
        }
      },
      change: (s: NovelView, id: NovelDocumentId, field: 'title' | 'content', text: string) => {
        const d = s.drafts[id]
        if (!d) return
        d[field] = text
        d.dirty = true
        d.edit++
      },
      saved: (s: NovelView, doc: NovelDocument, edit: number) => {
        const d = s.drafts[doc.id]
        if (!d || doc.revision < d.revision) return
        d.revision = doc.revision
        d.conflict = false
        if (d.edit === edit) {
          d.title = doc.title
          d.content = doc.content
          d.dirty = false
        }
      },
      conflict: (s: NovelView, id: NovelDocumentId) => {
        const d = s.drafts[id]
        if (d) d.conflict = true
      },
      prompt: (s: NovelView, id: NovelDocumentId, value: string) => {
        s.prompts[id] = value
      },
      submitted: (s: NovelView, id: NovelDocumentId, value: string) => {
        if (s.prompts[id] === value) s.prompts[id] = ''
      },
      history: (s: NovelView, open: boolean) => {
        s.history = open
      },
    },
  })
}
