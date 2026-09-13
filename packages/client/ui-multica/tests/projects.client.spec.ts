/** Deterministic project request and draft preservation regressions. */
import { describe, expect, it, vi } from 'vitest'
import type { Project, ProjectId, ProjectSummary, SaveResult } from '@deepseek-ai/dsh-api-remotes/client'
import { createMulticaStore, emptyInput, validInput } from '../src/client/drafts.ts'
import { ProjectModel, type ProjectApi } from '../src/client/projects.ts'

const id = '00000000-0000-4000-8000-000000000001' as ProjectId
const secondId = '00000000-0000-4000-8000-000000000002' as ProjectId
function project(values: Partial<Project> = {}): Project {
  return {
    ...emptyInput(),
    id,
    name: 'Story',
    revision: 1,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    archived: false,
    ...values,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function fixture(overrides: Partial<ProjectApi> = {}) {
  const current = project()
  const api: ProjectApi = {
    coverUploadLimit: vi.fn(async () => 1048576),
    setCover: vi.fn(async (_id: ProjectId, revision: number, image: string | null) => ({ revision: revision + 1, image })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => current),
    create: vi.fn(async () => current),
    save: vi.fn(async () => ({ status: 'saved' as const, project: project({ revision: 2 }) })),
    setArchived: vi.fn(async (_id: ProjectId, _revision: number, archived: boolean) => ({
      status: 'saved' as const,
      project: project({ revision: 2, archived }),
    })),
    history: vi.fn(async () => [current]),
    ...overrides,
  }
  const model = new ProjectModel(api)
  const store = createMulticaStore().create()
  return { model, store, api }
}

describe('project drafts', () => {
  it('retains separate project drafts and episode navigation across home and creation', () => {
    const { store } = fixture()
    store.actions.received(project())
    store.actions.received(project({ id: secondId, name: 'Second' }))
    store.actions.select(id)
    store.actions.edit(id, { outline: 'First local outline' })
    store.actions.page(id, 'settings')
    store.actions.select(secondId)
    store.actions.edit(secondId, { outline: 'Second local outline' })
    store.actions.home()
    store.actions.startCreate()
    store.actions.editCreate({ name: 'Third' })
    store.actions.home()
    store.actions.select(id)
    expect(store.getSnapshot().drafts[id]?.input.outline).toBe('First local outline')
    expect(store.getSnapshot().drafts[secondId]?.input.outline).toBe('Second local outline')
    expect(store.getSnapshot().pages[id]).toBe('settings')
    expect(store.getSnapshot().createInput.name).toBe('Third')
  })

  it('keeps nullable specifications and creates no episodes from the target count', () => {
    const { store } = fixture()
    expect(emptyInput()).toMatchObject({ targetEpisodes: null, episodeDuration: null, episodes: [] })
    store.actions.editCreate({ targetEpisodes: 8 })
    expect(store.getSnapshot().createInput.episodes).toEqual([])
  })

  it('validates Unicode code-point limits and nullable positive numeric fields', () => {
    const input = { ...emptyInput(), name: '😀'.repeat(50), concept: '界'.repeat(3000) }
    expect(validInput(input)).toBe(true)
    expect(validInput({ ...input, name: '😀'.repeat(51) })).toBe(false)
    expect(validInput({ ...input, concept: '界'.repeat(3001) })).toBe(false)
    for (const targetEpisodes of [0, -1, 1.5, Infinity]) expect(validInput({ ...input, targetEpisodes })).toBe(false)
    for (const episodeDuration of [0, -1, Infinity]) expect(validInput({ ...input, episodeDuration })).toBe(false)
    expect(validInput({ ...input, episodeDuration: 0.01 })).toBe(true)
    expect(validInput({ ...input, name: '  ' })).toBe(false)
  })


  it('preserves a dirty draft when restoring a remotely archived project', async () => {
    const remoteArchive = project({ revision: 2, archived: true, outline: 'Remote outline' })
    const restored = { ...remoteArchive, revision: 3, archived: false }
    const { model, store, api } = fixture({ setArchived: vi.fn(async () => ({ status: 'saved' as const, project: restored })) })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Unsaved local text' })
    store.actions.received(remoteArchive)
    const local = store.getSnapshot().drafts[id]!
    await model.save(id, { ...local, baseRevision: remoteArchive.revision }, store.actions, false)
    expect(api.setArchived).toHaveBeenCalledWith(id, 2, false)
    expect(store.getSnapshot().drafts[id]).toMatchObject({
      input: { outline: 'Unsaved local text' },
      dirty: true,
      conflict: true,
      baseRevision: 1,
    })
    expect(model.source.getSnapshot().byId[id]?.project).toEqual(restored)
    expect(api.save).not.toHaveBeenCalled()
    model.dispose()
  })

  it('returns conflict content without replacing the local draft or retrying', async () => {
    const remote = project({ revision: 3, outline: 'Remote' })
    const { model, store, api } = fixture({ save: vi.fn(async () => ({ status: 'conflict' as const, project: remote })) })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Local' })
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ conflict: true, dirty: true, baseRevision: 1, input: { outline: 'Local' } })
    expect(api.save).toHaveBeenCalledTimes(1)
    store.actions.loadRemote(remote)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ conflict: false, dirty: false, input: { outline: 'Remote' } })
    model.dispose()
  })

  it('retains edits made after a save started and rejects duplicate submissions', async () => {
    const write = deferred<SaveResult>()
    const { model, store, api } = fixture({ save: vi.fn(() => write.promise) })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Submitted' })
    const submitted = store.getSnapshot().drafts[id]!
    const save = model.save(id, submitted, store.actions)
    await model.save(id, submitted, store.actions)
    store.actions.edit(id, { outline: 'Typed later' })
    write.resolve({ status: 'saved' as const, project: project({ revision: 2, outline: 'Submitted' }) })
    await save
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ baseRevision: 2, dirty: true, input: { outline: 'Typed later' } })
    model.dispose()
  })

  it('ignores a read started before a completed save', async () => {
    const read = deferred<Project | null>()
    const { model, store, api } = fixture()
    await model.open(id, store.actions)
    vi.mocked(api.get).mockImplementationOnce(() => read.promise)
    const opening = model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Saved' })
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    read.resolve(project({ outline: 'Obsolete' }))
    await opening
    expect(model.source.getSnapshot().byId[id]?.project?.revision).toBe(2)
    expect(store.getSnapshot().drafts[id]?.baseRevision).toBe(2)
    model.dispose()
  })

  it('does not let late project reads change navigation', async () => {
    const read = deferred<Project | null>()
    const { model, store } = fixture({ get: async () => read.promise })
    store.actions.select(id)
    const opening = model.open(id, store.actions)
    store.actions.select(secondId)
    read.resolve(project())
    await opening
    expect(store.getSnapshot().selected).toBe(secondId)
    expect(store.getSnapshot().drafts[id]?.input.name).toBe('Story')
    model.dispose()
  })

  it('uses the latest catalog request and retains the last catalog on failure', async () => {
    const first = deferred<ProjectSummary[]>()
    const second = deferred<ProjectSummary[]>()
    const { model, api } = fixture({ list: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) })
    const old = model.list()
    const latest = model.list()
    const summaries = [{ ...project(), cover: { revision: 0, image: null }, episodeCount: 0 }]
    second.resolve(summaries)
    await latest
    first.resolve([])
    await old
    expect(model.source.getSnapshot().list).toEqual(summaries)
    vi.mocked(api.list).mockRejectedValueOnce(new Error('Offline'))
    await model.list()
    expect(model.source.getSnapshot()).toMatchObject({ list: summaries, error: true, loading: false })
    model.dispose()
  })

  it('restores historical content as a new revision and preserves the immutable input', async () => {
    const { model, store, api } = fixture()
    await model.open(id, store.actions)
    const old = project({ outline: 'Historical outline' })
    const before = JSON.stringify(old)
    store.actions.stageVersion(id, old)
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(api.save).toHaveBeenCalledWith(id, 1, expect.objectContaining({ outline: 'Historical outline' }))
    expect(JSON.stringify(old)).toBe(before)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ baseRevision: 2, dirty: false })
    model.dispose()
  })

  it('preserves creation form on failure and does not duplicate a pending create', async () => {
    const pending = deferred<Project>()
    const { model, store, api } = fixture({ create: vi.fn(() => pending.promise) })
    store.actions.startCreate()
    store.actions.editCreate({ name: 'Pending' })
    const { createInput, createEdit } = store.getSnapshot()
    const create = model.create(createInput, createEdit, store.actions)
    await model.create(createInput, createEdit, store.actions)
    pending.reject(new Error('Offline'))
    await create
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().createInput.name).toBe('Pending')
    expect(model.source.getSnapshot()).toMatchObject({ creating: false, createError: true })
    model.dispose()
  })

  it('silences late requests after disposal', async () => {
    const read = deferred<Project | null>()
    const { model, store } = fixture({ get: async () => read.promise })
    const opening = model.open(id, store.actions)
    model.dispose()
    read.resolve(project())
    await opening
    expect(store.getSnapshot().drafts[id]).toBeUndefined()
  })

  it('keeps history failures distinct from project failures and ignores superseded history', async () => {
    const first = deferred<Project[]>()
    const second = deferred<Project[]>()
    const { model, api } = fixture({ history: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) })
    const old = model.history(id)
    const latest = model.history(id)
    second.resolve([project({ revision: 2 })])
    await latest
    first.resolve([project()])
    await old
    expect(model.source.getSnapshot().byId[id]?.history[0]?.revision).toBe(2)
    vi.mocked(api.history).mockRejectedValueOnce(new Error('Unavailable'))
    await model.history(id)
    expect(model.source.getSnapshot().byId[id]).toMatchObject({ historyError: true, error: false, historyLoading: false })
    model.dispose()
  })

  it('preserves drafts after write failure and marks missing documents without creating a draft', async () => {
    const { model, store, api } = fixture({
      save: vi.fn(async () => {
        throw new Error('Offline')
      }),
    })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Keep this text' })
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(model.source.getSnapshot().byId[id]).toMatchObject({ saving: false, error: true })
    expect(store.getSnapshot().drafts[id]?.input.outline).toBe('Keep this text')
    vi.mocked(api.get).mockResolvedValueOnce(null)
    await model.open(secondId, store.actions)
    expect(model.source.getSnapshot().byId[secondId]).toMatchObject({ missing: true, loading: false })
    expect(store.getSnapshot().drafts[secondId]).toBeUndefined()
    model.dispose()
  })

  it('treats an archived write refusal as a preserved local conflict', async () => {
    const { model, store } = fixture({ save: vi.fn(async () => ({ status: 'archived' as const, project: project({ archived: true }) })) })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Local text' })
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ conflict: true, dirty: true, input: { outline: 'Local text' } })
    expect(model.source.getSnapshot().byId[id]?.project?.archived).toBe(true)
    model.dispose()
  })

  it('keeps a newer remote read when a successful write response arrives late', async () => {
    const write = deferred<SaveResult>()
    const { model, store, api } = fixture({ save: vi.fn(() => write.promise) })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Revision two' })
    const saving = model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    vi.mocked(api.get).mockResolvedValueOnce(project({ revision: 3, outline: 'Revision three' }))
    await model.open(id, store.actions)
    write.resolve({ status: 'saved', project: project({ revision: 2, outline: 'Revision two' }) })
    await saving
    expect(model.source.getSnapshot().byId[id]?.project?.revision).toBe(3)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ baseRevision: 3, input: { outline: 'Revision three' }, dirty: false })
    model.dispose()
  })

  it('ignores rejected requests superseded by later reads and refuses writes after disposal', async () => {
    const read = deferred<Project | null>()
    const list = deferred<ProjectSummary[]>()
    const { model, store, api } = fixture({
      get: vi.fn().mockReturnValueOnce(read.promise).mockResolvedValue(project()),
      list: vi.fn().mockReturnValueOnce(list.promise).mockResolvedValue([]),
    })
    const oldRead = model.open(id, store.actions)
    const oldList = model.list()
    await model.open(id, store.actions)
    await model.list()
    read.reject(new Error('Old read'))
    list.reject(new Error('Old list'))
    await Promise.all([oldRead, oldList])
    expect(model.source.getSnapshot()).toMatchObject({ error: false, byId: { [id]: { error: false } } })
    model.dispose()
    await model.create(emptyInput(), 0, store.actions)
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(api.create).not.toHaveBeenCalled()
    expect(api.save).not.toHaveBeenCalled()
  })

  it('does not redirect a cancelled creation or erase later form edits', async () => {
    const pending = deferred<Project>()
    const { model, store } = fixture({ create: async () => pending.promise })
    store.actions.startCreate()
    store.actions.editCreate({ name: 'Submitted' })
    const saving = model.create(store.getSnapshot().createInput, store.getSnapshot().createEdit, store.actions)
    store.actions.home()
    store.actions.editCreate({ name: 'Next idea' })
    pending.resolve(project({ name: 'Submitted' }))
    await saving
    expect(store.getSnapshot()).toMatchObject({ selected: null, creating: false, createInput: { name: 'Next idea' } })
    expect(store.getSnapshot().drafts[id]?.input.name).toBe('Submitted')
    model.dispose()
  })

  it('never downgrades a loaded revision through an older read or stale save completion', async () => {
    const { model, store, api } = fixture()
    await model.open(id, store.actions)
    vi.mocked(api.get).mockResolvedValueOnce(project({ revision: 3 }))
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'New local' })
    vi.mocked(api.get).mockResolvedValueOnce(project({ revision: 1 }))
    await model.open(id, store.actions)
    store.actions.saved(project({ revision: 2 }), 0)
    expect(store.getSnapshot().drafts[id]).toMatchObject({ baseRevision: 3, dirty: true, input: { outline: 'New local' } })
    expect(model.source.getSnapshot().byId[id]?.project?.revision).toBe(3)
    model.dispose()
  })

  it('fails loud when an editor action or write has no opened project', async () => {
    const { model, store } = fixture()
    expect(() => {
      store.actions.edit(id, { outline: 'Unowned' })
    }).toThrow('has not opened project')
    await expect(
      model.save(id, { input: emptyInput(), baseRevision: 1, dirty: true, edit: 1, conflict: false }, store.actions),
    ).rejects.toThrow('has not opened project')
    model.dispose()
  })

  it('saves a newly created project before a separate read is needed', async () => {
    const { model, store, api } = fixture()
    store.actions.startCreate()
    await model.create({ ...emptyInput(), name: 'New story' }, 0, store.actions)
    store.actions.edit(id, { outline: 'First outline' })
    await model.save(id, store.getSnapshot().drafts[id]!, store.actions)
    expect(api.get).not.toHaveBeenCalled()
    expect(store.getSnapshot().drafts[id]?.baseRevision).toBe(2)
    model.dispose()
  })

  it.each(['resolve', 'reject'] as const)('silences %s of create, write, and history requests after disposal', async (outcome) => {
    const creation = deferred<Project>()
    const write = deferred<SaveResult>()
    const history = deferred<Project[]>()
    const { model, store } = fixture({ create: () => creation.promise, save: () => write.promise, history: () => history.promise })
    await model.open(id, store.actions)
    store.actions.edit(id, { outline: 'Local' })
    const pending = [
      model.create(emptyInput(), 0, store.actions),
      model.save(id, store.getSnapshot().drafts[id]!, store.actions),
      model.history(id),
    ]
    const before = store.getSnapshot()
    model.dispose()
    if (outcome === 'resolve') {
      creation.resolve(project({ id: secondId }))
      write.resolve({ status: 'saved', project: project({ revision: 2 }) })
      history.resolve([project()])
    } else {
      creation.reject(new Error('Stopped'))
      write.reject(new Error('Stopped'))
      history.reject(new Error('Stopped'))
    }
    await Promise.all(pending)
    expect(store.getSnapshot()).toBe(before)
    expect(model.source.getSnapshot().byId[id]?.project?.revision).toBe(1)
  })

  it('ignores a history error superseded by a later successful refresh', async () => {
    const first = deferred<Project[]>()
    const { model, api } = fixture({ history: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([project()]) })
    const old = model.history(id)
    await model.history(id)
    first.reject(new Error('Old failure'))
    await old
    expect(model.source.getSnapshot().byId[id]).toMatchObject({ historyError: false, historyLoading: false })
    expect(api.history).toHaveBeenCalledTimes(2)
    model.dispose()
  })
})
