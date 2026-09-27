import type { ProjectId, StudioTaskView, StudioTaskId, StudioRequestId, StudioProposalId } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, vi } from 'vitest'
import { studioFixture, workspace } from './studio-fixture.client.ts'
import { createMulticaStore, emptyInput } from '../src/client/drafts.ts'
import { studioTargetKey } from '../src/client/studio.ts'

const target = { kind: 'outline' as const, projectId: '00000000-0000-4000-8000-000000000001' as ProjectId }
const view = workspace(target)
function task(patch: Partial<StudioTaskView> = {}): StudioTaskView {
  return {
    id: '00000000-0000-4000-8000-000000000012' as StudioTaskId,
    workspaceId: view.workspace.id,
    requestId: '00000000-0000-4000-8000-000000000013' as StudioRequestId,
    target,
    sessionId: view.workspace.sessionId,
    role: 'planner',
    roleRevision: 1,
    provider: 'configured',
    model: 'text',
    expectedRevision: 1,
    prompt: 'Original request',
    status: 'running',
    reply: '',
    error: null,
    createdAt: view.workspace.createdAt,
    finishedAt: null,
    ...patch,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('professional request ownership', () => {
  it('opens without execution and keeps the exact request nonce and input across an uncertain transport retry', async () => {
    const { model, api } = studioFixture()
    await model.open(target)
    expect(api.start).not.toHaveBeenCalled()
    vi.mocked(api.start)
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockImplementationOnce(async request => task({ requestId: request.requestId, status: 'completed' }))
    vi.mocked(api.workspace).mockResolvedValue(view)
    const submitted = vi.fn()
    const input = { ...emptyInput(), name: 'Original project', outline: 'Captured text' }
    const modelSelection = { provider: 'second-provider', model: 'creative', reasoningEffort: 'high' }
    await model.send(view.workspace.id, 1, input, 'Original request', submitted, modelSelection)
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ modelSelection }))
    expect(submitted).not.toHaveBeenCalled()
    expect(model.source.getSnapshot().byId[view.workspace.id]?.retry?.input.outline).toBe('Captured text')
    await model.send(view.workspace.id, 1, { ...input, outline: 'Later text' }, 'Later request', submitted)
    expect(api.start).toHaveBeenCalledTimes(1)
    await model.retry(view.workspace.id, submitted)
    expect(vi.mocked(api.start).mock.calls[1]).toEqual(vi.mocked(api.start).mock.calls[0])
    expect(submitted).toHaveBeenCalledTimes(1)
    expect(model.source.getSnapshot().byId[view.workspace.id]?.retry).toBeNull()
    model.dispose()
  })

  it('settles a running task into its original workspace after navigating to another project', async () => {
    const { model, api } = studioFixture()
    const waiting = deferred<StudioTaskView>()
    vi.mocked(api.wait).mockReturnValue(waiting.promise)
    vi.mocked(api.open).mockImplementation(async selected =>
      selected.kind !== 'creation' && selected.projectId === target.projectId
        ? { ...view, tasks: [task()] }
        : workspace(selected, '00000000-0000-4000-8000-000000000020' as typeof view.workspace.id),
    )
    vi.mocked(api.workspace).mockResolvedValue({ ...view, tasks: [task({ status: 'completed', reply: 'Original project reply' })] })
    await model.open(target)
    const other = { ...target, projectId: '00000000-0000-4000-8000-000000000002' as ProjectId }
    await model.open(other)
    waiting.resolve(task({ status: 'completed' }))
    await expect.poll(() => model.source.getSnapshot().byId[view.workspace.id]?.view?.tasks[0]?.status).toBe('completed')
    const otherId = model.source.getSnapshot().bindings[studioTargetKey(other)]!
    expect(model.source.getSnapshot().byId[otherId]?.view?.tasks).toEqual([])
    expect(api.start).not.toHaveBeenCalled()
    model.dispose()
  })

  it('does not publish stale reads or deliver a late mutation into a disposed renderer', async () => {
    const { model, api } = studioFixture()
    const old = deferred<typeof view>()
    vi.mocked(api.open).mockReturnValueOnce(old.promise).mockResolvedValueOnce(view)
    const opening = model.open(target)
    await model.open(target)
    old.resolve(workspace(target, '00000000-0000-4000-8000-000000000021' as typeof view.workspace.id))
    await opening
    expect(model.source.getSnapshot().bindings[studioTargetKey(target)]).toBe(view.workspace.id)
    const result = deferred<Awaited<ReturnType<typeof api.apply>>>()
    vi.mocked(api.apply).mockReturnValue(result.promise)
    const applied = vi.fn()
    const request = {
      proposalId: '00000000-0000-4000-8000-000000000030' as StudioProposalId,
      expectedRevision: 1,
      input: emptyInput(),
      fields: ['outline' as const],
    }
    const applying = model.apply(view.workspace.id, request, applied)
    model.dispose()
    result.resolve({ status: 'conflict', fields: ['outline'], project: null, creation: null })
    await applying
    expect(applied).not.toHaveBeenCalled()
  })

  it('preserves text typed after submission and merges only fields unchanged since the captured proposal input', () => {
    const store = createMulticaStore().create()
    const key = studioTargetKey(target)
    store.actions.assistantPrompt(key, 'Original request')
    store.actions.assistantPrompt(key, 'Later request')
    store.actions.promptSubmitted(key, 'Original request')
    expect(store.getSnapshot().assistantPrompts[key]).toBe('Later request')
    const creation = store.getSnapshot().creationId
    const captured = { ...emptyInput(), name: 'Original name', concept: 'Original idea' }
    store.actions.editCreate(captured)
    store.actions.editCreate({ name: 'My later name' })
    const proposed = { ...captured, name: 'Proposed name', concept: 'Proposed idea' }
    store.actions.proposalApplied({ kind: 'creation', draftId: creation }, captured, proposed, null, ['name', 'concept'], {
      id: creation,
      revision: 2,
      input: proposed,
      updatedAt: view.workspace.createdAt,
    })
    expect(store.getSnapshot().createInput).toMatchObject({ name: 'My later name', concept: 'Proposed idea' })
    expect(store.getSnapshot().createDirty).toBe(true)
  })
})
