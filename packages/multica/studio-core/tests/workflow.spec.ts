import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StudioProjects from '../src/index.ts'
import type { EpisodeId, Project, ProjectInput } from '../src/types.ts'
import type {
  StudioAssistantBackend,
  StudioAssistantResult,
  StudioCreationId,
  StudioRequestId,
  StudioTarget,
  StudioWorkspaceView,
} from '../src/workflow-types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function input(patch: Partial<ProjectInput> = {}): ProjectInput {
  const { name, concept, sourceText, aspectRatio, targetEpisodes, episodeDuration, outline, episodes } = {
    name: 'The lighthouse',
    concept: '',
    sourceText: '',
    aspectRatio: '16:9' as const,
    targetEpisodes: null,
    episodeDuration: null,
    outline: 'Original outline',
    episodes: [],
    ...patch,
  }
  return { name, concept, sourceText, aspectRatio, targetEpisodes, episodeDuration, outline, episodes }
}

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-studio-workflow-'))
  roots.push(home)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(StudioProjects, { dshHome: home })
  const service = ctx.studioProjects
  let result: StudioAssistantResult = { reply: 'Here is a focused suggestion.', changes: [{ field: 'outline', value: 'Proposed outline' }] }
  const backend: StudioAssistantBackend = {
    catalog: async () => ({
      backendAvailable: true,
      enabledRoles: ['planner', 'writer'],
      defaultModel: { provider: 'fixture', model: 'text' },
      skills: [],
      tools: [],
    }),
    resolve: vi.fn(async () => ({ provider: 'fixture', model: 'text', skills: [], tools: [] })),
    execute: vi.fn(async () => result),
    cancel: vi.fn(async () => {}),
  }
  const unregister = service.registerAssistantBackend(backend)
  return {
    ctx,
    home,
    service,
    backend,
    unregister,
    result: (next: StudioAssistantResult) => {
      result = next
    },
  }
}

async function run(
  service: StudioProjects,
  workspace: StudioWorkspaceView,
  project: Project | null,
  draft = project ? input(project) : input({ name: '', outline: '' }),
) {
  const creation =
    workspace.workspace.target.kind === 'creation'
      ? service.saveCreationDraft(workspace.workspace.target.draftId, workspace.creation?.revision ?? null, draft).draft
      : null
  const task = await service.startAssistant({
    workspaceId: workspace.workspace.id,
    requestId: randomUUID() as StudioRequestId,
    expectedRevision: project?.revision ?? creation?.revision ?? null,
    input: draft,
    prompt: 'Suggest a focused improvement.',
  })
  const settled = await service.waitTask(task.id)
  return { task: settled, view: service.workspace(workspace.workspace.id) }
}

