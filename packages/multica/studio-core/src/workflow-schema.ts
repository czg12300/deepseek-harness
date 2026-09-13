/** Parsers for durable workflow records and human/model input. */
import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  StudioRoleId,
  StudioField,
  StudioFieldValue,
  StudioTarget,
  StudioCreationId,
  StudioRequestId,
  StudioWorkspaceId,
  StudioTaskId,
  StudioProposalId,
  StudioReviewId,
} from './workflow-types.ts'
import type { ProjectInput } from './types.ts'
import { projectIdSchema, episodeIdSchema, projectInputSchema, revisionSchema } from './validation.ts'

/** UUID parsers retain distinct identities at the wire and durable boundaries. */
export const workspaceIdSchema = z
  .uuid()
  .toLowerCase()
  .transform(value => value as StudioWorkspaceId)
/** Task UUID parser. */
export const taskIdSchema = z
  .uuid()
  .toLowerCase()
  .transform(value => value as StudioTaskId)
/** Proposal UUID parser. */
export const proposalIdSchema = z
  .uuid()
  .toLowerCase()
  .transform(value => value as StudioProposalId)
/** Review UUID parser. */
export const reviewIdSchema = z
  .uuid()
  .toLowerCase()
  .transform(value => value as StudioReviewId)
/** Creation forms can ask for help before they have a project name. */
export const creationInputSchema = projectInputSchema.safeExtend({ name: z.string().refine(value => Array.from(value).length <= 50) })

/** Supported role identities; availability is determined by the execution provider. */
export const roleIdSchema = z.enum([
  'planner',
  'writer',
  'character-designer',
  'art-director',
  'storyboard-director',
  'image-artist',
  'video-director',
  'editor',
  'continuity-reviewer',
])
/** Closed field selector; arbitrary JavaScript property paths are never accepted. */
export const fieldSchema = z.enum([
  'name',
  'concept',
  'sourceText',
  'aspectRatio',
  'targetEpisodes',
  'episodeDuration',
  'outline',
  'episodes',
  'episodeTitle',
  'episodeScript',
])
/** Target identity is independent of the currently selected browser page. */
export const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('creation'), draftId: z.uuid().transform(value => value as StudioCreationId) }),
  z.strictObject({ kind: z.literal('outline'), projectId: projectIdSchema }),
  z.strictObject({ kind: z.literal('episodes'), projectId: projectIdSchema }),
  z.strictObject({ kind: z.literal('episode'), projectId: projectIdSchema, episodeId: episodeIdSchema }),
])
/** Complete user-published configuration; omission cannot silently widen tool access. */
export const roleConfigSchema = z
  .strictObject({
    persona: z.string().min(1),
    provider: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    maxTokens: z.number().int().positive(),
    maxSteps: z.number().int().positive(),
    timeoutMs: z.number().int().positive().max(2_147_483_647),
    skills: z.array(z.string().min(1)).refine(values => new Set(values).size === values.length),
    tools: z.array(z.string().min(1)).refine(values => new Set(values).size === values.length),
  })
  .refine(
    value => (value.provider === null) === (value.model === null),
    'Provider and model must both be selected or both use the deployment default',
  )
/** JSON-compatible editable field values, validated again in their target field. */
export const fieldValueSchema = z.union([z.string(), z.number(), z.null(), projectInputSchema.shape.episodes])
/** Captured assistant result contains no project, role, or approval authority. */
export const assistantResultSchema = z
  .strictObject({
    reply: z.string(),
    changes: z.array(z.strictObject({ field: fieldSchema, value: fieldValueSchema })),
  })
  .refine(
    value => new Set(value.changes.map(change => change.field)).size === value.changes.length,
    'Each field may be proposed only once',
  )
/** Explicit task input includes the local draft snapshot and the saved version it extends. */
export const taskRequestSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  requestId: z.uuid().transform(value => value as StudioRequestId),
  expectedRevision: revisionSchema.nullable(),
  input: creationInputSchema,
  prompt: z
    .string()
    .min(1)
    .refine(value => value.trim().length > 0),
})
/** Apply only selected fields against the exact local and durable base. */
export const applyRequestSchema = z.strictObject({
  proposalId: proposalIdSchema,
  expectedRevision: revisionSchema.nullable(),
  input: creationInputSchema,
  fields: z
    .array(fieldSchema)
    .min(1)
    .refine(values => new Set(values).size === values.length),
})

/** Determine the professional identity assigned to one authoring target.
 * @param target - immutable workspace target.
 * @returns the configured authoring role.
 */
export function roleForTarget(target: StudioTarget): StudioRoleId {
  return target.kind === 'creation' || target.kind === 'outline' ? 'planner' : 'writer'
}

/** Fields a target may propose; a model cannot widen this list.
 * @param target - frozen task target.
 * @returns field identities owned by that target.
 */
