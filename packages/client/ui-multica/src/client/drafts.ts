/** Navigation and editable drafts survive main-panel remounts within one plugin lifetime. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type {
  ModelSelection,
  EpisodeId,
  Project,
  ProjectId,
  ScriptDocumentId,
  ProductionUnitId,
  ProjectInput,
  StudioCreationId,
  StudioCreationDraft,
  StudioTarget,
  StudioField,
  StudioProposalId,
  StudioRoleId,
  StudioRoleRevision,
  StudioRoleConfig,
  StudioReviewId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** A project editor keeps the revision it was based on independently of remote refreshes. */
export interface ProjectDraft {
  input: ProjectInput
  baseRevision: number
  dirty: boolean
  edit: number
  conflict: boolean
}

/** Project-local navigation, including the selected episode. */
export type ProjectPage = 'outline' | 'episodes' | 'settings' | 'history' | 'reviews' | 'assets' |
  EpisodeId | ScriptDocumentId | ProductionUnitId

/** Unpublished human edits retain the role version they started from. */
export interface RoleDraft {
  role: StudioRoleRevision
  config: StudioRoleConfig
  dirty: boolean
  edit: number
}

/** Root view state; durable projects belong to the remote query model. */
export interface MulticaDrafts {
  selected: ProjectId | null
  management: 'roles' | 'reviews' | 'actors' | null
  creationId: StudioCreationId
  createRevision: number | null
  assistantPrompts: Record<string, string>
  assistantModels: Record<string, ModelSelection>
  proposalSelection: Record<StudioProposalId, StudioField[]>
  selectedRole: StudioRoleId
  roleDrafts: Partial<Record<StudioRoleId, RoleDraft>>
  selectedReview: StudioReviewId | null
  reviewComments: Record<StudioReviewId, string>
  creating: boolean
  createInput: ProjectInput
  createDirty: boolean
  createEdit: number
  drafts: Record<ProjectId, ProjectDraft>
  pages: Record<ProjectId, ProjectPage>
  filter: 'active' | 'archived'
  search: string
  sort: 'updated' | 'oldest' | 'byName'
}

/** Empty manual project, with undecided episode count and duration.
 * @returns a fresh editable input with no automatically generated episodes.
 */
export function emptyInput(): ProjectInput {
  return {
    name: '',
    concept: '',
    sourceText: '',
    aspectRatio: '16:9',
    targetEpisodes: null,
    episodeDuration: null,
    outline: '',
    episodes: [],
  }
}

/** Strip revision metadata from a historical or remote project.
 * @param project - source document.
 * @returns complete editable fields detached from the source's episode array.
 */
export function projectInput(project: ProjectInput): ProjectInput {
  const { name, concept, sourceText, aspectRatio, targetEpisodes, episodeDuration, outline, episodes } = project
  return {
    name,
    concept,
    sourceText,
    aspectRatio,
    targetEpisodes,
    episodeDuration,
    outline,
    episodes: episodes.map(episode => ({ ...episode })),
  }
}

/** Check form-owned numeric constraints before a write.
 * @param input - current form fields.
 * @returns whether the form can be submitted.
 */
export function validInput(input: ProjectInput): boolean {
  return (
    input.name.trim().length > 0 &&
    Array.from(input.name).length <= 50 &&
    Array.from(input.concept).length <= 3000 &&
    (input.targetEpisodes === null || (Number.isSafeInteger(input.targetEpisodes) && input.targetEpisodes > 0)) &&
    (input.episodeDuration === null || (Number.isFinite(input.episodeDuration) && input.episodeDuration > 0))
  )
}

function loaded(project: Project): ProjectDraft {
  return { input: projectInput(project), baseRevision: project.revision, dirty: false, edit: 0, conflict: false }
}

function requireDraft(state: MulticaDrafts, id: ProjectId): ProjectDraft {
  const draft = state.drafts[id]
  if (draft === undefined) throw new Error(`Multica editor has not opened project ${id}`)
  return draft
}

