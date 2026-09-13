/** Validation at Remote calls and persisted JSON reads. */

import { z } from 'zod'
import type { EpisodeId, ProjectId, ProjectInput } from './types.ts'

/** Project form name limit in Unicode code points. */
export const PROJECT_NAME_MAX_LENGTH = 50

/** Project concept limit in Unicode code points. */
export const PROJECT_CONCEPT_MAX_LENGTH = 3000

/** Canonical UUID representation prevents case aliases from splitting project identity. */
export const projectIdSchema = z
  .uuid()
  .refine(value => value === value.toLowerCase(), 'Project UUID must be lowercase')
  .transform(value => value as ProjectId)

/** Canonical UUID representation prevents case aliases from splitting episode ownership. */
export const episodeIdSchema = z
  .uuid()
  .refine(value => value === value.toLowerCase(), 'Episode UUID must be lowercase')
  .transform(value => value as EpisodeId)

/** Safe positive revision counter accepted by SQLite and JSON clients. */
export const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Complete creative content parser; clones accepted documents before persistence. */
export const projectInputSchema = z
  .strictObject({
    name: z
      .string()
      .refine(value => value.trim().length > 0, 'Project name must not be blank')
      .refine(value => Array.from(value).length <= PROJECT_NAME_MAX_LENGTH, 'Project name exceeds 50 characters'),
    concept: z.string().refine(value => Array.from(value).length <= PROJECT_CONCEPT_MAX_LENGTH, 'Project concept exceeds 3000 characters'),
    sourceText: z.string(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']),
    targetEpisodes: revisionSchema.nullable(),
    episodeDuration: z.number().positive().nullable(),
    outline: z.string(),
    episodes: z.array(z.strictObject({ id: episodeIdSchema, title: z.string(), script: z.string() })),
  })
  .refine(uniqueEpisodeIds, 'Episode IDs must be unique within a project')

function uniqueEpisodeIds(input: ProjectInput): boolean {
  return new Set(input.episodes.map(episode => episode.id)).size === input.episodes.length
}

const timestamp = z.iso.datetime({ precision: 3 }).refine(value => new Date(value).toISOString() === value)

/** Stored JSON parser; revision columns and episode ownership are checked by the store. */
export const projectSchema = projectInputSchema
  .safeExtend({
    id: projectIdSchema,
    revision: revisionSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
    archived: z.boolean(),
  })
  .refine(project => project.updatedAt >= project.createdAt, 'Project update precedes creation')
