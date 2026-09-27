import { vi } from 'vitest'
import type {
  StudioRoleRevision,
  StudioField,
  StudioTarget,
  StudioWorkspaceId,
  StudioWorkspaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { StudioModel, studioTargetKey, type StudioApi, type StudioActions } from '../src/client/studio.ts'
import type { createMulticaStore } from '../src/client/drafts.ts'

const date = '2026-09-11T00:00:00.000Z'
export const role: StudioRoleRevision = {
  role: 'planner',
  revision: 1,
  createdAt: date,
  config: {
    persona: 'Plan a comic series.',
    provider: null,
    model: null,
    maxTokens: 4096,
    maxSteps: 8,
    timeoutMs: 180000,
    skills: [],
    tools: [],
  },
}
export function workspace(target: StudioTarget, id = '00000000-0000-4000-8000-000000000010' as StudioWorkspaceId): StudioWorkspaceView {
  return {
    workspace: {
      id,
      target,
      role,
      sessionId: '00000000-0000-4000-8000-000000000011' as StudioWorkspaceView['workspace']['sessionId'],
      resolved: null,
      initialized: false,
      createdAt: date,
    },
    tasks: [],
    proposals: [],
    lockedFields: [],
    allowedFields: ['outline'],
    creation: null,
    versions: [{ id, roleRevision: 1, running: false }],
  }
}
const unused = async (): Promise<never> => {
  throw new Error('Unexpected professional API call')
}
export function studioFixture(store?: ReturnType<ReturnType<typeof createMulticaStore>['create']>) {
  const api: StudioApi = {
    creations: vi.fn(async () => []),
    creation: vi.fn(async () => null),
    saveCreation: vi.fn(unused),
    catalog: vi.fn(async () => ({ backendAvailable: false, enabledRoles: [], defaultModel: null, skills: [], tools: [] })),
    roles: vi.fn(async () => [role]),
    publishRole: vi.fn(unused),
    open: vi.fn(async (target: StudioTarget) => workspace(target)),
    workspace: vi.fn(unused),
    start: vi.fn(unused),
    wait: vi.fn(unused),
    cancel: vi.fn(unused),
    apply: vi.fn(unused),
    ignore: vi.fn(unused),
    locks: vi.fn(async (_target: StudioTarget, fields: StudioField[]) => fields),
    reviews: vi.fn(async () => []),
    submit: vi.fn(unused),
    decide: vi.fn(unused),
  }
  const model = new StudioModel(api)
  const actions: StudioActions = {
    creations: () => model.creations(),
    catalog: () => model.catalog(),
    saveCreation: async (id, revision, input) => {
      const draft = await model.saveCreation(id, revision, input)
      if (draft) store?.actions.creationSaved(draft, input)
    },
    resumeCreation: id =>
      model.resumeCreation(id, (draft) => {
        store?.actions.restoreCreation(draft)
      }),
    open: target => model.open(target),
    refresh: id => model.refresh(id),
    selectVersion: (target, id) => model.selectVersion(target, id),
    send: (id, revision, input, prompt, modelSelection) =>
      model.send(id, revision, input, prompt, () => {
        const target = model.source.getSnapshot().byId[id]?.view?.workspace.target
        if (target) store?.actions.promptSubmitted(studioTargetKey(target), prompt)
      }, modelSelection),
    retry: id => model.retry(id, () => {}),
    abandon: (id) => {
      model.abandon(id)
    },
    cancel: task => model.cancel(task),
    apply: (id, target, request) =>
      model.apply(id, request, (result) => {
        if (result.status === 'applied')
          store?.actions.proposalApplied(target, request.input, result.input, result.project, request.fields, result.creation)
      }),
    ignore: (id, proposal, fields) => model.ignore(id, proposal, fields),
    locks: (view, fields) => model.locks(view, fields),
    publish: (revision, config, edit) =>
      model.publish(revision, config, (published) => {
        store?.actions.rolePublished(published, edit)
      }),
    reviews: () => model.reviews(),
    submitReview: (target, revision) => model.submitReview(target, revision),
    decide: (review, decision, comment) => model.decide(review, decision, comment),
  }
  return { api, model, actions }
}
