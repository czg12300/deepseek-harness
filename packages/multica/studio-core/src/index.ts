/** Multica host project storage; creation and editing have no agent or Session side effects. */

import Schema from '@deepseek-ai/schemastery'
import { ProjectStore } from './project-store.ts'
import { ProjectFolders } from './project-folders.ts'
import { ActorLibraries } from './actor-libraries.ts'
import { ProjectWorkspace } from './project-workspace.ts'
import { canOpenNativePath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import { copyProjectRecords, copyCreationRecords } from './project-migration.ts'
import { creationInputSchema, targetSchema } from './workflow-schema.ts'
import type { Actor, ActorId, ActorImportResult, ActorInput, ActorLibraryId, ActorLibrarySummary, ActorPage, CanvasNode, CanvasNodeId, EpisodeId, ProductionUnit, ProductionUnitId, ProjectMediaAsset, ProjectMediaId, ScriptDocument, ScriptDocumentId, StudioFolder, StudioFolderId } from './types.ts'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  StudioRoleConfig,
  StudioRoleId,
  StudioRoleRevision,
  StudioTarget,
  StudioWorkspace,
  StudioWorkspaceId,
  StudioWorkspaceView,
  StudioTaskRequest,
  StudioTask,
  StudioTaskView,
  StudioTaskId,
  StudioProposalId,
  StudioProposal,
  StudioApplyRequest,
  StudioApplyResult,
  StudioField,
  StudioReview,
  StudioReviewId,
  StudioAssistantBackend,
  StudioAssistantCatalog,
  StudioFieldValue,
  StudioCreationId,
  StudioCreationDraft,
  StudioCreationSummary,
  StudioCreationSaveResult,
} from './workflow-types.ts'
import { projectIdSchema, revisionSchema } from './validation.ts'
import type { Project, ProjectId, ProjectInput, ProjectSummary, ProjectCover, SaveResult } from './types.ts'

export type * from './types.ts'
export { SCHEMA_VERSION } from './database.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    studioProjects: StudioProjects
  }
}

/** Deployment-owned database location and SQLite writer contention budget. */
export interface Config {
  /** Harness home; omitted follows DSH_HOME, then ~/.dsh. */
  dshHome?: string
  /** Absolute or home-relative path inside the Harness home; defaults to multica/studio.sqlite. */
  databasePath?: string
  /** SQLite lock wait in milliseconds; defaults to 5000. */
  busyTimeoutMs?: number
  /** Maximum decoded bytes for a custom cover; defaults to 1048576. */
  maxCoverBytes?: number
  /** Initial professional-role execution defaults; published role versions retain their own values. */
  assistantDefaults?: {
    /** Maximum output tokens for newly seeded roles. */
    maxTokens: number
    /** Maximum model steps per task for newly seeded roles. */
    maxSteps: number
    /** Wall-clock execution deadline in milliseconds for newly seeded roles. */
    timeoutMs: number
  }
}

/** Deployment settings after the service's schema applies validated defaults. */
export type ResolvedConfig = Config & {
  maxCoverBytes: number
  databasePath: string
  busyTimeoutMs: number
  assistantDefaults: { maxTokens: number; maxSteps: number; timeoutMs: number }
}


/** Project operations routed by stable identities to independently portable folders. */
export class StudioProjects extends TypertRemoteService {
  static Config: Schema<
    Config,
    Config & {
      maxCoverBytes: number
      databasePath: string
      busyTimeoutMs: number
      assistantDefaults: { maxTokens: number; maxSteps: number; timeoutMs: number }
    }
  > = Schema.object({
    dshHome: Schema.string(),
    databasePath: Schema.string().default('multica/studio.sqlite'),
    busyTimeoutMs: Schema.number().step(1).min(0).max(2_147_483_647).default(5000),
    maxCoverBytes: Schema.number().step(1).min(1).max(8_388_608).default(1_048_576),
    assistantDefaults: Schema.object({
      maxTokens: Schema.number().step(1).min(1).default(8192),
      maxSteps: Schema.number().step(1).min(1).default(8),
      timeoutMs: Schema.number().step(1).min(1).default(180000),
    }).default({ maxTokens: 8192, maxSteps: 8, timeoutMs: 180000 }),
  })

