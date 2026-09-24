/** Callback-only novel presentation props and framework-derived state seats. */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type {
  NovelCreate,
  NovelDocument,
  NovelDocumentId,
  NovelDocumentKind,
  NovelId,
  NovelInfo,
  NovelProposalId,
  NovelSelection,
  NovelTaskId,
} from '@deepseek-ai/dsh-novel-core/types'
import type { createNovelViewStore, NovelDraft } from './stores.ts'
import type { NovelModelState } from './model.ts'

/** All business operations arrive from the plugin apply closure. */
export interface NovelInjected {
  useNovelData: SnapshotSelectorHook<NovelModelState>
  useNovelAutoSave: SnapshotSelectorHook<number | null>
  refresh: () => Promise<void>
  open: (id: NovelId) => Promise<void>
  create: (input: NovelCreate) => Promise<void>
  importProject: (directory: string) => Promise<void>
  updateInfo: (id: NovelId, revision: number, info: NovelInfo) => Promise<void>
  remove: (id: NovelId) => Promise<void>
  read: (id: NovelId, documentId: NovelDocumentId) => Promise<void>
  createDocument: (id: NovelId, kind: NovelDocumentKind, title: string) => Promise<void>
  save: (id: NovelId, documentId: NovelDocumentId, draft: NovelDraft) => Promise<NovelDocument | undefined>
  reorder: (id: NovelId, documents: NovelDocumentId[]) => Promise<void>
  history: (id: NovelId, documentId: NovelDocumentId) => Promise<void>
  restore: (id: NovelId, documentId: NovelDocumentId, expected: number, revision: number) => Promise<void>
  send: (
    id: NovelId,
    documentId: NovelDocumentId,
    draft: NovelDraft,
    prompt: string,
    selection: NovelSelection | null,
  ) => Promise<void>
  cancel: (id: NovelId, taskId: NovelTaskId) => Promise<void>
  apply: (id: NovelId, documentId: NovelDocumentId, proposalId: NovelProposalId, revision: number) => Promise<void>
  discard: (id: NovelId, documentId: NovelDocumentId, proposalId: NovelProposalId) => Promise<void>
  pickDirectory: () => Promise<string | null>
  listDirectory: (path?: string) => Promise<DirectoryListing>
  reportUnsaved: (unsaved: boolean) => void
}
/** The framework owns the reactive bindings; components receive no Cordis context. */
export type NovelProps = PropsRuntime<'main'> &
  PropsStore<ReturnType<typeof createNovelViewStore>> &
  PropsLocale<'novel'> &
  NovelInjected
