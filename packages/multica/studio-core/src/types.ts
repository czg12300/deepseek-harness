/** Client-safe Multica project documents; episode versions use their project revision. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Host-created UUID identifying a project across all its revisions. */
export type ProjectId = Branded<'StudioProjectId'>

/** Caller-created UUID permanently owned by the first project that saves it. */
export type EpisodeId = Branded<'StudioEpisodeId'>

/** Stable directory identity retained when a project is moved between devices. */
export type StudioFolderId = Branded<'StudioFolderId'>

/** Stable Markdown document identity inside one comic project. */
export type ScriptDocumentId = Branded<'ScriptDocumentId'>

/** Stable production-unit identity inside one comic project. */
export type ProductionUnitId = Branded<'ProductionUnitId'>

/** Stable node identity inside one production canvas. */
export type CanvasNodeId = Branded<'CanvasNodeId'>

/** Stable media identity for an artifact referenced by a production unit. */
export type ProjectMediaId = Branded<'ProjectMediaId'>

/** Browser-visible Markdown document with project-relative file path. */
export interface ScriptDocument {
  id: ScriptDocumentId
  projectId: ProjectId
  kind: 'outline' | 'characters' | 'episode'
  episodeId: EpisodeId | null
  title: string
  relativePath: string
  markdown: string
  revision: number
}

/** One approved basis for an episode or whole-film canvas. */
export interface ProductionUnit {
  id: ProductionUnitId
  projectId: ProjectId
  kind: 'episode' | 'whole'
  episodeId: EpisodeId | null
  title: string
  createdAt: string
}

/** Position and reference owned by one production canvas. */
export interface CanvasNode {
  id: CanvasNodeId
  unitId: ProductionUnitId
  kind: 'script' | 'image' | 'video' | 'audio'
  label: string
  text: string | null
  x: number
  y: number
  assetId: ProjectMediaId | null
  revision: number
}

/** Bounded project-local image, video or audio artifact. */
export interface ProjectMediaAsset {
  id: ProjectMediaId
  projectId: ProjectId
  unitId: ProductionUnitId
  kind: 'image' | 'video' | 'audio'
  name: string
  mime: string
  byteSize: number
  createdAt: string
}

/** Stable identity of one portable actor-library folder. */
export type ActorLibraryId = Branded<'ActorLibraryId'>

/** Stable identity of an actor within and across imported libraries. */
export type ActorId = Branded<'ActorId'>

/** One portable library and its device-local folder. */
export interface ActorLibrarySummary {
  id: ActorLibraryId
  name: string
  path: string
  actorCount: number
}

/** Human-authored actor details and two optional local reference images. */
export interface ActorInput {
  name: string
  description: string
  period: string
  region: string
  portrait: string | null
  fullBody: string | null
}

/** An actor with stable identity and timestamps; images are data URLs. */
export interface Actor extends ActorInput {
  id: ActorId
  createdAt: string
  updatedAt: string
}

/** One catalog page; filters are evaluated by SQLite before paging. */
export interface ActorPage {
  actors: Actor[]
  total: number
}

/** Result of merging a portable library into another. */
export interface ActorImportResult {
  library: ActorLibrarySummary
  added: number
  skipped: number
  conflicts: number
}

/** Device-local location of a portable project or unpublished creation draft. */
export interface StudioFolder {
  id: StudioFolderId
  path: string
  projectId: ProjectId | null
  creationId: import('./workflow-types.ts').StudioCreationId | null
  name: string
  state: 'open' | 'closed' | 'missing'
  summary?: ProjectSummary
}

/** An episode draft at one project revision; ordering follows the input array. */
export interface Episode {
  id: EpisodeId
  title: string
  script: string
}

/** Complete editable content; omitted fields are rejected rather than defaulted. */
export interface ProjectInput {
  name: string
  concept: string
  sourceText: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  /** Positive integer, or null while the scale is undecided. */
  targetEpisodes: number | null
  /** Positive finite seconds, or null while the duration is undecided. */
  episodeDuration: number | null
  outline: string
  episodes: Episode[]
}

/** Durable immutable revision; timestamps are UTC ISO strings with millisecond precision. */
export interface Project extends ProjectInput {
  id: ProjectId
  revision: number
  createdAt: string
  updatedAt: string
  archived: boolean
}

/** User-selected cover metadata, independent of creative revisions and model input. */
export interface ProjectCover {
  /** Zero before the first upload; increases on every replacement or removal. */
  revision: number
  /** Validated PNG, JPEG or WebP data URL, or null when no custom image is selected. */
  image: string | null
}

/** Project-list metadata, including archived projects, without creative text bodies. */
export interface ProjectSummary {
  cover: ProjectCover
  id: ProjectId
  name: string
  concept: string
  aspectRatio: '16:9' | '9:16' | '1:1'
  targetEpisodes: number | null
  episodeDuration: number | null
  episodeCount: number
  archived: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

/** Rejected writes retain the current durable project and do not consume a revision. */
export type SaveResult =
  { status: 'saved'; project: Project } | { status: 'conflict'; project: Project } | { status: 'archived'; project: Project }

export type * from './workflow-types.ts'
