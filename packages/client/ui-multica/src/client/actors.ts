/** React-free projection of the independently stored actor-library catalog. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Actor, ActorId, ActorImportResult, ActorInput, ActorLibraryId, ActorLibrarySummary, ActorPage } from '@deepseek-ai/dsh-api-remotes/client'

/** Host calls used by the actor-library UI. */
export interface ActorApi {
  libraries(): Promise<ActorLibrarySummary[]>
  create(name: string): Promise<ActorLibrarySummary>
  list(id: ActorLibraryId, search: string, period: string, region: string, offset: number): Promise<ActorPage>
  actor(libraryId: ActorLibraryId, actorId: ActorId): Promise<Actor | null>
  save(libraryId: ActorLibraryId, actorId: ActorId | null, input: ActorInput): Promise<Actor>
  export(id: ActorLibraryId): Promise<{ name: string; dataUrl: string }>
  import(dataUrl: string, target: ActorLibraryId | null): Promise<ActorImportResult>
}

/** Plain callbacks passed from plugin registration to the actor-library page. */
export interface ActorActions {
  load(): Promise<void>
  select(id: ActorLibraryId): Promise<void>
  filter(search: string, period: string, region: string): Promise<void>
  more(): Promise<void>
  create(name: string): Promise<void>
  actor(id: ActorId): Promise<Actor | null>
  save(id: ActorId | null, input: ActorInput): Promise<void>
  export(): Promise<{ name: string; dataUrl: string }>
  import(dataUrl: string, merge: boolean): Promise<ActorImportResult>
}

/** Immutable facts projected to the client hook. */
export interface ActorState {
  libraries: ActorLibrarySummary[]
  selected: ActorLibraryId | null
  page: ActorPage
  search: string
  period: string
  region: string
  busy: boolean
  error: string | null
  importResult: ActorImportResult | null
}

/** Stable client data model; the Host database remains authoritative. */
export class ActorModel {
  /** Reactive actor-library state consumed through the framework hook. */
  readonly source = createSnapshotStore<ActorState>({ libraries: [], selected: null,
    page: { actors: [], total: 0 }, search: '', period: '', region: '', busy: false, error: null, importResult: null })
  private alive = true
  private request = 0

  /** @param api - Host callbacks for actor-library operations. */
  constructor(private readonly api: ActorApi) {}

  /** Stop publishing late Remote results after plugin disposal. */
  dispose(): void { this.alive = false }

  /** Refresh libraries and the selected library's actor list. */
  async load(): Promise<void> {
    const request = ++this.request
    this.source.update((d) => { d.busy = true; d.error = null })
    try {
      const libraries = await this.api.libraries()
      const state = this.source.getSnapshot()
      const selected = libraries.find(item => item.id === state.selected)?.id ?? libraries[0]?.id ?? null
      const page = selected ? await this.api.list(selected, state.search, state.period, state.region, 0) : { actors: [], total: 0 }
      if (this.alive && request === this.request) this.source.update((d) => {
        d.libraries = libraries; d.selected = selected; d.page = page; d.busy = false
      })
    } catch (error) {
      if (this.alive && request === this.request) this.source.update((d) => {
        d.busy = false; d.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Append the next page of matching actors. */
  async more(): Promise<void> {
    const state = this.source.getSnapshot()
    if (!state.selected || state.busy || state.page.actors.length >= state.page.total) return
    const request = ++this.request
    this.source.update((d) => { d.busy = true; d.error = null })
    try {
      const page = await this.api.list(state.selected, state.search, state.period, state.region, state.page.actors.length)
      if (this.alive && request === this.request) this.source.update((d) => {
        d.page = { total: page.total, actors: [...d.page.actors, ...page.actors] }; d.busy = false
      })
    } catch (error) {
      if (this.alive && request === this.request) this.source.update((d) => {
        d.busy = false; d.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Select a library and fetch its actors.
   * @param id - library to show.
   */
  async select(id: ActorLibraryId): Promise<void> {
    this.source.update((d) => { d.selected = id; d.search = ''; d.period = ''; d.region = '' })
    await this.load()
  }

  /** Apply name, period, and region filters to the current library.
   * @param search - name fragment.
   * @param period - exact period or empty string.
   * @param region - exact region or empty string.
   */
  async filter(search: string, period: string, region: string): Promise<void> {
    this.source.update((d) => { d.search = search; d.period = period; d.region = region })
    await this.load()
  }

  /** Create a new library and make it active.
   * @param name - library name.
   */
  async create(name: string): Promise<void> {
    const library = await this.api.create(name)
    this.source.update((d) => { d.selected = library.id; d.importResult = null })
    await this.load()
  }

  /** Save one actor and reload the visible list.
   * @param id - actor to replace, or null to create.
   * @param input - manually entered actor details.
   */
  async save(id: ActorId | null, input: ActorInput): Promise<void> {
    const selected = this.source.getSnapshot().selected
    if (!selected) throw new Error('Choose an actor library first')
    await this.api.save(selected, id, input)
    await this.load()
  }

  /** Read an actor with its full-body image for the editor.
   * @param id - actor identity.
   * @returns full actor or null when unknown.
   */
  async actor(id: ActorId): Promise<Actor | null> {
    const selected = this.source.getSnapshot().selected
    return selected ? this.api.actor(selected, id) : null
  }

  /** Download bytes are returned to the owning UI gesture.
   * @returns ZIP filename and bounded data URL.
   */
  async export(): Promise<{ name: string; dataUrl: string }> {
    const selected = this.source.getSnapshot().selected
    if (!selected) throw new Error('Choose an actor library first')
    return this.api.export(selected)
  }

  /** Merge into the current library or install the archive separately.
   * @param dataUrl - complete ZIP archive data URL.
   * @param merge - true to merge into the selected library.
   * @returns destination and merge counts.
   */
  async import(dataUrl: string, merge: boolean): Promise<ActorImportResult> {
    const result = await this.api.import(dataUrl, merge ? this.source.getSnapshot().selected : null)
    this.source.update((d) => { d.selected = result.library.id; d.importResult = result })
    await this.load()
    this.source.update((d) => { d.importResult = result })
    return result
  }
}