/** Merge only proposal fields that the human has not changed while its request was in flight.
 * @param current - present local input.
 * @param submitted - input captured by the apply gesture.
 * @param accepted - server-confirmed result.
 * @param target - proposal target.
 * @param fields - selected fields.
 * @returns a detached draft preserving later manual edits.
 */
export function mergeAppliedInput(
  current: ProjectInput,
  submitted: ProjectInput,
  accepted: ProjectInput,
  target: StudioTarget,
  fields: StudioField[],
): ProjectInput {
  const merged = projectInput(current)
  for (const field of fields) {
    if (field === 'episodeTitle' || field === 'episodeScript') {
      if (target.kind !== 'episode') continue
      const key = field === 'episodeTitle' ? 'title' : 'script'
      const local = merged.episodes.find(episode => episode.id === target.episodeId)
      const before = submitted.episodes.find(episode => episode.id === target.episodeId)
      const after = accepted.episodes.find(episode => episode.id === target.episodeId)
      if (local && before && after && local[key] === before[key]) local[key] = after[key]
    } else if (JSON.stringify(merged[field]) === JSON.stringify(submitted[field])) {
      Object.assign(merged, { [field]: field === 'episodes' ? accepted.episodes.map(episode => ({ ...episode })) : accepted[field] })
    }
  }
  return merged
}

type DraftActions = {
  restoreBuffer: (d: MulticaDrafts, id: ProjectId, buffer: { baseRevision: number; input: ProjectInput }) => void
  closeProject: (d: MulticaDrafts, id: ProjectId | null) => void
  creationSaved: (d: MulticaDrafts, draft: StudioCreationDraft, submitted: ProjectInput) => void
  restoreCreation: (d: MulticaDrafts, draft: StudioCreationDraft, discard?: boolean) => void
  manage: (d: MulticaDrafts, page: 'roles' | 'reviews' | 'actors' | null) => void
  assistantModel: (d: MulticaDrafts, key: string, selection: ModelSelection) => void
  assistantPrompt: (d: MulticaDrafts, key: string, text: string) => void
  promptSubmitted: (d: MulticaDrafts, key: string, text: string) => void
  proposalField: (d: MulticaDrafts, id: StudioProposalId, field: StudioField, checked: boolean) => void
  proposalApplied: (
    d: MulticaDrafts,
    target: StudioTarget,
    submitted: ProjectInput,
    accepted: ProjectInput,
    project: Project | null,
    fields: StudioField[],
    creation: StudioCreationDraft | null,
  ) => void
  selectRole: (d: MulticaDrafts, role: StudioRoleId) => void
  editRole: (d: MulticaDrafts, role: StudioRoleRevision, patch: Partial<StudioRoleConfig>) => void
  resetRole: (d: MulticaDrafts, role: StudioRoleId) => void
  rolePublished: (d: MulticaDrafts, role: StudioRoleRevision, edit: number) => void
  selectReview: (d: MulticaDrafts, id: StudioReviewId | null) => void
  reviewComment: (d: MulticaDrafts, id: StudioReviewId, text: string) => void

  home: (d: MulticaDrafts) => void
  startCreate: (d: MulticaDrafts) => void
  select: (d: MulticaDrafts, id: ProjectId) => void
  page: (d: MulticaDrafts, id: ProjectId, page: ProjectPage) => void
  browse: (d: MulticaDrafts, values: Partial<Pick<MulticaDrafts, 'filter' | 'search' | 'sort'>>) => void
  editCreate: (d: MulticaDrafts, patch: Partial<ProjectInput>) => void
  created: (d: MulticaDrafts, project: Project, edit: number) => void
  received: (d: MulticaDrafts, project: Project) => void
  edit: (d: MulticaDrafts, id: ProjectId, patch: Partial<ProjectInput>) => void
  saved: (d: MulticaDrafts, project: Project, edit: number) => void
  conflicted: (d: MulticaDrafts, id: ProjectId) => void
  loadRemote: (d: MulticaDrafts, project: Project) => void
  stageVersion: (d: MulticaDrafts, id: ProjectId, input: ProjectInput) => void
}

