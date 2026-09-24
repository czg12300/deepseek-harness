/** Runtime validation for wire, model, and durable novel data. */
import { z } from 'zod'
import type { NovelDocumentId, NovelId, NovelProposalId, NovelRequestId, NovelTaskId } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Novel IDs are UUIDs minted by the Host. */
export const novelIdSchema = z.uuid().transform(value => value as NovelId)
/** Document IDs are UUIDs minted by the Host. */
export const documentIdSchema = z.uuid().transform(value => value as NovelDocumentId)
/** Request IDs are UUIDs minted once per user operation. */
export const requestIdSchema = z.uuid().transform(value => value as NovelRequestId)
/** Task IDs are UUIDs minted by dispatch. */
export const taskIdSchema = z.uuid().transform(value => value as NovelTaskId)
/** Proposal IDs are UUIDs minted after validating the model response. */
export const proposalIdSchema = z.uuid().transform(value => value as NovelProposalId)
/** Positive saved-document revision. */
export const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
/** Metadata permits an empty synopsis during editing, but creation requires one. */
export const infoSchema = z
  .object({ title: z.string().trim().min(1).max(200), synopsis: z.string().max(20_000) })
  .strict()
/** The selected directory belongs to the serving Host. */
export const createSchema = infoSchema.extend({
  synopsis: z.string().trim().min(1).max(20_000),
  parentDirectory: z.string().min(1),
  requestId: requestIdSchema,
})
/** Kinds select authoring semantics without changing text persistence. */
export const kindSchema = z.enum(['chapter', 'outline', 'character', 'setting'])
/** Durable project identity is stored beside its database. */
export const markerSchema = z
  .object({ format: z.literal('dsh-novel'), version: z.literal(1), id: novelIdSchema, requestId: requestIdSchema })
  .strict()
/** Durable project metadata. */
export const projectSchema = infoSchema.extend({
  id: novelIdSchema,
  directory: z.string(),
  revision: revisionSchema,
  chapterCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
/** Read-time validation rejects corrupt saved documents. */
export const documentSchema = z.object({
  id: documentIdSchema,
  novelId: novelIdSchema,
  kind: kindSchema,
  title: z.string().min(1),
  position: z.number().int().nonnegative(),
  revision: revisionSchema,
  content: z.string(),
  updatedAt: z.iso.datetime(),
})
/** Task input includes the exact captured context and Host-issued spans. */
export const taskSchema = z.object({
  project: infoSchema,
  id: taskIdSchema,
  novelId: novelIdSchema,
  documentId: documentIdSchema,
  sessionId: z
    .string()
    .min(1)
    .transform(value => value as SessionId),
  requestId: requestIdSchema,
  baseRevision: revisionSchema,
  prompt: z.string(),
  title: z.string(),
  content: z.string(),
  spans: z.array(
    z.object({
      id: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      text: z.string(),
    }),
  ),
  references: z.array(
    z.object({ documentId: documentIdSchema, title: z.string(), revision: revisionSchema, content: z.string() }),
  ),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'interrupted']),
  reply: z.string(),
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})
/** Proposal comparisons are immutable; only disposition and appliedRevision may change. */
export const proposalSchema = z.object({
  id: proposalIdSchema,
  taskId: taskIdSchema,
  documentId: documentIdSchema,
  baseRevision: revisionSchema,
  changes: z.array(
    z.object({
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      before: z.string(),
      after: z.string(),
    }),
  ),
  status: z.enum(['pending', 'applied', 'discarded']),
  appliedRevision: revisionSchema.nullable(),
})
/** Structured model output does not grant permission to save. */
export const assistantResultSchema = z
  .object({
    reply: z.string(),
    replacements: z.array(z.object({ spanId: z.string(), replacement: z.string() }).strict()),
  })
  .strict()
