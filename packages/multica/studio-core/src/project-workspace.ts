/** Project-local Markdown files, production units, canvas nodes and media references. */
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { ProjectStore } from './project-store.ts'
import type { CanvasNode, CanvasNodeId, EpisodeId, ProductionUnit, ProductionUnitId, Project, ProjectId, ProjectInput, ProjectMediaAsset, ProjectMediaId, ScriptDocument, ScriptDocumentId } from './types.ts'

const MAX_MEDIA_BYTES = 16 * 1024 * 1024
const MEDIA: Record<string, { kind: ProjectMediaAsset['kind']; ext: string }> = {
  'image/png': { kind: 'image', ext: 'png' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
}

type DocumentRow = {
  id: string
  project_id: string
  kind: ScriptDocument['kind']
  episode_id: string | null
  title: string
  relative_path: string
  markdown: string
  revision: number
}
type UnitRow = {
  id: string
  project_id: string
  kind: ProductionUnit['kind']
  episode_id: string | null
  title: string
  created_at: string
}
type NodeRow = {
  id: string
  unit_id: string
  kind: CanvasNode['kind']
  label: string
  text: string | null
  x: number
  y: number
  asset_id: string | null
  revision: number
}
type MediaRow = {
  id: string
  project_id: string
  unit_id: string
  kind: ProjectMediaAsset['kind']
  name: string
  mime: string
  relative_path: string
  byte_size: number
  created_at: string
}

function id(value: string): string { return z.uuid().parse(value) }
function digest(project: Project): string {
  return createHash('sha256').update(JSON.stringify([project.outline,
    project.episodes.map(episode => [episode.id, episode.title, episode.script])])).digest('hex')
}
function document(row: DocumentRow): ScriptDocument {
  return { id: id(row.id) as ScriptDocumentId, projectId: id(row.project_id) as ProjectId,
    kind: row.kind, episodeId: row.episode_id as EpisodeId | null,
    title: row.title, relativePath: row.relative_path, markdown: row.markdown, revision: row.revision }
}
function unit(row: UnitRow): ProductionUnit {
  return { id: id(row.id) as ProductionUnitId, projectId: id(row.project_id) as ProjectId,
    kind: row.kind, episodeId: row.episode_id as EpisodeId | null, title: row.title, createdAt: row.created_at }
}
function node(row: NodeRow): CanvasNode {
  return { id: id(row.id) as CanvasNodeId, unitId: id(row.unit_id) as ProductionUnitId,
    kind: row.kind, label: row.label, text: row.text, x: row.x, y: row.y,
    assetId: row.asset_id as ProjectMediaId | null, revision: row.revision }
}
function media(row: MediaRow): ProjectMediaAsset {
  return { id: id(row.id) as ProjectMediaId, projectId: id(row.project_id) as ProjectId,
    unitId: id(row.unit_id) as ProductionUnitId, kind: row.kind, name: row.name,
    mime: row.mime, byteSize: row.byte_size, createdAt: row.created_at }
}

/** Host operations scoped to one already-open portable project. */
export class ProjectWorkspace {
  private readonly db: DatabaseSync
  private readonly root: string

  /** @param store - project database and its mounted directory. */
  constructor(private readonly store: ProjectStore) {
    if (!store.projectRoot) throw new Error('Move this project into its own folder before using the project workspace')
    this.db = store.db
    this.root = store.projectRoot
  }

  private project(projectId: ProjectId): Project {
    const project = this.store.get(id(projectId) as ProjectId)
    if (!project) throw new Error('Project not found')
    return project
  }

  private scriptsRoot(): string {
    const path = join(this.root, 'scripts')
    mkdirSync(path, { recursive: true, mode: 0o700 })
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Project scripts directory is not a regular directory')
    return path
  }

  private materialize(row: DocumentRow): void {
    const relative = row.relative_path
    if (!/^scripts\/(?:故事大纲|人物小传|episodes\/[0-9a-f-]{36})\.md$/.test(relative))
      throw new Error('Invalid project script path')
    const root = this.scriptsRoot()
    const path = join(this.root, relative)
    const parent = dirname(path)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
    if (lstatSync(parent).isSymbolicLink()) throw new Error('Project script folder cannot be a link')
    if (existsSync(path)) {
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Project script file is not a regular file')
      if (readFileSync(path, 'utf8') === row.markdown) return
    }
    const temporary = join(root, `.script-${randomUUID()}`)
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, row.markdown) } finally { closeSync(fd) }
    try { renameSync(temporary, path) } catch (error) { unlinkSync(temporary); throw error }
  }

  private sync(project: Project): DocumentRow[] {
    const expected: Array<Pick<DocumentRow, 'kind' | 'episode_id' | 'title' | 'relative_path' | 'markdown'>> = [
      { kind: 'outline', episode_id: null, title: '故事大纲.md', relative_path: 'scripts/故事大纲.md',
        markdown: `# 故事大纲\n\n${project.outline}` },
      { kind: 'characters', episode_id: null, title: '人物小传.md', relative_path: 'scripts/人物小传.md', markdown: '# 人物小传\n\n' },
      ...project.episodes.map((episode, index) => ({ kind: 'episode' as const, episode_id: episode.id,
        title: `第${String(index + 1).padStart(2, '0')}集剧本.md`,
        relative_path: `scripts/episodes/${episode.id}.md`, markdown: `# ${episode.title}\n\n${episode.script}` })),
    ]
    for (const item of expected) {
      const prior = this.db.prepare('SELECT * FROM studio_script_documents WHERE project_id = ? AND relative_path = ?')
        .get(project.id, item.relative_path) as DocumentRow | undefined
      if (!prior) {
        this.db.prepare('INSERT INTO studio_script_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), project.id, item.kind, item.episode_id, item.title, item.relative_path, item.markdown,
            item.kind === 'characters' ? 1 : project.revision)
      } else if (item.kind !== 'characters' && (prior.markdown !== item.markdown || prior.title !== item.title || prior.revision !== project.revision)) {
        this.db.prepare('UPDATE studio_script_documents SET title = ?, markdown = ?, revision = ? WHERE id = ?')
          .run(item.title, item.markdown, project.revision, prior.id)
      }
    }
    const rows = this.db.prepare('SELECT * FROM studio_script_documents WHERE project_id = ?').all(project.id) as DocumentRow[]
    for (const row of rows) this.materialize(row)
    return rows
  }

  /** List and materialize project Markdown documents from committed project content.
   * @param projectId - mounted project identity.
   * @returns outline, character biographies, then episode scripts.
   */
  documents(projectId: ProjectId): ScriptDocument[] {
    const project = this.project(projectId)
    const rows = this.sync(project)
    const byPath = new Map(rows.map(row => [row.relative_path, row]))
    return ['scripts/故事大纲.md', 'scripts/人物小传.md',
      ...project.episodes.map(episode => `scripts/episodes/${episode.id}.md`)]
      .map((path) => {
        const row = byPath.get(path)
        if (!row) throw new Error('Project script document is missing')
        return document(row)
      })
  }

  /** Read a script document after refreshing its project-owned projection.
   * @param projectId - mounted project.
   * @param documentId - document identity.
   * @returns document or null when unknown.
   */
  readDocument(projectId: ProjectId, documentId: ScriptDocumentId): ScriptDocument | null {
    return this.documents(projectId).find(item => item.id === id(documentId)) ?? null
  }

  /** Save one Markdown document against its observed revision.
   * @param projectId - mounted project.
   * @param documentId - existing document.
   * @param expectedRevision - caller-observed version.
   * @param markdown - replacement Markdown text.
   * @returns committed document; conflicts throw without changing content.
   */
  saveDocument(projectId: ProjectId, documentId: ScriptDocumentId, expectedRevision: number, markdown: string): ScriptDocument {
    const project = this.project(projectId)
    const current = this.readDocument(projectId, documentId)
    if (!current) throw new Error('Script document not found')
    if (current.revision !== z.number().int().positive().parse(expectedRevision)) throw new Error('Script document changed; refresh before saving')
    const body = z.string().max(2_000_000).parse(markdown)
    if (current.kind !== 'characters') {
      const withoutHeading = body.replace(/^# [^\n]*\n(?:\n)?/, '')
      const input: ProjectInput = {
        name: project.name, concept: project.concept, sourceText: project.sourceText,
        aspectRatio: project.aspectRatio, targetEpisodes: project.targetEpisodes,
        episodeDuration: project.episodeDuration,
        outline: current.kind === 'outline' ? withoutHeading : project.outline,
        episodes: current.kind === 'episode'
          ? project.episodes.map(episode => episode.id === current.episodeId
            ? { ...episode, title: body.match(/^# ([^\n]+)/)?.[1] ?? episode.title, script: withoutHeading }
            : episode)
          : project.episodes,
      }
      const result = this.store.save(project.id, project.revision, input)
      if (result.status !== 'saved') throw new Error('Project changed; refresh the script before saving')
    } else {
      this.db.prepare('UPDATE studio_script_documents SET markdown = ?, revision = revision + 1 WHERE id = ?')
        .run(body, current.id)
    }
    const saved = this.readDocument(projectId, documentId)
    if (!saved) throw new Error('Saved script document is missing')
    return saved
  }

  /** Confirm the current complete script before opening production.
   * @param projectId - mounted project.
   * @param expectedRevision - saved project revision reviewed by the user.
   * @returns whether this script remains complete at the current revision.
   */
  completeScript(projectId: ProjectId, expectedRevision: number): boolean {
    const project = this.project(projectId)
    if (project.revision !== expectedRevision) throw new Error('Project changed; refresh before confirming the script')
    if (!project.outline.trim() || project.episodes.length === 0
      || project.episodes.some(episode => !episode.title.trim() || !episode.script.trim()))
      throw new Error('Complete the outline and every episode script before starting production')
    this.db.prepare(`INSERT INTO studio_script_completion VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET digest = excluded.digest, confirmed_at = excluded.confirmed_at`)
      .run(project.id, digest(project), new Date().toISOString())
    return true
  }

  /** Check script confirmation against the actual current script content.
   * @param projectId - mounted project.
   * @returns true only while the confirmed script content is unchanged.
   */
  scriptComplete(projectId: ProjectId): boolean {
    const project = this.project(projectId)
    return this.db.prepare('SELECT digest FROM studio_script_completion WHERE project_id = ?').get(project.id)?.digest === digest(project)
  }

  /** Read production units belonging to one project.
   * @param projectId - mounted project.
   * @returns oldest unit first.
   */
  units(projectId: ProjectId): ProductionUnit[] {
    this.project(projectId)
    return (this.db.prepare('SELECT * FROM studio_production_units WHERE project_id = ? ORDER BY created_at, rowid')
      .all(projectId) as UnitRow[]).map(unit)
  }

  /** Create a canvas for one episode or the complete film.
   * @param projectId - mounted project with confirmed script.
   * @param kind - episode or whole-film unit.
   * @param episodeId - episode identity when kind is episode.
   * @param title - user-visible production title.
   * @returns created unit with one script source node.
   */
  createUnit(projectId: ProjectId, kind: ProductionUnit['kind'], episodeId: EpisodeId | null, title: string): ProductionUnit {
    const project = this.project(projectId)
    if (!this.scriptComplete(projectId)) throw new Error('Confirm the complete script before creating production units')
    const episode = episodeId === null ? undefined : project.episodes.find(item => item.id === id(episodeId))
    if ((kind === 'episode') !== (episode !== undefined)) throw new Error('Choose an episode for an episode production unit')
    const name = z.string().trim().min(1).max(120).parse(title)
    const created: ProductionUnit = { id: randomUUID() as ProductionUnitId, projectId, kind,
      episodeId, title: name, createdAt: new Date().toISOString() }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO studio_production_units VALUES (?, ?, ?, ?, ?, ?)')
        .run(created.id, projectId, kind, episodeId, name, created.createdAt)
      this.db.prepare('INSERT INTO studio_canvas_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), created.id, 'script', episode?.title ?? '完整剧本', episode?.script ?? project.outline, 120, 160, null, 1)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return created
  }

  private requireUnit(projectId: ProjectId, unitId: ProductionUnitId): UnitRow {
    const row = this.db.prepare('SELECT * FROM studio_production_units WHERE id = ? AND project_id = ?')
      .get(id(unitId), id(projectId)) as UnitRow | undefined
    if (!row) throw new Error('Production unit not found in this project')
    return row
  }

  /** List every node in one production unit.
   * @param projectId - mounted project.
   * @param unitId - production unit.
   * @returns its persisted nodes.
   */
  nodes(projectId: ProjectId, unitId: ProductionUnitId): CanvasNode[] {
    this.requireUnit(projectId, unitId)
    return (this.db.prepare('SELECT * FROM studio_canvas_nodes WHERE unit_id = ? ORDER BY rowid').all(unitId) as NodeRow[]).map(node)
  }

  /** Add a text node or a reference to a media asset.
   * @param projectId - mounted project.
   * @param unitId - owning production unit.
   * @param kind - node content kind.
   * @param label - visible node title.
   * @param x - canvas coordinate.
   * @param y - canvas coordinate.
   * @param assetId - media reference, or null for a text node.
   * @param text - complete text-node content, or null for media.
   * @returns created node.
   */
  addNode(projectId: ProjectId, unitId: ProductionUnitId, kind: CanvasNode['kind'], label: string,
    x: number, y: number, assetId: ProjectMediaId | null, text: string | null): CanvasNode {
    this.requireUnit(projectId, unitId)
    if (!['script', 'image', 'video', 'audio'].includes(kind)) throw new Error('Invalid canvas node kind')
    if (assetId !== null) {
      const asset = this.db.prepare('SELECT kind FROM studio_media_assets WHERE id = ? AND unit_id = ?').get(id(assetId), unitId)
      if (asset?.kind !== kind) throw new Error('Canvas media reference is outside this production unit')
    } else if (kind !== 'script') throw new Error('Media nodes require an asset')
    const caption = z.string().trim().min(1).max(500).parse(label)
    const body = text === null ? null : z.string().max(100_000).parse(text)
    if ((kind === 'script') !== (body !== null)) throw new Error('Text nodes need content; media nodes cannot carry text')
    const position = z.number().min(-100_000).max(100_000)
    position.parse(x); position.parse(y)
    const created: CanvasNode = { id: randomUUID() as CanvasNodeId, unitId, kind, label: caption, text: body,
      x, y, assetId, revision: 1 }
    this.db.prepare('INSERT INTO studio_canvas_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(created.id, unitId, kind, caption, body, x, y, assetId, 1)
    return created
  }

  /** Move a node only when the caller still owns its observed version.
   * @param projectId - mounted project.
   * @param unitId - production unit.
   * @param nodeId - node identity.
   * @param expectedRevision - observed node revision.
   * @param x - destination x coordinate.
   * @param y - destination y coordinate.
   * @returns updated node or a conflict error.
   */
  moveNode(projectId: ProjectId, unitId: ProductionUnitId, nodeId: CanvasNodeId, expectedRevision: number,
    x: number, y: number): CanvasNode {
    this.requireUnit(projectId, unitId)
    const position = z.number().min(-100_000).max(100_000)
    position.parse(x); position.parse(y)
    const result = this.db.prepare(`UPDATE studio_canvas_nodes SET x = ?, y = ?, revision = revision + 1
      WHERE id = ? AND unit_id = ? AND revision = ?`).run(x, y, id(nodeId), unitId, z.number().int().positive().parse(expectedRevision))
    if (result.changes !== 1) throw new Error('Canvas node changed; refresh before moving it')
    const moved = this.nodes(projectId, unitId).find(item => item.id === nodeId)
    if (!moved) throw new Error('Moved canvas node is missing')
    return moved
  }

  /** List media produced or imported for a project.
   * @param projectId - mounted project.
   * @returns media metadata without embedded bytes.
   */
  assets(projectId: ProjectId): ProjectMediaAsset[] {
    this.project(projectId)
    return (this.db.prepare('SELECT * FROM studio_media_assets WHERE project_id = ? ORDER BY created_at DESC, id')
      .all(projectId) as MediaRow[]).map(media)
  }

  /** Import one bounded image, video or audio into a production unit and place its node.
   * @param projectId - mounted project.
   * @param unitId - owning production unit.
   * @param name - display filename.
   * @param dataUrl - base64 media data URL.
   * @returns the committed media asset.
   */
  importMedia(projectId: ProjectId, unitId: ProductionUnitId, name: string, dataUrl: string): ProjectMediaAsset {
    this.requireUnit(projectId, unitId)
    const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    const declaredMime = match?.[1]
    const format = declaredMime ? MEDIA[declaredMime] : undefined
    const encoded = match?.[2]
    if (!format || !declaredMime || !encoded || encoded.length > Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4)
      throw new Error('Choose a supported media file under 16 MiB')
    const bytes = Buffer.from(encoded, 'base64')
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES || bytes.toString('base64') !== encoded)
      throw new Error('Invalid media encoding or size')
    const signature = format.kind === 'image'
      ? format.ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : format.ext === 'jpg' ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
          : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : format.ext === 'mp4' ? bytes.toString('ascii', 4, 8) === 'ftyp'
        : format.ext === 'wav' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE'
          : format.ext === 'ogg' ? bytes.toString('ascii', 0, 4) === 'OggS'
            : bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff
    if (!signature) throw new Error('Media bytes do not match the declared type')
    const fileName = z.string().trim().min(1).max(180).parse(name)
    const assetId = randomUUID() as ProjectMediaId
    const relative = `artifacts/${unitId}/${assetId}.${format.ext}`
    const artifacts = join(this.root, 'artifacts')
    mkdirSync(artifacts, { recursive: true, mode: 0o700 })
    if (!lstatSync(artifacts).isDirectory() || lstatSync(artifacts).isSymbolicLink())
      throw new Error('Project artifact root is not a regular directory')
    const folder = join(artifacts, unitId)
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())
      throw new Error('Project artifact directory is not a regular directory')
    const path = join(this.root, relative)
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
    const created: ProjectMediaAsset = { id: assetId, projectId, unitId, kind: format.kind,
      name: fileName, mime: declaredMime, byteSize: bytes.length, createdAt: new Date().toISOString() }
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('INSERT INTO studio_media_assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(assetId, projectId, unitId, format.kind, fileName, created.mime, relative, bytes.length, created.createdAt)
      this.db.prepare('INSERT INTO studio_canvas_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), unitId, format.kind, fileName, null, 420, 240, assetId, 1)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); unlinkSync(path); throw error }
    return created
  }

  /** Read one indexed media file without accepting a path from the browser.
   * @param projectId - mounted project.
   * @param assetId - registered asset.
   * @returns bounded media data URL, or null when not found.
   */
  mediaData(projectId: ProjectId, assetId: ProjectMediaId): string | null {
    this.project(projectId)
    const row = this.db.prepare('SELECT * FROM studio_media_assets WHERE project_id = ? AND id = ?').get(projectId, id(assetId)) as MediaRow | undefined
    if (!row) return null
    if (!/^artifacts\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|mp4|mp3|wav|ogg)$/.test(row.relative_path))
      throw new Error('Invalid project media path')
    const artifacts = join(this.root, 'artifacts')
    const folder = dirname(join(this.root, row.relative_path))
    if (!lstatSync(artifacts).isDirectory() || lstatSync(artifacts).isSymbolicLink()
      || !lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())
      throw new Error('Project media directory is not a regular directory')
    const path = join(this.root, row.relative_path)
    if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Project media is not a regular file')
    const bytes = readFileSync(path)
    if (bytes.length !== row.byte_size || bytes.length > MAX_MEDIA_BYTES) throw new Error('Project media changed on disk')
    return `data:${row.mime};base64,${bytes.toString('base64')}`
  }
}