export function targetFields(target: StudioTarget): StudioField[] {
  switch (target.kind) {
    case 'creation':
      return ['name', 'concept', 'sourceText', 'aspectRatio', 'targetEpisodes', 'episodeDuration']
    case 'outline':
      return ['outline']
    case 'episodes':
      return ['episodes']
    case 'episode':
      return ['episodeTitle', 'episodeScript']
  }
}

/** Read a target-owned field from a complete draft.
 * @param input - captured or current project fields.
 * @param target - identity to read.
 * @param field - allowed field identity.
 * @returns a JSON-compatible field value; a missing episode is rejected.
 */
export function readField(input: ProjectInput, target: StudioTarget, field: StudioField): StudioFieldValue {
  if (!targetFields(target).includes(field)) throw new Error(`Field ${field} is outside this workspace`)
  if (field === 'episodeTitle' || field === 'episodeScript') {
    const episode = target.kind === 'episode' ? input.episodes.find(value => value.id === target.episodeId) : undefined
    if (episode === undefined) throw new Error('The target episode is missing from the draft')
    return field === 'episodeTitle' ? episode.title : episode.script
  }
  return input[field]
}

/** Produce a validated draft with one proposed value, preserving all other fields.
 * @param input - complete local draft.
 * @param target - frozen target identity.
 * @param field - field to replace.
 * @param value - proposed JSON value.
 * @returns detached, schema-validated project fields.
 */
export function replaceField(input: ProjectInput, target: StudioTarget, field: StudioField, value: StudioFieldValue): ProjectInput {
  readField(input, target, field)
  const schema = target.kind === 'creation' ? creationInputSchema : projectInputSchema
  if (field === 'episodeTitle' || field === 'episodeScript') {
    const text = z.string().parse(value)
    return schema.parse({
      ...input,
      episodes: input.episodes.map(episode =>
        target.kind === 'episode' && episode.id === target.episodeId
          ? { ...episode, [field === 'episodeTitle' ? 'title' : 'script']: text }
          : episode,
      ),
    })
  }
  return schema.parse({ ...input, [field]: value })
}

/** Persisted creation-form revision, including forms that have no title yet. */
export const creationDraftSchema = z.strictObject({
  id: z.uuid().transform(value => value as StudioCreationId),
  revision: revisionSchema,
  input: creationInputSchema,
  updatedAt: z.iso.datetime(),
})

/** Published role records are immutable and strictly decoded on read. */
export const roleRevisionSchema = z.strictObject({
  role: roleIdSchema,
  revision: revisionSchema,
  config: roleConfigSchema,
  createdAt: z.iso.datetime(),
})
/** Resolved dependencies remain identical throughout a workspace's Session. */
export const resolvedRoleSchema = z.strictObject({
  provider: z.string().min(1),
  model: z.string().min(1),
  skills: z.array(z.strictObject({ name: z.string().min(1), content: z.string() })),
  tools: z.array(z.string().min(1)),
})
/** Persisted workspace parser. */
export const workspaceSchema = z.strictObject({
  id: workspaceIdSchema,
  target: targetSchema,
  role: roleRevisionSchema,
  sessionId: z.uuid().transform(value => value as SessionId),
  resolved: resolvedRoleSchema.nullable(),
  initialized: z.boolean(),
  createdAt: z.iso.datetime(),
})
/** Persisted task parser. */
export const taskSchema = z.strictObject({
  id: taskIdSchema,
  workspaceId: workspaceIdSchema,
  requestId: z.uuid().transform(value => value as StudioRequestId),
  target: targetSchema,
  role: roleRevisionSchema,
  resolved: resolvedRoleSchema,
  sessionId: z.uuid().transform(value => value as SessionId),
  expectedRevision: revisionSchema.nullable(),
  input: creationInputSchema,
  prompt: z.string(),
  reviews: z.array(z.lazy(() => reviewSchema)),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  reply: z.string(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})
/** Persisted proposal parser. */
export const proposalSchema = z.strictObject({
  id: proposalIdSchema,
  taskId: taskIdSchema,
  workspaceId: workspaceIdSchema,
  target: targetSchema,
  expectedRevision: revisionSchema.nullable(),
  changes: z.array(z.strictObject({ field: fieldSchema, before: fieldValueSchema, after: fieldValueSchema })),
  applied: z.array(fieldSchema),
  ignored: z.array(fieldSchema),
  createdAt: z.iso.datetime(),
})
/** Human review parser; creation-form drafts cannot be approved as project content. */
export const reviewSchema = z.strictObject({
  id: reviewIdSchema,
  target: targetSchema.refine(target => target.kind !== 'creation'),
  projectRevision: revisionSchema,
  status: z.enum(['pending', 'approved', 'returned']),
  comment: z.string(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
})