  private readonly legacy: ProjectStore
  private readonly folders: ProjectFolders
  private readonly actors: ActorLibraries
  private backend: StudioAssistantBackend | undefined
  private closing = false
  private readonly backendDisposers = new Map<ProjectStore, () => void>()
  private readonly sessionLocations = new Map<SessionId, { root: string; check: () => void; store: ProjectStore }>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'studioProjects')
    const parsed = StudioProjects.Config(config)
    this.legacy = new ProjectStore(ctx, parsed)
    this.folders = new ProjectFolders(ctx, this.legacy, parsed)
    this.actors = new ActorLibraries(parsed)
    ctx.effect(() => async () => {
      this.closing = true
      for (const folder of [...this.folders.opened.values()]) await this.closeFolder(folder.info.id)
      await this.legacy.close()
    })
  }

  private stores(): ProjectStore[] { return [...[...this.folders.opened.values()].map(folder => folder.store), this.legacy] }

  /** List independent actor-library folders.
   * @returns local libraries and actor counts.
   */
  @Remote('actorLibraries')
  actorLibraries(): ActorLibrarySummary[] { return this.actors.list() }

  /** Create a portable actor library under the device's actor directory.
   * @param name - library name.
   * @returns new library summary.
   */
  @Remote('createActorLibrary')
  createActorLibrary(name: string): ActorLibrarySummary { return this.actors.create(name) }

  /** Search actors in one independent library.
   * @param id - library identity.
   * @param search - name fragment.
   * @param period - exact period filter.
   * @param region - exact region filter.
   * @param offset - result offset for paging.
   * @returns first page and full matching count.
   */
  @Remote('libraryActors')
  libraryActors(id: ActorLibraryId, search: string, period: string, region: string, offset: number): ActorPage {
    return this.actors.actors(id, search, period, region, offset)
  }

  /** Read one actor and its two reference images.
   * @param libraryId - library identity.
   * @param actorId - actor identity.
   * @returns actor or null.
   */
  @Remote('libraryActor')
  libraryActor(libraryId: ActorLibraryId, actorId: ActorId): Actor | null { return this.actors.actor(libraryId, actorId) }

  /** Save user-authored actor details without model work.
   * @param libraryId - destination library.
   * @param actorId - actor to replace, or null for a new actor.
   * @param input - complete details and reference images.
   * @returns committed actor.
   */
  @Remote('saveLibraryActor')
  saveLibraryActor(libraryId: ActorLibraryId, actorId: ActorId | null, input: ActorInput): Actor {
    return this.actors.save(libraryId, actorId, input)
  }

  /** Export a complete portable library archive.
   * @param id - source library.
   * @returns ZIP data URL and suggested filename.
   */
  @Remote('exportActorLibrary')
  exportActorLibrary(id: ActorLibraryId): { name: string; dataUrl: string } { return this.actors.export(id) }

  /** Install or merge a validated actor-library archive.
   * @param dataUrl - ZIP data URL.
   * @param target - destination library, or null to install separately.
   * @returns destination and merge counts.
   */
  @Remote('importActorLibrary')
  importActorLibrary(dataUrl: string, target: ActorLibraryId | null): ActorImportResult {
    return this.actors.import(dataUrl, target)
  }

  private requireFolder(id: StudioFolderId) {
    const folder = this.folders.opened.get(id)
    if (!folder) throw new Error('Project is closed; open its folder first')
    folder.check()
    return folder
  }

  private checked(store: ProjectStore): ProjectStore {
    const folder = [...this.folders.opened.values()].find(item => item.store === store)
    folder?.check()
    return store
  }

  private project(id: ProjectId): ProjectStore {
    projectIdSchema.parse(id)
    const location = this.folders.list().find(folder => folder.projectId === id)
    if (location) return this.requireFolder(location.id).store
    return this.legacy
  }

  private projectWorkspace(id: ProjectId): ProjectWorkspace {
    return new ProjectWorkspace(this.project(id))
  }

  /** List project-local Markdown files, materializing committed scripts on disk.
   * @param id - mounted project.
   * @returns ordered script documents.
   */
  @Remote('scriptDocuments')
  scriptDocuments(id: ProjectId): ScriptDocument[] { return this.projectWorkspace(id).documents(id) }

  /** Read a project Markdown document.
   * @param projectId - mounted project.
   * @param documentId - document identity.
   * @returns document or null.
   */
  @Remote('scriptDocument')
  scriptDocument(projectId: ProjectId, documentId: ScriptDocumentId): ScriptDocument | null {
    return this.projectWorkspace(projectId).readDocument(projectId, documentId)
  }

  /** Save Markdown, preserving project revision checks for outline and episode scripts.
   * @param projectId - mounted project.
   * @param documentId - document identity.
   * @param expectedRevision - observed document revision.
   * @param markdown - replacement text.
   * @returns committed document.
   */
  @Remote('saveScriptDocument')
  saveScriptDocument(projectId: ProjectId, documentId: ScriptDocumentId, expectedRevision: number, markdown: string): ScriptDocument {
    return this.projectWorkspace(projectId).saveDocument(projectId, documentId, expectedRevision, markdown)
  }

  /** Read the user's completion decision against the current script digest.
   * @param id - mounted project.
   * @returns whether the script remains complete.
   */
  @Remote('scriptComplete')
  scriptComplete(id: ProjectId): boolean { return this.projectWorkspace(id).scriptComplete(id) }

  /** Confirm a complete saved script before admitting production.
   * @param id - mounted project.
   * @param expectedRevision - reviewed saved revision.
   * @returns true after confirmation.
   */
  @Remote('completeScript')
  completeScript(id: ProjectId, expectedRevision: number): boolean {
    return this.projectWorkspace(id).completeScript(id, expectedRevision)
  }

  /** List episode and whole-film production units.
   * @param id - mounted project.
   * @returns saved units.
   */
  @Remote('productionUnits')
  productionUnits(id: ProjectId): ProductionUnit[] { return this.projectWorkspace(id).units(id) }

  /** Create an episode or whole-film canvas.
   * @param id - mounted project.
   * @param kind - production template.
   * @param episodeId - source episode for episode units.
   * @param title - unit name.
   * @returns created unit.
   */
  @Remote('createProductionUnit')
  createProductionUnit(id: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): ProductionUnit {
    return this.projectWorkspace(id).createUnit(id, kind, episodeId, title)
  }

  /** Read one production canvas.
   * @param id - mounted project.
   * @param unitId - production unit.
   * @returns persisted nodes.
   */
  @Remote('canvasNodes')
  canvasNodes(id: ProjectId, unitId: ProductionUnitId): CanvasNode[] {
    return this.projectWorkspace(id).nodes(id, unitId)
  }

  /** Add a text or media-reference node.
   * @param id - mounted project.
   * @param unitId - owning canvas.
   * @param kind - node kind.
   * @param label - node title.
   * @param x - canvas x coordinate.
   * @param y - canvas y coordinate.
   * @param assetId - optional media identity.
   * @param text - script-node text or null for media.
   * @returns created node.
   */
  @Remote('addCanvasNode')
  addCanvasNode(id: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string,
    x: number, y: number, assetId: ProjectMediaId | null, text: string | null): CanvasNode {
    return this.projectWorkspace(id).addNode(id, unitId, kind, label, x, y, assetId, text)
  }

  /** Move one canvas node under an expected revision.
   * @param id - mounted project.
   * @param unitId - owning canvas.
   * @param nodeId - node identity.
   * @param revision - observed revision.
   * @param x - new x coordinate.
   * @param y - new y coordinate.
   * @returns updated node.
   */
  @Remote('moveCanvasNode')
  moveCanvasNode(id: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, revision: number, x: number, y: number): CanvasNode {
    return this.projectWorkspace(id).moveNode(id, unitId, nodeId, revision, x, y)
  }

  /** List indexed image, video and audio artifacts.
   * @param id - mounted project.
   * @returns media metadata.
   */
  @Remote('projectMedia')
  projectMedia(id: ProjectId): ProjectMediaAsset[] { return this.projectWorkspace(id).assets(id) }

  /** Import bounded media into one production canvas.
   * @param id - mounted project.
   * @param unitId - destination production unit.
   * @param name - source filename.
   * @param dataUrl - validated media bytes.
   * @returns indexed media.
   */
  @Remote('importProjectMedia')
  importProjectMedia(id: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): ProjectMediaAsset {
    return this.projectWorkspace(id).importMedia(id, unitId, name, dataUrl)
  }

  /** Return bounded media bytes for an original-image or audio/video preview.
   * @param id - mounted project.
   * @param assetId - indexed media identity.
   * @returns data URL or null when unknown.
   */
  @Remote('projectMediaData')
  projectMediaData(id: ProjectId, assetId: ProjectMediaId): string | null {
    return this.projectWorkspace(id).mediaData(id, assetId)
  }

  private creation(id: StudioCreationId): ProjectStore {
    const location = this.folders.list().find(folder => folder.creationId === id)
    return location ? this.requireFolder(location.id).store : this.legacy
  }

  private target(target: StudioTarget): ProjectStore {
    return target.kind === 'creation' ? this.creation(target.draftId) : this.project(target.projectId)
  }

  private owner(table: string, id: string): ProjectStore {
    const store = this.stores().find(store => store.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id))
    if (!store) return this.legacy
    if (store === this.legacy) {
      const row = store.db.prepare(`SELECT document FROM ${table} WHERE id = ?`).get(id)
      if (row) {
        const target = targetSchema.parse((JSON.parse(String(row.document)) as { target: unknown }).target)
        return this.target(target)
      }
    }
    return this.checked(store)
  }

  /**
   * Read recent portable locations without opening or creating project files.
   * @returns recent folders and availability.
   */
  @Remote('projectFolders')
  projectFolders(): StudioFolder[] { return this.folders.list(false) }

  /**
   * Open a portable project or creation form.
   * @param path - absolute project directory.
   * @returns its current location.
   */
  @Remote('openFolder')
  openFolder(path: string): StudioFolder {
    if (this.closing) throw new Error('The studio is closing')
    const folder = this.folders.open(path)
    if (this.backend) this.bindBackend(folder.store)
    return this.folders.describe(folder)
  }

  /**
   * Establish a portable creation form before any assistant task.
   * @param path - empty absolute directory.
   * @param id - form identity.
   * @param input - initial form.
   * @returns its saved location.
   */
  @Remote('prepareFolder')
  async prepareFolder(path: string, id: StudioCreationId, input: ProjectInput): Promise<StudioFolder> {
    if (this.closing) throw new Error('The studio is closing')
    targetSchema.parse({ kind: 'creation', draftId: id })
    const parsed = creationInputSchema.parse(input)
    if (this.folders.list().some(folder => folder.creationId === id)) throw new Error('This creation draft already has a location; open it first')
    const previous = this.legacy.creationDraft(id)
    if (previous) {
      for (const row of this.legacy.db.prepare("SELECT document FROM studio_tasks WHERE state = 'running'").all()) {
        const task = JSON.parse(String(row.document)) as StudioTask
        if (task.target.kind === 'creation' && task.target.draftId === id) await this.legacy.cancelAssistant(task.id)
      }
    }
    const folder = this.folders.create(path)
    try {
      const sessions = previous ? copyCreationRecords(this.legacy, folder.store, id) : []
      if (sessions.length) {
        if (!this.backend?.copySessions) throw new Error('The professional runtime is required to copy project conversations')
        await this.backend.copySessions(sessions, folder.info.path, folder.check)
      }
      const saved = folder.store.saveCreationDraft(id, previous?.revision ?? null, parsed)
      if (saved.status !== 'saved') throw new Error('Creation draft changed during migration; reload it before trying again')
      this.folders.finish(folder)
      if (this.backend) this.bindBackend(folder.store)
      return this.folders.describe(folder)
    } catch (error) {
      await folder.close()
      this.releaseLocation(folder.info.path)
      this.folders.discard(folder.info.id)
      throw error
    }
  }

  /**
   * Drain professional work, flush its history, then release all project files.
   * @param id - open folder identity.
   */
  @Remote('closeFolder')
  async closeFolder(id: StudioFolderId): Promise<void> {
    const folder = this.folders.opened.get(id)
    if (!folder) return
    this.folders.describe(folder)
    await folder.store.stopTasks()
    await this.backend?.closeProject?.(folder.info.path)
    this.backendDisposers.get(folder.store)?.()
    this.backendDisposers.delete(folder.store)
    await folder.close()
    this.releaseLocation(folder.info.path)
  }

  /**
   * Hide a catalog entry without accessing project files or changing its mounted runtime.
   * @param id - recent location identity.
   */
  @Remote('forgetFolder')
  forgetFolder(id: StudioFolderId): void { this.folders.forget(id) }

  /**
   * Reveal the currently opened directory on the application host.
   * @param id - mounted folder.
   * @param signal - caller cancellation.
   */
  @Remote('revealFolder')
  async revealFolder(id: StudioFolderId, signal: AbortSignal): Promise<void> {
    const folder = this.requireFolder(id)
    if (!canOpenNativePath()) throw new Error('This application host has no native file manager; use the displayed project path')
    await revealNativePath(folder.info.path, signal)
  }

  /** Copy a legacy project and its dialogue into an empty portable directory; the source remains intact.
   * @param id - legacy project identity.
   * @param path - empty destination directory.
   * @returns the opened portable location after all histories have been copied.
   */
  @Remote('migrateProject')
  async migrateProject(id: ProjectId, path: string): Promise<StudioFolder> {
    if (this.folders.list().some(folder => folder.projectId === id)) throw new Error('This project already has a folder')
    if (!this.legacy.get(id)) throw new Error('Legacy project not found')
    const running = this.legacy.db.prepare("SELECT document FROM studio_tasks WHERE state = 'running'").all()
    for (const row of running) {
      const task = JSON.parse(String(row.document)) as StudioTask
      if (task.target.kind !== 'creation' && task.target.projectId === id) await this.legacy.cancelAssistant(task.id)
    }
    const folder = this.folders.create(path)
    try {
      const sessions = copyProjectRecords(this.legacy, folder.store, id)
      if (sessions.length) {
        if (!this.backend?.copySessions) throw new Error('The professional runtime is required to copy project conversations')
        await this.backend.copySessions(sessions, folder.info.path, folder.check)
      }
      if (this.backend) this.bindBackend(folder.store)
      this.folders.finish(folder)
      return this.folders.describe(folder)
    } catch (error) {
      await folder.close()
      this.folders.discard(folder.info.id)
      throw error
    }
  }

  /**
   * Save a complete copy and close the source for transfer.
   * @param id - source folder.
   * @param destination - empty absolute destination.
   */
  @Remote('backupFolder')
  async backupFolder(id: StudioFolderId, destination: string): Promise<void> {
    const folder = this.requireFolder(id)
    await folder.store.stopTasks()
    await this.backend?.closeProject?.(folder.info.path)
    this.folders.backup(folder, destination)
    this.folders.describe(folder)
    await folder.close()
    this.releaseLocation(folder.info.path)
  }

  /**
   * Persist a recoverable editor buffer without creating a formal content revision.
   * @param id - project identity.
   * @param baseRevision - version edited.
   * @param input - complete buffer.
   */
  @Remote('saveEditorDraft')
  saveEditorDraft(id: ProjectId, baseRevision: number, input: ProjectInput): void {
    const store = this.project(id)
    store.assertWritable()
    revisionSchema.parse(baseRevision)
    const parsed = creationInputSchema.parse(input)
    if (!store.get(id)) throw new Error('Project not found')
    store.db.prepare('INSERT INTO studio_edit_drafts VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET base_revision = excluded.base_revision, document = excluded.document')
      .run(id, baseRevision, JSON.stringify(parsed))
  }

  /**
   * Read a recoverable buffer; its base revision may require conflict resolution.
   * @param id - project identity.
   * @returns saved buffer or null.
   */
  @Remote('editorDraft')
  editorDraft(id: ProjectId): { baseRevision: number; input: ProjectInput } | null {
    const row = this.project(id).db.prepare('SELECT base_revision, document FROM studio_edit_drafts WHERE project_id = ?').get(id)
    return row ? {
      baseRevision: revisionSchema.parse(row.base_revision), input: creationInputSchema.parse(JSON.parse(String(row.document))),
    } : null
  }

  /**
   * Resolve a professional Session's currently mounted directory.
   * @param id - reserved Session identity.
   * @returns current root and disk check, or undefined for legacy sessions.
   */
  sessionProject(id: SessionId): { root: string; check: () => void } | undefined {
    const location = this.sessionLocations.get(id)
    return location ? { root: location.root, check: location.check } : undefined
  }

  private releaseLocation(root: string): void {
    for (const [id, location] of this.sessionLocations) if (location.root === root) this.sessionLocations.delete(id)
    for (const [store, dispose] of this.backendDisposers) {
      if (store.projectRoot !== root) continue
      dispose()
      this.backendDisposers.delete(store)
    }
  }

  private bindBackend(store: ProjectStore): void {
    if (store.hasBackend || !this.backend) return
    const folder = [...this.folders.opened.values()].find(item => item.store === store)
    if (folder) {
      for (const row of store.db.prepare('SELECT session_id FROM studio_workspaces').all()) {
        const id = String(row.session_id) as SessionId
        const prior = this.sessionLocations.get(id)
        if (prior && prior.root !== folder.info.path) throw new Error('Session identity belongs to another open project')
        this.sessionLocations.set(id, { root: folder.info.path, check: folder.check, store })
      }
      this.backend.openProject?.(folder.info.path, folder.check)
    }
    this.backendDisposers.set(store, store.registerAssistantBackend(this.backend))
  }

  /**
   * List current projects, including archived ones, sorted by update time then stable identity.
   * @returns Metadata without creative text bodies; corrupt stored documents throw.
   */
  @Remote('list')
  list(): ProjectSummary[] {
    const locations = this.folders.list(false)
    const ids = new Set(this.folders.list().map(location => location.projectId))
    return [
      ...this.legacy.list().filter(project => !ids.has(project.id)),
      ...locations.flatMap(location => location.summary ? [location.summary] : []),
    ]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
  }

  /** Read the deployment upload limit before selecting a cover.
   * @returns maximum decoded image bytes accepted by setCover.
   */
  @Remote('coverUploadLimit')
  coverUploadLimit(): number {
    return this.legacy.coverUploadLimit()
  }

  /** Replace or remove a custom project cover independently of text revisions.
   * @param id - existing, non-archived project UUID.
   * @param expectedRevision - cover revision observed in list(); zero before any upload.
   * @param image - PNG, JPEG or WebP base64 data URL within coverUploadLimit(), or null to remove it.
   * @returns committed cover metadata; invalid images, stale revisions and archived projects throw without writing.
   */
  @Remote('setCover')
  setCover(id: ProjectId, expectedRevision: number, image: string | null): ProjectCover {
    return this.project(id).setCover(id, expectedRevision, image)
  }

  /**
   * Read the latest immutable revision directly from SQLite.
   * @param id - Existing or unknown canonical project UUID.
   * @returns The current document, or null when the project does not exist; corruption throws.
   */
  @Remote('get')
  get(id: ProjectId): Project | null {
    projectIdSchema.parse(id)
    if (this.folders.list().some(location => location.projectId === id)) return this.project(id).get(id)
    return this.stores().find(store => store.get(id) !== null)?.get(id) ?? null
  }

  /**
   * Persist a complete project without starting an agent or generation task.
   * @param input - Complete editable content with caller-created episode UUIDs.
   * @returns The first durable revision; invalid content or foreign episode ownership throws.
   */
  @Remote('create')
  create(input: ProjectInput): Project {
    return this.legacy.create(input)
  }

  /**
   * Save all editable content as a new immutable revision.
   * @param id - Project to edit; unknown projects throw.
   * @param expectedRevision - Revision used to prepare the caller's draft.
   * @param input - Complete replacement content; metadata fields are rejected.
   * @returns Saved revision or unchanged current project on conflict/archive; stale checks take precedence.
   */
  @Remote('save')
  save(id: ProjectId, expectedRevision: number, input: ProjectInput): SaveResult {
    const store = this.project(id)
    const result = store.save(id, expectedRevision, input)
    if (result.status === 'saved') store.db.prepare('DELETE FROM studio_edit_drafts WHERE project_id = ? AND document = ?').run(id, JSON.stringify(input))
    return result
  }

  /**
   * Archive or restore a project without altering its creative content.
   * @param id - Project to archive or restore; unknown projects throw.
   * @param expectedRevision - Revision used for this decision.
   * @param archived - True for read-only archive, false to restore editing.
   * @returns A new revision on transition, current revision for an identical state, or conflict.
   */
  @Remote('setArchived')
  setArchived(id: ProjectId, expectedRevision: number, archived: boolean): SaveResult {
    return this.project(id).setArchived(id, expectedRevision, archived)
  }

  /**
   * Read every project revision, including removed episodes and archive transitions.
   * @param id - Project UUID.
   * @returns Detached documents oldest first, or an empty array for an unknown project; corruption throws.
   */
  @Remote('history')
  history(id: ProjectId): Project[] {
    return this.get(id) ? this.project(id).history(id) : []
  }

  /** List saved creation forms independently of formal projects.
   * @returns recoverable, unpublished creation drafts.
   */
  @Remote('creationDrafts')
  creationDrafts(): StudioCreationSummary[] {
    const portableIds = new Set(this.folders.list().map(folder => folder.creationId))
    return this.stores().flatMap(store => store === this.legacy
      ? store.creationDrafts().filter(draft => !portableIds.has(draft.id)) : store.creationDrafts())
  }

  /** Reopen the latest saved creation form without invoking an assistant.
   * @param id - creation-form identity.
   * @returns saved input or null when unknown.
   */
  @Remote('creationDraft')
  creationDraft(id: StudioCreationId): StudioCreationDraft | null {
    return this.creation(id).creationDraft(id)
  }

  /** Save a creation form without creating a Project or starting an Agent.
   * @param id - independent creation-form identity.
   * @param expectedRevision - last observed form revision, or null for a new form.
   * @param input - complete form fields; the title may still be empty.
   * @returns saved state or a conflict retaining current data.
   */
  @Remote('saveCreationDraft')
  saveCreationDraft(id: StudioCreationId, expectedRevision: number | null, input: ProjectInput): StudioCreationSaveResult {
    return this.creation(id).saveCreationDraft(id, expectedRevision, input)
  }

  /** Create a formal project from a saved form exactly once.
   * @param id - creation-form identity.
   * @param expectedRevision - form version confirmed by the user.
   * @param input - valid complete project content.
   * @returns the created project; stale or different repeated input is rejected.
   */
  @Remote('createFromDraft')
  createFromDraft(id: StudioCreationId, expectedRevision: number, input: ProjectInput): Project {
    const store = this.creation(id)
    const project = store.createFromDraft(id, expectedRevision, input)
    const folder = [...this.folders.opened.values()].find(folder => folder.store === store)
    if (folder) this.folders.describe(folder)
    return project
  }

  /** Read actual dependency availability for the professional configuration panel.
   * @returns registered capabilities; missing providers are reported explicitly.
   */
  @Remote('assistantCatalog')
  async assistantCatalog(): Promise<StudioAssistantCatalog> {
    return this.legacy.assistantCatalog()
  }

  /** Read the field policy used by both proposal schemas and application validation.
   * @param target - frozen authoring target.
   * @returns target-owned field identities.
   */
  proposalFields(target: StudioTarget): StudioField[] {
    return this.legacy.proposalFields(target)
  }

  /** List the published professional-role configurations.
   * @param folderId - open project identity, or omit for device templates.
   * @returns one current version for each role.
   */
  @Remote('roles')
  roles(folderId?: StudioFolderId): StudioRoleRevision[] {
    return (folderId ? this.requireFolder(folderId).store : this.legacy).roles()
  }

  /** Publish a human-edited role configuration; existing workspaces retain their versions.
   * @param role - role identity.
   * @param expectedRevision - version edited by the user.
   * @param config - complete professional configuration.
   * @param folderId - open project identity, or omit for device templates.
   * @returns the new immutable role revision.
   */
  @Remote('publishRole')
  async publishRole(
    role: StudioRoleId, expectedRevision: number, config: StudioRoleConfig, folderId?: StudioFolderId,
  ): Promise<StudioRoleRevision> {
    return (folderId ? this.requireFolder(folderId).store : this.legacy).publishRole(role, expectedRevision, config)
  }

  /** Open recorded dialogue without starting an Agent or making a model request.
   * @param target - stable project, episode, or creation-form target.
   * @param newConversation - create a separate dialogue instead of reopening the latest one.
   * @returns its current role-version binding and recorded work.
   */
  @Remote('openWorkspace')
  openWorkspace(target: StudioTarget, newConversation?: boolean): StudioWorkspaceView {
    const store = this.target(target)
    const view = store.openWorkspace(target, newConversation ?? false)
    const folder = [...this.folders.opened.values()].find(item => item.store === store)
    if (folder) this.sessionLocations.set(view.workspace.sessionId, { root: folder.info.path, check: folder.check, store })
    return view
  }

  /** Read a previously bound workspace, including in-flight tasks from an older role version.
   * @param id - workspace identity.
   * @returns recorded tasks, suggestions, and locks.
   */
  @Remote('workspace')
  workspace(id: StudioWorkspaceId): StudioWorkspaceView {
    return this.owner('studio_workspaces', id).workspace(id)
  }

  /** Resolve host policy when the Harness creates or resumes a bound Session.
   * @param sessionId - actual Session identity, never a model-reported role.
   * @returns its immutable professional binding, or null for an ordinary Session.
   */
  workspaceForSession(sessionId: SessionId): StudioWorkspace | null {
    return (this.sessionLocations.get(sessionId)?.store ?? this.legacy).workspaceForSession(sessionId)
  }

  /** Record successful Session creation before sending its first professional input.
   * @param id - workspace whose reserved Session now exists.
   */
  markWorkspaceSession(id: StudioWorkspaceId): void {
    this.owner('studio_workspaces', id).markWorkspaceSession(id)
  }

  /** Install one trusted professional execution provider for this project service.
   * @param backend - real Agent/Session execution provider.
   * @returns a disposer that removes the provider; its owner drains live Agents.
   */
  registerAssistantBackend(backend: StudioAssistantBackend): () => void {
    if (this.backend) throw new Error('A professional execution provider is already registered')
    this.backend = backend
    for (const store of this.stores()) this.bindBackend(store)
    return () => {
      if (this.backend !== backend) return
      this.backend = undefined
      for (const dispose of this.backendDisposers.values()) dispose()
      this.backendDisposers.clear()
    }
  }

  /** Capture a human request, then execute independently of browser navigation.
   * @param request - immutable target binding, local input, expected revision, and prompt.
   * @returns the recorded task immediately; waitTask observes its settlement.
   */
  @Remote('startAssistant')
  async startAssistant(request: StudioTaskRequest): Promise<StudioTaskView> {
    return this.owner('studio_workspaces', request.workspaceId).startAssistant(request)
  }

  /** Assert that a professional execution belongs to this service's live dispatch and durable snapshot.
   * @param task - snapshot supplied to the registered execution provider.
   * @throws when an unowned or altered task attempts to drive a Session.
   */
  assertAssistantTask(task: StudioTask): void {
    this.owner('studio_tasks', task.id).assertAssistantTask(task)
  }

  /** Await a task's recorded settlement without polling a model or repeating submission.
   * @param id - task identity returned by startAssistant.
   * @returns terminal state, or current state when another process owns execution.
   */
  @Remote('waitTask')
  async waitTask(id: StudioTaskId): Promise<StudioTaskView> {
    return this.owner('studio_tasks', id).waitTask(id)
  }

  /** Stop owned professional work; external-process work is never falsely reported as stopped.
   * @param id - task identity.
   * @returns recorded final state after the Agent is quiescent.
   */
  @Remote('cancelAssistant')
  async cancelAssistant(id: StudioTaskId): Promise<StudioTaskView> {
    return this.owner('studio_tasks', id).cancelAssistant(id)
  }

  /** Apply human-selected suggestions to a draft; this never approves content.
   * @param request - selected fields and current local/saved input.
   * @returns new draft input or an explicit conflict/lock/archive rejection.
   */
  @Remote('applyProposal')
  applyProposal(request: StudioApplyRequest): StudioApplyResult {
    return this.owner('studio_proposals', request.proposalId).applyProposal(request)
  }

  /** Ignore pending proposal fields without editing the project.
   * @param id - proposal identity.
   * @param fields - pending fields selected by the user.
   * @returns updated proposal disposition.
   */
  @Remote('ignoreProposal')
  ignoreProposal(id: StudioProposalId, fields: StudioField[]): StudioProposal {
    return this.owner('studio_proposals', id).ignoreProposal(id, fields)
  }

  /** Protect selected fields from assistant proposal application.
   * @param target - authoring target.
   * @param fields - complete set of protected fields.
   * @returns the saved lock set.
   */
  @Remote('setFieldLocks')
  setFieldLocks(target: StudioTarget, fields: StudioField[]): StudioField[] {
    return this.target(target).setFieldLocks(target, fields)
  }

  /** Submit a saved target for human content review.
   * @param target - existing project content.
   * @param expectedRevision - exact saved project version.
   * @returns the queued review record.
   */
  @Remote('submitReview')
  submitReview(target: Exclude<StudioTarget, { kind: 'creation' }>, expectedRevision: number): StudioReview {
    return this.target(target).submitReview(target, expectedRevision)
  }

  /** Read pending and completed reviews for a project.
   * @param id - project identity.
   * @returns reviews tied to their original saved versions.
   */
  @Remote('reviews')
  reviews(id: ProjectId): StudioReview[] {
    return this.project(id).reviews(id)
  }

  /** Read the global human review queue across projects.
   * @returns review records carrying explicit project and version references.
   */
  @Remote('reviewQueue')
  reviewQueue(): StudioReview[] {
    const portableIds = new Set(this.folders.list().map(folder => folder.projectId))
    return this.stores().flatMap(store => store === this.legacy
      ? store.reviewQueue().filter(review => !portableIds.has(review.target.projectId)) : store.reviewQueue())
  }

  /** Read an approved immutable input for a controlled, workspace-scoped context tool.
   * @param id - review identity already authorized by the frozen task.
   * @returns exact approved fields and their review reference.
   */
  approvedContext(id: StudioReviewId): { review: StudioReview; fields: { field: StudioField; value: StudioFieldValue }[] } {
    return this.owner('studio_reviews', id).approvedContext(id)
  }

  /** Record a human approval or return; professional tools do not expose this operation.
   * @param id - pending review identity.
   * @param decision - approve or return the saved content.
   * @param comment - review explanation.
   * @returns the immutable decision.
   */
  @Remote('decideReview')
  decideReview(id: StudioReviewId, decision: 'approved' | 'returned', comment: string): StudioReview {
    return this.owner('studio_reviews', id).decideReview(id, decision, comment)
  }
}

export default StudioProjects