describe('professional authoring transactions', () => {
  it('opens role-bound workspaces without executing and keeps old configuration versions', async () => {
    const f = await fixture()
    const project = f.service.create(input())
    const target: StudioTarget = { kind: 'outline', projectId: project.id }
    const first = f.service.openWorkspace(target)
    expect(f.service.openWorkspace(target).workspace.id).toBe(first.workspace.id)
    expect(f.backend.execute).not.toHaveBeenCalled()
    expect(first.tasks).toEqual([])
    const role = first.workspace.role
    const updated = await f.service.publishRole('planner', 1, { ...role.config, persona: 'Plan a mystery series.' })
    expect(updated.revision).toBe(2)
    const second = f.service.openWorkspace(target)
    expect(second.workspace.id).not.toBe(first.workspace.id)
    expect(second.workspace.sessionId).not.toBe(first.workspace.sessionId)
    expect(f.service.workspace(first.workspace.id).workspace.role).toEqual(role)
    await expect(f.service.publishRole('planner', 1, role.config)).rejects.toThrow('changed')
    expect(f.service.roles()).toHaveLength(9)
    expect(first.workspace.role.config.persona).not.toBe(f.service.roles().find(role => role.role === 'writer')?.config.persona)
  })

  it('captures immutable local input and never applies a model suggestion automatically', async () => {
    const f = await fixture()
    const project = f.service.create(input())
    const workspace = f.service.openWorkspace({ kind: 'outline', projectId: project.id })
    const local = input({ outline: 'Unsaved local outline' })
    const { task, view } = await run(f.service, workspace, project, local)
    local.outline = 'Changed after submission'
    expect(task.status).toBe('completed')
    expect(vi.mocked(f.backend.execute).mock.calls[0]?.[0].input.outline).toBe('Unsaved local outline')
    expect(f.service.get(project.id)).toEqual(project)
    expect(view.proposals[0]?.changes).toEqual([{ field: 'outline', before: 'Unsaved local outline', after: 'Proposed outline' }])
    const captured = vi.mocked(f.backend.execute).mock.calls[0]?.[0]
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured?.input)).toBe(true)
    expect(Object.isFrozen(captured?.role.config)).toBe(true)
  })

  it('keeps an old proposal from overwriting later local or saved edits', async () => {
    const f = await fixture()
    const project = f.service.create(input())
    const { view } = await run(f.service, f.service.openWorkspace({ kind: 'outline', projectId: project.id }), project)
    const proposal = view.proposals[0]!
    expect(
      f.service.applyProposal({
        proposalId: proposal.id,
        expectedRevision: 1,
        input: input({ outline: 'Manual draft' }),
        fields: ['outline'],
      }),
    ).toMatchObject({ status: 'conflict', fields: ['outline'] })
    const saved = f.service.save(project.id, 1, input({ outline: 'Saved elsewhere' })).project
    expect(f.service.applyProposal({ proposalId: proposal.id, expectedRevision: 1, input: input(), fields: ['outline'] })).toMatchObject({
      status: 'conflict',
    })
    expect(
      f.service.applyProposal({ proposalId: proposal.id, expectedRevision: saved.revision, input: input(), fields: ['outline'] }),
    ).toMatchObject({ status: 'conflict' })
    expect(f.service.get(project.id)).toEqual(saved)
    expect(f.service.history(project.id)).toHaveLength(2)
  })

  it('applies only selected fields and preserves pending changes in unrelated fields', async () => {
    const f = await fixture()
    const episode = { id: randomUUID() as EpisodeId, title: 'Arrival', script: 'Original scene' }
    const project = f.service.create(input({ episodes: [episode] }))
    f.result({
      reply: 'Tighten the scene.',
      changes: [
        { field: 'episodeTitle', value: 'The letter' },
        { field: 'episodeScript', value: 'New scene' },
      ],
    })
    const { view } = await run(
      f.service,
      f.service.openWorkspace({ kind: 'episode', projectId: project.id, episodeId: episode.id }),
      project,
    )
    const proposal = view.proposals[0]!
    const first = f.service.applyProposal({
      proposalId: proposal.id,
      expectedRevision: 1,
      input: input({ ...project, concept: 'Manual concept' }),
      fields: ['episodeTitle'],
    })
    expect(first.status).toBe('applied')
    if (first.status !== 'applied' || !first.project) throw new Error('Expected an applied project')
    expect(first.input.concept).toBe('Manual concept')
    expect(first.input.episodes[0]).toEqual({ ...episode, title: 'The letter' })
    const second = f.service.applyProposal({
      proposalId: proposal.id,
      expectedRevision: 2,
      input: input(first.project),
      fields: ['episodeScript'],
    })
    expect(second.status).toBe('applied')
    expect(f.service.get(project.id)?.episodes[0]).toEqual({ ...episode, title: 'The letter', script: 'New scene' })
    expect(f.service.history(project.id)[0]).toEqual(project)
    expect(f.service.reviews(project.id)).toEqual([])
    expect(() =>
      f.service.applyProposal({
        proposalId: proposal.id,
        expectedRevision: 3,
        input: input(f.service.get(project.id)!),
        fields: ['episodeTitle'],
      }),
    ).toThrow('unapplied')
  })

  it('honors field locks across the episode list and individual episode workspaces', async () => {
    const f = await fixture()
    const episode = { id: randomUUID() as EpisodeId, title: 'Arrival', script: 'Locked dialogue' }
    const project = f.service.create(input({ episodes: [episode] }))
    const target = { kind: 'episode' as const, projectId: project.id, episodeId: episode.id }
    f.service.setFieldLocks(target, ['episodeScript'])
    f.result({ reply: 'Rewrite', changes: [{ field: 'episodes', value: [{ ...episode, script: 'Changed dialogue' }] }] })
    const list = await run(f.service, f.service.openWorkspace({ kind: 'episodes', projectId: project.id }), project)
    expect(
      f.service.applyProposal({ proposalId: list.view.proposals[0]!.id, expectedRevision: 1, input: input(project), fields: ['episodes'] }),
    ).toMatchObject({ status: 'locked' })
    f.service.setFieldLocks(target, [])
    f.service.setFieldLocks({ kind: 'episodes', projectId: project.id }, ['episodes'])
    f.result({ reply: 'Rewrite', changes: [{ field: 'episodeScript', value: 'Changed dialogue' }] })
    const detail = await run(f.service, f.service.openWorkspace(target), project)
    expect(
      f.service.applyProposal({
        proposalId: detail.view.proposals[0]!.id,
        expectedRevision: 1,
        input: input(project),
        fields: ['episodeScript'],
      }),
    ).toMatchObject({ status: 'locked' })
    f.service.setFieldLocks({ kind: 'episodes', projectId: project.id }, [])
    expect(
      f.service.applyProposal({
        proposalId: detail.view.proposals[0]!.id,
        expectedRevision: 1,
        input: input(project),
        fields: ['episodeScript'],
      }).status,
    ).toBe('applied')
  })

  it('can improve a nameless creation form without creating a Project', async () => {
    const f = await fixture()
    f.result({
      reply: 'A possible title.',
      changes: [
        { field: 'name', value: 'The midnight letter' },
        { field: 'concept', value: 'A letter from tomorrow.' },
      ],
    })
    const workspace = f.service.openWorkspace({ kind: 'creation', draftId: randomUUID() as StudioCreationId })
    const { view } = await run(f.service, workspace, null)
    const proposal = view.proposals[0]!
    const result = f.service.applyProposal({
      proposalId: proposal.id,
      expectedRevision: 1,
      input: input({ name: '', outline: '' }),
      fields: ['name'],
    })
    expect(result).toMatchObject({ status: 'applied', project: null, input: { name: 'The midnight letter', concept: '' } })
    expect(f.service.list()).toEqual([])
    expect(f.service.ignoreProposal(proposal.id, ['concept']).ignored).toEqual(['concept'])
    expect(() =>
      f.service.applyProposal({ proposalId: proposal.id, expectedRevision: 2, input: input({ name: '' }), fields: ['concept'] }),
    ).toThrow('unapplied')
  })

  it('binds proposals and episodes to the original project and refuses archived writes', async () => {
    const f = await fixture()
    const episode = { id: randomUUID() as EpisodeId, title: 'One', script: '' }
    const a = f.service.create(input({ episodes: [episode] }))
    const b = f.service.create(input({ name: 'Unrelated' }))
    expect(() => f.service.openWorkspace({ kind: 'episode', projectId: b.id, episodeId: episode.id })).toThrow('belong')
    const workspace = f.service.openWorkspace({ kind: 'outline', projectId: a.id })
    const { view } = await run(f.service, workspace, a)
    f.service.setArchived(a.id, 1, true)
    expect(
      f.service.applyProposal({ proposalId: view.proposals[0]!.id, expectedRevision: 2, input: input(a), fields: ['outline'] }).status,
    ).toBe('archived')
    await expect(run(f.service, workspace, f.service.get(a.id))).rejects.toThrow('Archived')
    expect(f.service.get(b.id)).toEqual(b)
    expect(f.service.setArchived(a.id, 2, false).project.revision).toBe(3)
  })

  it('does not execute duplicate request IDs and refuses overlapping tasks', async () => {
    const f = await fixture()
    let resolve!: (result: StudioAssistantResult) => void
    vi.mocked(f.backend.execute).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    vi.mocked(f.backend.cancel).mockImplementation(async () => {
      resolve({ reply: 'Stopped', changes: [] })
    })
    const project = f.service.create(input())
    const workspace = f.service.openWorkspace({ kind: 'outline', projectId: project.id })
    const request = {
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Suggest a title',
    }
    const first = await f.service.startAssistant(request)
    const duplicate = await f.service.startAssistant(request)
    expect(duplicate.id).toBe(first.id)
    expect(f.backend.execute).toHaveBeenCalledTimes(1)
    await expect(f.service.startAssistant({ ...request, prompt: 'Different' })).rejects.toThrow('reused')
    await expect(f.service.startAssistant({ ...request, requestId: randomUUID() as StudioRequestId })).rejects.toThrow('running')
    resolve({ reply: 'Done', changes: [] })
    expect((await f.service.waitTask(first.id)).status).toBe('completed')
    expect((await f.service.startAssistant(request)).id).toBe(first.id)
    expect(f.backend.execute).toHaveBeenCalledTimes(1)
  })

  it('cancels owned work to settlement and preserves its original target after navigation', async () => {
    const f = await fixture()
    let reject!: (error: Error) => void
    vi.mocked(f.backend.execute).mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail
        }),
    )
    vi.mocked(f.backend.cancel).mockImplementation(async () => {
      reject(new DOMException('Cancelled', 'AbortError'))
    })
    const first = f.service.create(input())
    const second = f.service.create(input({ name: 'Other project' }))
    const workspace = f.service.openWorkspace({ kind: 'outline', projectId: first.id })
    const task = await f.service.startAssistant({
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Write',
    })
    f.service.openWorkspace({ kind: 'outline', projectId: second.id })
    const stopped = await f.service.cancelAssistant(task.id)
    expect(stopped.status).toBe('cancelled')
    expect(stopped.target).toEqual({ kind: 'outline', projectId: first.id })
    expect(f.service.workspace(workspace.workspace.id).proposals).toEqual([])
    expect(f.service.get(first.id)).toEqual(first)
    expect(f.service.get(second.id)).toEqual(second)
    expect((await f.service.cancelAssistant(task.id)).status).toBe('cancelled')
  })

  it('records only human decisions against the exact reviewed version', async () => {
    const f = await fixture()
    const project = f.service.create(input())
    const target = { kind: 'outline' as const, projectId: project.id }
    const review = f.service.submitReview(target, 1)
    expect(f.service.submitReview(target, 1).id).toBe(review.id)
    f.service.save(project.id, 1, input({ outline: 'Edited after submission' }))
    expect(() => f.service.decideReview(review.id, 'approved', 'Old version')).toThrow('changed')
    const current = f.service.submitReview(target, 2)
    const approved = f.service.decideReview(current.id, 'approved', 'Ready for planning')
    expect(approved).toMatchObject({ status: 'approved', projectRevision: 2 })
    expect(() => f.service.decideReview(current.id, 'returned', 'Overwrite decision')).toThrow('already')
    f.service.save(project.id, 2, input({ outline: 'Another draft' }))
    expect(f.service.reviews(project.id).find(value => value.id === current.id)).toEqual(approved)
  })

  it('refuses model output outside the target and reports provider failures without changing content', async () => {
    const f = await fixture()
    const project = f.service.create(input())
    f.result({ reply: 'Overwrite another field', changes: [{ field: 'name', value: 'Wrong scope' }] })
    const workspace = f.service.openWorkspace({ kind: 'outline', projectId: project.id })
    const invalid = await run(f.service, workspace, project)
    expect(invalid.task.status).toBe('failed')
    expect(invalid.view.proposals).toEqual([])
    vi.mocked(f.backend.execute).mockRejectedValue(new Error('Model is not configured'))
    const failed = await run(f.service, workspace, project)
    expect(failed.task.error).toContain('not configured')
    expect(f.service.get(project.id)).toEqual(project)
    expect(f.service.history(project.id)).toHaveLength(1)
  })

  it('returns explicit unavailable state and validates role publication before resolving providers', async () => {
    const f = await fixture()
    const role = f.service.roles().find(role => role.role === 'planner')!
    vi.mocked(f.backend.resolve).mockClear()
    await expect(f.service.publishRole('planner', 1, { ...role.config, timeoutMs: 0 })).rejects.toThrow()
    expect(f.backend.resolve).not.toHaveBeenCalled()
    f.unregister()
    expect(await f.service.assistantCatalog()).toMatchObject({ backendAvailable: false, enabledRoles: [] })
    await expect(f.service.publishRole('planner', 1, role.config)).rejects.toThrow('not configured')
  })
})
