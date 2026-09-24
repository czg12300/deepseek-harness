/** Remote observations and request ownership; asynchronous responses never choose the visible document. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  NovelConversation,
  NovelDocument,
  NovelDocumentId,
  NovelId,
  NovelProject,
  NovelRevision,
} from '@deepseek-ai/dsh-novel-core/types'

/** Saved observations and operation progress consumed by framework-bound hooks. */
export interface NovelModelState {
  projects: NovelProject[]
  documents: Record<string, Omit<NovelDocument, 'content'>[]>
  content: Record<string, NovelDocument>
  conversations: Record<string, NovelConversation>
  histories: Record<string, NovelRevision[]>
  busy: Record<string, boolean>
  errors: Record<string, string>
  available: boolean
}

/** Holds business observations independently of any React component lifetime. */
export class NovelModel {
  /** Stable observable bound through the slot's injected hooks. */
  readonly source = createSnapshotStore<NovelModelState>({
    projects: [],
    documents: {},
    content: {},
    conversations: {},
    histories: {},
    busy: {},
    errors: {},
    available: false,
  })
  private alive = true
  private readonly generations = new Map<string, number>()

  /** Prevent late asynchronous callbacks from publishing after plugin disposal. */
  dispose(): void {
    this.alive = false
  }

  private active(): boolean {
    return this.alive
  }

  /**
   * Run one operation with keyed busy state and visible failure.
   * @param key - request scope, including its target document or project.
   * @param run - operation and success publication.
   * @returns result or undefined after a reported failure.
   */
  async request<T>(key: string, run: () => Promise<T>): Promise<T | undefined> {
    if (!this.active() || this.source.getSnapshot().busy[key]) return undefined
    this.source.update((s) => {
      s.busy[key] = true
      s.errors[key] = ''
    })
    try {
      return await run()
    } catch (error) {
      if (this.active())
        this.source.update((s) => {
          s.errors[key] = error instanceof Error ? error.message : String(error)
        })
      return undefined
    } finally {
      if (this.active())
        this.source.update((s) => {
          s.busy[key] = false
        })
    }
  }

  /** Publish the latest catalog observation.
 * @param projects - current catalog from an authoritative refresh.
 */
  list(projects: NovelProject[]): void {
    if (this.active())
      this.source.update((s) => {
        s.projects = projects
      })
  }
  /** Publish assistant availability independently of manuscript data.
 * @param available - whether real authoring execution is mounted.
 */
  availability(available: boolean): void {
    if (this.active())
      this.source.update((s) => {
        s.available = available
      })
  }
  /** Adopt project metadata without replacing a newer observation.
 * @param project - current metadata.
 */
  project(project: NovelProject): void {
    if (!this.alive) return
    this.source.update((s) => {
      const index = s.projects.findIndex(p => p.id === project.id)
      if (index < 0) s.projects.unshift(project)
      else if ((s.projects[index]?.updatedAt ?? project.updatedAt) <= project.updatedAt) s.projects[index] = project
    })
  }
  /** Publish ordered metadata for its original project.
 * @param id - project.
   * @param docs - ordered metadata.
 */
  documents(id: NovelId, docs: Omit<NovelDocument, 'content'>[]): void {
    if (this.active())
      this.source.update((s) => {
        s.documents[id] = docs
      })
  }
  /** Adopt a saved document without replacing a newer revision.
 * @param document - observed committed version.
 */
  document(document: NovelDocument): void {
    if (!this.alive) return
    this.source.update((s) => {
      if ((s.content[document.id]?.revision ?? 0) > document.revision) return
      s.content[document.id] = document
    })
  }
  /** Publish immutable versions for their original document.
 * @param id - document.
   * @param history - immutable versions.
 */
  history(id: NovelDocumentId, history: NovelRevision[]): void {
    if (this.active())
      this.source.update((s) => {
        s.histories[id] = history
      })
  }
  /**
   * Own a monotonically ordered read so stale conversation responses cannot replace later state.
   * @param id - document.
   * @param read - exact conversation query.
   */
  async conversation(id: NovelDocumentId, read: () => Promise<NovelConversation>): Promise<void> {
    const generation = (this.generations.get(id) ?? 0) + 1
    this.generations.set(id, generation)
    const value = await read()
    if (this.alive && this.generations.get(id) === generation)
      this.source.update((s) => {
        s.conversations[id] = value
      })
  }
}
