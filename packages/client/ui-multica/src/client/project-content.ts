/** React-free projection of project Markdown, production and media state. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CanvasNode, CanvasNodeId, EpisodeId, ProductionUnit, ProductionUnitId, ProjectId, ProjectMediaAsset, ProjectMediaId, ScriptDocument, ScriptDocumentId } from '@deepseek-ai/dsh-api-remotes/client'

/** Typed Host callbacks used by the project content model. */
export interface ProjectContentApi {
  documents(id: ProjectId): Promise<ScriptDocument[]>
  saveDocument(id: ProjectId, documentId: ScriptDocumentId, revision: number, markdown: string): Promise<ScriptDocument>
  complete(id: ProjectId): Promise<boolean>
  confirm(id: ProjectId, revision: number): Promise<boolean>
  units(id: ProjectId): Promise<ProductionUnit[]>
  createUnit(id: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): Promise<ProductionUnit>
  nodes(id: ProjectId, unitId: ProductionUnitId): Promise<CanvasNode[]>
  addNode(id: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string,
    x: number, y: number, assetId: ProjectMediaId | null, text: string | null): Promise<CanvasNode>
  moveNode(id: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, revision: number, x: number, y: number): Promise<CanvasNode>
  assets(id: ProjectId): Promise<ProjectMediaAsset[]>
  importMedia(id: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): Promise<ProjectMediaAsset>
  mediaData(id: ProjectId, assetId: ProjectMediaId): Promise<string | null>
}

/** One project's observable content, independent of selected document or unit. */
export interface ProjectContentState {
  projectId: ProjectId | null
  documents: ScriptDocument[]
  complete: boolean
  units: ProductionUnit[]
  nodes: Partial<Record<ProductionUnitId, CanvasNode[]>>
  assets: ProjectMediaAsset[]
  busy: boolean
  error: string | null
}

/** Plain commands passed to the project workspace component. */
export interface ProjectContentActions {
  load(id: ProjectId): Promise<void>
  loadNodes(id: ProjectId, unitId: ProductionUnitId): Promise<void>
  saveDocument(id: ProjectId, documentId: ScriptDocumentId, revision: number, markdown: string): Promise<ScriptDocument>
  confirm(id: ProjectId, revision: number): Promise<void>
  createUnit(id: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): Promise<ProductionUnit>
  addNode(id: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string,
    x: number, y: number, assetId: ProjectMediaId | null, text: string | null): Promise<void>
  moveNode(id: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, revision: number, x: number, y: number): Promise<void>
  importMedia(id: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): Promise<void>
  mediaData(id: ProjectId, assetId: ProjectMediaId): Promise<string | null>
}

/** Host-owned project data projected through one stable client source. */
export class ProjectContentModel {
  /** Documents, units, assets and request state consumed by the injected hook. */
  readonly source = createSnapshotStore<ProjectContentState>({ projectId: null, documents: [], complete: false,
    units: [], nodes: {}, assets: [], busy: false, error: null })
  private alive = true
  private request = 0

  /** @param api - generated Remote callbacks. */
  constructor(private readonly api: ProjectContentApi) {}

  /** Silence late reads after the plugin is unloaded. */
  dispose(): void { this.alive = false }

  /** Refresh the active project's content without replacing another project's state.
   * @param id - mounted project identity.
   */
  async load(id: ProjectId): Promise<void> {
    const request = ++this.request
    this.source.update((d) => { d.projectId = id; d.busy = true; d.error = null })
    try {
      const [documents, complete, units, assets] = await Promise.all([
        this.api.documents(id), this.api.complete(id), this.api.units(id), this.api.assets(id),
      ])
      if (this.alive && request === this.request) this.source.update((d) => {
        d.documents = documents; d.complete = complete; d.units = units; d.assets = assets; d.busy = false
      })
    } catch (error) {
      if (this.alive && request === this.request) this.source.update((d) => {
        d.busy = false; d.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Refresh one canvas after navigation or mutation.
   * @param id - mounted project.
   * @param unitId - canvas unit.
   */
  async loadNodes(id: ProjectId, unitId: ProductionUnitId): Promise<void> {
    const nodes = await this.api.nodes(id, unitId)
    if (this.alive && this.source.getSnapshot().projectId === id)
      this.source.update((d) => { d.nodes[unitId] = nodes })
  }

  /** Save one script and refresh its project projection.
   * @param id - mounted project.
   * @param documentId - script document.
   * @param revision - observed version.
   * @param markdown - complete replacement text.
   * @returns committed document.
   */
  async saveDocument(id: ProjectId, documentId: ScriptDocumentId, revision: number, markdown: string): Promise<ScriptDocument> {
    const saved = await this.api.saveDocument(id, documentId, revision, markdown)
    await this.load(id)
    return saved
  }

  /** Confirm the current saved script before production.
   * @param id - mounted project.
   * @param revision - user-reviewed project version.
   */
  async confirm(id: ProjectId, revision: number): Promise<void> {
    await this.api.confirm(id, revision)
    await this.load(id)
  }

  /** Create and select a production unit.
   * @param id - mounted project.
   * @param kind - episode or whole-film template.
   * @param episodeId - selected episode or null.
   * @param title - user-visible unit name.
   * @returns created unit.
   */
  async createUnit(id: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): Promise<ProductionUnit> {
    const created = await this.api.createUnit(id, kind, episodeId, title)
    await this.load(id)
    await this.loadNodes(id, created.id)
    return created
  }

  /** Add a node to a production canvas.
   * @param id - mounted project.
   * @param unitId - canvas unit.
   * @param kind - node kind.
   * @param label - visible title.
   * @param x - canvas coordinate.
   * @param y - canvas coordinate.
   * @param assetId - referenced media or null.
   * @param text - full text-node content or null.
   */
  async addNode(id: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string,
    x: number, y: number, assetId: ProjectMediaId | null, text: string | null): Promise<void> {
    await this.api.addNode(id, unitId, kind, label, x, y, assetId, text)
    await this.loadNodes(id, unitId)
  }

  /** Move a node and refresh the canvas on success.
   * @param id - mounted project.
   * @param unitId - canvas unit.
   * @param nodeId - node identity.
   * @param revision - observed node version.
   * @param x - new canvas x.
   * @param y - new canvas y.
   */
  async moveNode(id: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, revision: number, x: number, y: number): Promise<void> {
    await this.api.moveNode(id, unitId, nodeId, revision, x, y)
    await this.loadNodes(id, unitId)
  }

  /** Import local media, then refresh canvas and asset catalog.
   * @param id - mounted project.
   * @param unitId - target production unit.
   * @param name - user-selected filename.
   * @param dataUrl - bounded media data URL.
   */
  async importMedia(id: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): Promise<void> {
    await this.api.importMedia(id, unitId, name, dataUrl)
    await this.load(id)
    await this.loadNodes(id, unitId)
  }

  /** Read bytes only for the selected preview.
   * @param id - mounted project.
   * @param assetId - indexed media.
   * @returns media data URL or null.
   */
  async mediaData(id: ProjectId, assetId: ProjectMediaId): Promise<string | null> {
    return this.api.mediaData(id, assetId)
  }
}
