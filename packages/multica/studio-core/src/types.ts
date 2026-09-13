/** Client-safe Multica project documents; episode versions use their project revision. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Host-created UUID identifying a project across all its revisions. */
export type ProjectId = Branded<'StudioProjectId'>

/** Caller-created UUID permanently owned by the first project that saves it. */
export type EpisodeId = Branded<'StudioEpisodeId'>

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