/** Declare a store shared by the Multica entry for its full mount lifetime.
 * @returns the navigation and draft action handle.
 */
export function createMulticaStore(): EngineStoreHandle<MulticaDrafts, DraftActions> {
  return defineStore({
    init: (): MulticaDrafts => ({
      selected: null,
      management: null,
      creationId: randomUUID() as StudioCreationId,
      createRevision: null,
      assistantPrompts: {},
      assistantModels: {},
      proposalSelection: {},
      selectedRole: 'planner',
      roleDrafts: {},
      selectedReview: null,
      reviewComments: {},
      creating: false,
      createInput: emptyInput(),
      createDirty: false,
      createEdit: 0,
      drafts: {},
      pages: {},
      filter: 'active',
      search: '',
      sort: 'updated',
    }),
    actions: {
      restoreBuffer: (d, id, buffer) => {
        const current = d.drafts[id]
        if (!current || current.dirty || JSON.stringify(current.input) === JSON.stringify(buffer.input)) return
        d.drafts[id] = {
          input: buffer.input, baseRevision: buffer.baseRevision, dirty: true, edit: current.edit + 1,
          conflict: current.baseRevision !== buffer.baseRevision,
        }
      },
      closeProject: (d, id) => {
        if (id) d.drafts = Object.fromEntries(Object.entries(d.drafts).filter(([key]) => key !== id))
        else {
          d.creationId = randomUUID() as StudioCreationId
          d.createRevision = null
          d.createInput = emptyInput()
          d.createDirty = false
          d.createEdit = 0
        }
        d.selected = null
        d.creating = false
        d.management = null
      },
      creationSaved: (d, draft: StudioCreationDraft, submitted: ProjectInput) => {
        if (draft.id !== d.creationId || (d.createRevision !== null && d.createRevision > draft.revision)) return
        d.createRevision = draft.revision
        if (JSON.stringify(d.createInput) === JSON.stringify(submitted)) {
          d.createInput = projectInput(draft.input)
          d.createDirty = false
        }
      },
      restoreCreation: (d, draft: StudioCreationDraft, discard = false) => {
        if (d.createDirty && draft.id !== d.creationId) return
        d.creating = true
        d.management = null
        d.selected = null
        if (discard || !d.createDirty) {
          d.creationId = draft.id
          d.createRevision = draft.revision
          d.createInput = projectInput(draft.input)
          d.createDirty = false
          d.createEdit++
        }
      },
      manage: (d, page: 'roles' | 'reviews' | 'actors' | null) => {
        d.management = page
      },
      assistantModel: (d, key, selection) => { d.assistantModels[key] = selection },
      assistantPrompt: (d, key: string, text: string) => {
        d.assistantPrompts[key] = text
      },
      promptSubmitted: (d, key: string, text: string) => {
        if (d.assistantPrompts[key] === text) d.assistantPrompts[key] = ''
      },
      proposalField: (d, id: StudioProposalId, field: StudioField, checked: boolean) => {
        const selected = d.proposalSelection[id] ?? []
        d.proposalSelection[id] = checked ? [...new Set([...selected, field])] : selected.filter(value => value !== field)
      },
      proposalApplied: (
        d,
        target: StudioTarget,
        submitted: ProjectInput,
        accepted: ProjectInput,
        project: Project | null,
        fields: StudioField[],
        creation: StudioCreationDraft | null,
      ) => {
        if (target.kind === 'creation') {
          if (target.draftId !== d.creationId) return
          d.createInput = mergeAppliedInput(d.createInput, submitted, accepted, target, fields)
          d.createRevision = creation?.revision ?? d.createRevision
          d.createDirty = JSON.stringify(d.createInput) !== JSON.stringify(accepted)
          d.createEdit++
          return
        }
        if (!project) return
        const draft = requireDraft(d, target.projectId)
        if (draft.baseRevision > project.revision) return
        draft.input = mergeAppliedInput(draft.input, submitted, accepted, target, fields)
        draft.baseRevision = project.revision
        draft.edit++
        draft.conflict = false
        draft.dirty = JSON.stringify(draft.input) !== JSON.stringify(accepted)
      },
      selectRole: (d, role: StudioRoleId) => {
        d.selectedRole = role
      },
      editRole: (d, role: StudioRoleRevision, patch: Partial<StudioRoleConfig>) => {
        let draft = d.roleDrafts[role.role]
        if (!draft?.dirty)
          draft = d.roleDrafts[role.role] = {
            role,
            config: { ...role.config, skills: [...role.config.skills], tools: [...role.config.tools] },
            dirty: false,
            edit: draft?.edit ?? 0,
          }
        Object.assign(draft.config, patch)
        draft.dirty = true
        draft.edit++
      },
      resetRole: (d, role: StudioRoleId) => {
        Reflect.deleteProperty(d.roleDrafts, role)
      },
      rolePublished: (d, role: StudioRoleRevision, edit: number) => {
        const draft = d.roleDrafts[role.role]
        if (!draft) return
        if (draft.edit === edit) Reflect.deleteProperty(d.roleDrafts, role.role)
        else draft.role = role
      },
      selectReview: (d, id: StudioReviewId | null) => {
        d.selectedReview = id
      },
      reviewComment: (d, id: StudioReviewId, text: string) => {
        d.reviewComments[id] = text
      },
      home: (d) => {
        d.selected = null
        d.creating = false
        d.management = null
      },
      startCreate: (d) => {
        if (!d.createDirty && d.createRevision !== null) {
          d.creationId = randomUUID() as StudioCreationId
          d.createRevision = null
          d.createInput = emptyInput()
          d.createEdit++
        }
        d.creating = true
        d.management = null
      },
      select: (d, id: ProjectId) => {
        d.selected = id
        d.creating = false
        d.management = null
        d.pages[id] ??= 'outline'
      },
      page: (d, id: ProjectId, page: ProjectPage) => {
        d.pages[id] = page
      },
      browse: (d, values: Partial<Pick<MulticaDrafts, 'filter' | 'search' | 'sort'>>) => {
        Object.assign(d, values)
      },
      editCreate: (d, patch: Partial<ProjectInput>) => {
        Object.assign(d.createInput, patch)
        d.createDirty = true
        d.createEdit++
      },
      created: (d, project: Project, edit: number) => {
        d.drafts[project.id] = loaded(project)
        d.pages[project.id] = 'outline'
        if (d.createEdit === edit) {
          d.createInput = emptyInput()
          d.creationId = randomUUID() as StudioCreationId
          d.createRevision = null
          d.createDirty = false
        } else {
          d.creationId = randomUUID() as StudioCreationId
          d.createRevision = null
        }
        // A late create must not pull the user away from another project.
        if (d.creating) {
          d.selected = project.id
          d.creating = false
        }
      },
      received: (d, project: Project) => {
        const draft = d.drafts[project.id]
        if (!draft || (!draft.dirty && project.revision >= draft.baseRevision)) d.drafts[project.id] = loaded(project)
        else if (project.revision > draft.baseRevision) draft.conflict = true
      },
      edit: (d, id: ProjectId, patch: Partial<ProjectInput>) => {
        const draft = requireDraft(d, id)
        Object.assign(draft.input, patch)
        draft.dirty = true
        draft.edit++
      },
      saved: (d, project: Project, edit: number) => {
        const draft = requireDraft(d, project.id)
        if (project.revision < draft.baseRevision) return
        draft.baseRevision = project.revision
        draft.conflict = false
        if (draft.edit === edit) {
          draft.input = projectInput(project)
          draft.dirty = false
        }
      },
      conflicted: (d, id: ProjectId) => {
        requireDraft(d, id).conflict = true
      },
      loadRemote: (d, project: Project) => {
        d.drafts[project.id] = loaded(project)
      },
      stageVersion: (d, id: ProjectId, input: ProjectInput) => {
        const draft = requireDraft(d, id)
        draft.input = projectInput(input)
        draft.dirty = true
        draft.edit++
      },
    },
  })
}
