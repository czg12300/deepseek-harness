// @vitest-environment jsdom
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EpisodeId, Project, ProjectId, ProjectInput, ProjectSummary, StudioFolderId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { createMulticaStore, emptyInput } from '../src/client/drafts.ts'
import { ProjectModel, type ProjectApi } from '../src/client/projects.ts'
import { Workspace, type WorkspaceProps } from '../src/client/Workspace.tsx'
import { studioFixture, workspace, role } from './studio-fixture.client.ts'
import type { StudioProposal, StudioReview, StudioTaskView } from '@deepseek-ai/dsh-api-remotes/client'
import { studioTargetKey, type StudioModel } from '../src/client/studio.ts'
import type { PortableProjectActions } from '../src/client/ProjectLocation.tsx'
import { MulticaIcon } from '../src/client/MulticaIcon.tsx'
import { exportDraft, VersionPreview } from '../src/client/VersionPreview.tsx'
import { en, zh, type MulticaKey } from '../src/client/locales.ts'
import { ActorModel } from '../src/client/actors.ts'
import { ProjectContentModel } from '../src/client/project-content.ts'

const id = '00000000-0000-4000-8000-000000000001' as ProjectId
const id2 = '00000000-0000-4000-8000-000000000002' as ProjectId
function project(patch: Partial<Project> = {}): Project {
  return {
    ...emptyInput(),
    id,
    name: 'Rain',
    concept: 'A letter in the rain',
    revision: 1,
    archived: false,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...patch,
  }
}
function summary(value: Project): ProjectSummary {
  return { ...value, cover: { revision: 0, image: null }, episodeCount: value.episodes.length }
}
function translator(dictionary: Record<MulticaKey, string>) {
  return (key: string, params: Record<string, unknown> = {}): string => {
    const value = dictionary[key as MulticaKey]
    if (value === undefined) throw new Error(`Missing dictionary key ${key}`)
    return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
  }
}
function selector<T>(source: ObservableSnapshot<T>) {
  return <S,>(select: (value: T) => S): S =>
    select(
      useSyncExternalStore(
        listener => source.subscribe(listener),
        () => source.getSnapshot(),
      ),
    )
}
const models: Array<ProjectModel | StudioModel | ActorModel | ProjectContentModel> = []
const restorers: (() => void)[] = []
afterEach(() => {
  cleanup()
  models.splice(0).forEach((model) => {
    model.dispose()
  })
  vi.restoreAllMocks()
})

function fixture(values: Project[] = [], dictionary: Record<MulticaKey, string> = en) {
  let projects = [...values]
  const api: ProjectApi = {
    coverUploadLimit: vi.fn(async () => 1048576),
    setCover: vi.fn(async (_id: ProjectId, revision: number, image: string | null) => ({ revision: revision + 1, image })),
    list: vi.fn(async () => projects.map(summary)),
    get: vi.fn(async (pid: ProjectId) => projects.find(p => p.id === pid) ?? null),
    create: vi.fn(async (input: ProjectInput) => {
      const created = project({ ...input })
      projects = [...projects, created]
      return created
    }),
    save: vi.fn(async (pid: ProjectId, revision: number, input: ProjectInput) => {
      const saved = project({ ...input, id: pid, revision: revision + 1 })
      projects = projects.map(p => (p.id === pid ? saved : p))
      return { status: 'saved' as const, project: saved }
    }),
    setArchived: vi.fn(async (pid: ProjectId, revision: number, archived: boolean) => {
      const saved = { ...projects.find(p => p.id === pid)!, revision: revision + 1, archived }
      projects = projects.map(p => (p.id === pid ? saved : p))
      return { status: 'saved' as const, project: saved }
    }),
    history: vi.fn(async (pid: ProjectId) => values.filter(p => p.id === pid)),
  }
  const model = new ProjectModel(api)
  models.push(model)
  const store = createMulticaStore().create()
  const studio = studioFixture(store)
  models.push(studio.model)
  const actorModel = new ActorModel({
    libraries: vi.fn(async () => []), create: vi.fn(), list: vi.fn(async () => ({ actors: [], total: 0 })),
    actor: vi.fn(async () => null), save: vi.fn(), export: vi.fn(), import: vi.fn(),
  })
  models.push(actorModel)
  const contentModel = new ProjectContentModel({
    documents: vi.fn(async () => []), saveDocument: vi.fn(), complete: vi.fn(async () => false),
    confirm: vi.fn(), units: vi.fn(async () => []), createUnit: vi.fn(), nodes: vi.fn(async () => []),
    addNode: vi.fn(), moveNode: vi.fn(), assets: vi.fn(async () => []), importMedia: vi.fn(), mediaData: vi.fn(async () => null),
  })
  models.push(contentModel)
  // These standard seats are unused by this root-scoped feature; the fixture binds only its declared sources.
  const props = {
    useStore: selector(store),
    useStudio: selector(studio.model.source),
    useActors: selector(actorModel.source),
    useContent: selector(contentModel.source),
    contentActions: contentModel,
    actorActions: {
      load: () => actorModel.load(), select: id => actorModel.select(id),
      filter: (search, period, region) => actorModel.filter(search, period, region),
      more: () => actorModel.more(), create: name => actorModel.create(name),
      actor: id => actorModel.actor(id), save: (id, input) => actorModel.save(id, input),
      export: () => actorModel.export(), import: (dataUrl, merge) => actorModel.import(dataUrl, merge),
    },
    studioActions: studio.actions,
    useProjects: selector(model.source),
    actions: store.actions,
    t: translator(dictionary),
    load: () => model.list(),
    setCover: (pid, revision, image) => model.setCover(pid, revision, image),
    open: (pid: ProjectId) => model.open(pid, store.actions),
    create: (input, edit) => model.create(input, edit, store.actions),
    save: (pid, draft, archived) => model.save(pid, draft, store.actions, archived),
    history: (pid: ProjectId) => model.history(pid),
    reportUnsaved: vi.fn(),
    renderSlot: (_name, values) => {
      const owner = values as unknown as SlotMap['multica.assistant.composer']['owner']
      return <>
        <textarea aria-label={owner.label} value={owner.value} disabled={owner.disabled}
          onChange={(event) => { owner.onChange(event.target.value) }} />
        <button disabled={owner.sendDisabled} onClick={owner.onSend}>{dictionary.send}</button>
      </>
    },
  } as WorkspaceProps
  return { props, store, api, model, studio }
}

function mockDownloads() {
  const blobs: Blob[] = []
  for (const [name, value] of [
    [
      'createObjectURL',
      (blob: Blob) => {
        blobs.push(blob)
        return 'blob:multica-test'
      },
    ],
    ['revokeObjectURL', vi.fn()],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(URL, name)
    Object.defineProperty(URL, name, { value, configurable: true })
    restorers.push(() => {
      if (original) Object.defineProperty(URL, name, original)
      else Reflect.deleteProperty(URL, name)
    })
  }
  const downloads: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
  return { blobs, downloads }
}

async function openCard(name: string): Promise<void> {
  const card = await screen.findByRole('article', { name })
  fireEvent.click(within(card).getByRole('button', { name: en.open }))
  await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })
}

describe('Multica workspace', () => {
  it('switches the project and actor catalogs as tabs in one workspace', async () => {
    const { props } = fixture([], en)
    render(<Workspace {...props} />)
    expect(screen.getByRole('tab', { name: en.home }).getAttribute('aria-selected')).toBe('true')
    const actorTab = screen.getByRole('tab', { name: en.actorLibrary })
    fireEvent.click(actorTab)
    expect(screen.getByRole('tab', { name: en.actorLibrary }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('button', { name: en.back })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: en.home }))
    expect(screen.getByRole('tab', { name: en.home }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('textbox', { name: en.search })).toBeTruthy()
  })

  it.each(['header', 'card'])('opens a chosen project from the %s, preserves cancellation and reports failures', async (entry) => {
    const { props } = fixture([], zh)
    const pick = vi.fn<PortableProjectActions['pick']>().mockResolvedValue(null)
    const open = vi.fn<PortableProjectActions['open']>().mockResolvedValue(undefined)
    const portable: PortableProjectActions = {
      pick, open, reveal: vi.fn(), prepare: vi.fn(), close: vi.fn(), forget: vi.fn(),
      backup: vi.fn(), migrate: vi.fn(), autosave: vi.fn(), select: vi.fn(),
    }
    render(<Workspace {...props} portable={portable} />)
    await screen.findByText(zh.empty)
    expect(screen.queryByRole('button', { name: zh.review })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.agentConfig })).toBeNull()
    expect(screen.queryByText(zh.openProjectDirectory)).toBeNull()
    const buttons = screen.getAllByRole('button', { name: zh.openProject })
    expect(buttons).toHaveLength(2)
    const button = entry === 'header' ? buttons[0]!
      : within(screen.getByRole('region', { name: zh.createOrOpenTitle })).getByRole('button', { name: zh.openProject })
    fireEvent.click(button)
    await waitFor(() => { expect(button).toHaveProperty('disabled', false) })
    expect(open).not.toHaveBeenCalled()
    pick.mockRejectedValueOnce(new Error('Picker unavailable'))
    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toBe('Picker unavailable')
    pick.mockResolvedValue('/drive/story')
    open.mockRejectedValueOnce(new Error('Project database is missing'))
    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toBe('Project database is missing')
    fireEvent.click(button)
    await waitFor(() => { expect(button).toHaveProperty('disabled', false) })
    expect(open).toHaveBeenLastCalledWith('/drive/story')
    expect(screen.queryByRole('alert')).toBeNull()
  })


  it('confirms catalog deletion, keeps failures retryable and disables repeated removal', async () => {
    const { props, api } = fixture([project()], zh)
    const folderId = '00000000-0000-4000-8000-000000000003' as StudioFolderId
    api.folders = vi.fn(async () => [{ id: folderId, projectId: id, creationId: null, path: '/drive/rain', name: 'Rain', state: 'open' as const }])
    const remove = vi.fn<PortableProjectActions['forget']>().mockRejectedValueOnce(new Error('Catalog unavailable'))
    const portable: PortableProjectActions = {
      pick: vi.fn(), open: vi.fn(), reveal: vi.fn(), prepare: vi.fn(), close: vi.fn(), forget: remove,
      backup: vi.fn(), migrate: vi.fn(), autosave: vi.fn(), select: vi.fn(),
    }
    render(<Workspace {...props} portable={portable} />)
    const card = await screen.findByRole('article', { name: 'Rain' })
    fireEvent.click(within(card).getByRole('button', { name: '删除项目：Rain' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('不删除对应文件夹及作品内容')
    fireEvent.click(within(screen.getByRole('dialog')).getByText(zh.cancel, { selector: 'button' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(card).getByRole('button', { name: '删除项目：Rain' }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmDeleteProject }))
    expect((await screen.findByRole('alert')).textContent).toBe('Catalog unavailable')
    let finish!: () => void
    remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmDeleteProject }))
    expect(screen.getByRole('button', { name: zh.confirmDeleteProject })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { finish() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(remove).toHaveBeenLastCalledWith(folderId)
  })

  it('closes creation with the close button or Escape and preserves the draft for reopening', async () => {
    const { props, api } = fixture()
    render(<Workspace {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.newProject })[0]!)
    const dialog = screen.getByRole('dialog', { name: en.createTitle })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).queryByText(en.cancel)).toBeNull()
    expect(within(dialog).queryByText(en.home)).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: en.name }), { target: { value: 'A retained story' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.closeCreation }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('tab', { name: en.home }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: en.continueCreation }))
    expect(screen.getByRole('textbox', { name: en.name })).toHaveProperty('value', 'A retained story')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('creates manually with illustrated aspect choices and nullable scale, without adding episodes', async () => {
    const { props, api } = fixture()
    render(<Workspace {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.newProject })[0]!)
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }), {
      target: { value: 'New story' },
    })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.concept }), {
      target: { value: '🌊'.repeat(3000) },
    })
    fireEvent.click(screen.getByRole('radio', { name: en.portrait }))
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('textbox', { name: en.source })).toBeNull()
    expect(screen.queryByText(en.optionalSettings)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New story', aspectRatio: '9:16', targetEpisodes: null, episodeDuration: null, episodes: [] }),
    )
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: en.send }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(en.assistantUnavailable)).toBeTruthy()
  })

  it('shows code-point counts and prevents invalid names and concepts', async () => {
    const { props, api } = fixture()
    render(<Workspace {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.newProject })[0]!)
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }), {
      target: { value: '😀'.repeat(51) },
    })
    expect(screen.getByText('51 / 50 characters')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.create }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }), {
      target: { value: '😀'.repeat(50) },
    })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.concept }), {
      target: { value: '界'.repeat(3001) },
    })
    expect(screen.getByText('3001 / 3000 characters')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.create }).hasAttribute('disabled')).toBe(true)
    expect(api.create).not.toHaveBeenCalled()
  })

  it('preserves project drafts across home, project switching, and main-entry remount', async () => {
    const { props } = fixture([project(), project({ id: id2, name: 'Sea' })])
    const view = render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Local Rain outline' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    await openCard('Sea')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Local Sea outline' },
    })
    view.unmount()
    render(<Workspace {...props} />)
    expect((await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })).value).toBe(
      'Local Sea outline',
    )
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    await openCard('Rain')
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }).value).toBe('Local Rain outline')
  })

  it('adds and edits episodes explicitly and saves their stable identity', async () => {
    const { props, api } = fixture([project()])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.click(screen.getByRole('button', { name: en.episodes }))
    fireEvent.click(screen.getByRole('button', { name: en.addEpisode }))
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeTitle }), {
      target: { value: 'The letter' },
    })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeScript }), {
      target: { value: 'Rain falls.' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText('Version 2')
    expect(api.save).toHaveBeenCalledWith(
      id,
      1,
      expect.objectContaining({ episodes: [{ id: expect.any(String) as string, title: 'The letter', script: 'Rain falls.' }] }),
    )
    expect(screen.getByRole('button', { name: en.storyboard }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en.previous }).hasAttribute('disabled')).toBe(true)
  })

  it('renders archive filters and keeps archived project text read-only until restoration', async () => {
    const { props, api } = fixture([project({ archived: true })])
    render(<Workspace {...props} />)
    fireEvent.click(screen.getByRole('button', { name: en.archived }))
    await openCard('Rain')
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    fireEvent.click(screen.getByRole('button', { name: en.restore }))
    await screen.findByText('Version 2')
    expect(api.setArchived).toHaveBeenCalledWith(id, 1, false)
    fireEvent.click(screen.getByRole('button', { name: en.outline }))
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }).hasAttribute('disabled')).toBe(false)
  })

  it('shows named conflict fields and retains local text until explicitly loading remote', async () => {
    const { props, api, store } = fixture([project()])
    vi.mocked(api.save).mockResolvedValueOnce({ status: 'conflict', project: project({ revision: 2, outline: 'Remote text' }) })
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Local text' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const conflict = await screen.findByRole('region', { name: en.conflict })
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }).value).toBe('Local text')
    fireEvent.click(within(conflict).getByText('Remote version 2'))
    expect(within(conflict).getByText('Remote text')).toBeTruthy()
    expect(within(conflict).getAllByText(en.name)).toHaveLength(2)
    fireEvent.click(within(conflict).getByRole('button', { name: en.loadRemote }))
    expect(store.getSnapshot().drafts[id]).toMatchObject({ dirty: false, conflict: false, input: { outline: 'Remote text' } })
  })


  it('uses Chinese copy without internal phase codes', async () => {
    const { props } = fixture([], zh)
    render(<Workspace {...props} />)
    expect(zh.nav).toBe('漫剧')
    fireEvent.click(screen.getAllByRole('button', { name: zh.newProject })[0]!)
    expect(screen.getByRole('heading', { name: zh.createTitle })).toBeTruthy()
    expect(screen.queryByText(zh.assistantUnavailable)).toBeNull()
    expect(screen.queryByText(/S2/)).toBeNull()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('filters, searches, sorts, refreshes, and opens the secondary creation card', async () => {
    const { props } = fixture([project(), project({ id: id2, name: 'A sea story', updatedAt: '2026-09-09T00:00:00.000Z' })])
    render(<Workspace {...props} />)
    await screen.findByRole('article', { name: 'Rain' })
    fireEvent.change(screen.getByRole('combobox', { name: en.sort }), { target: { value: 'oldest' } })
    expect(screen.getAllByRole('article')[0]).toHaveProperty('ariaLabel', 'A sea story')
    fireEvent.change(screen.getByRole('combobox', { name: en.sort }), { target: { value: 'byName' } })
    expect(screen.getAllByRole('article')[0]).toHaveProperty('ariaLabel', 'A sea story')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.search }), {
      target: { value: 'absent' },
    })
    expect(screen.getByRole('heading', { name: en.noMatches })).toBeTruthy()
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.search }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.archived }))
    expect(screen.getByRole('heading', { name: en.noArchived })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.active }))
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByRole('article', { name: 'Rain' })
    fireEvent.click(screen.getAllByRole('button', { name: en.newProject })[1]!)
    fireEvent.click(screen.getByRole('button', { name: en.closeCreation }))
    expect(screen.getByRole('tab', { name: en.home }).getAttribute('aria-selected')).toBe('true')
  })

  it('edits project specifications, discards explicitly, then saves and archives', async () => {
    const { props, api } = fixture([project()])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }), {
      target: { value: 'Discard me' },
    })
    expect(screen.getByRole('button', { name: en.archive }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.loadRemote }))
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }).value).toBe('Rain')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name }), {
      target: { value: 'Renamed' },
    })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.source }), {
      target: { value: 'Original script' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.duration }), { target: { value: '60' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.duration }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.count }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.count }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('radio', { name: en.square }))
    fireEvent.click(screen.getByRole('button', { name: en.saveSettings }))
    await screen.findByText('Version 2')
    expect(api.save).toHaveBeenCalledWith(
      id,
      1,
      expect.objectContaining({
        name: 'Renamed',
        sourceText: 'Original script',
        episodeDuration: null,
        targetEpisodes: null,
        aspectRatio: '1:1',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: en.archive }))
    await screen.findByText('Version 3')
    expect(api.setArchived).toHaveBeenCalledWith(id, 2, true)
  })

  it('navigates episode lists and adjacent episodes without changing sibling scripts', async () => {
    const episodes = [
      { id: '00000000-0000-4000-8000-000000000003' as EpisodeId, title: 'First', script: 'First script' },
      { id: '00000000-0000-4000-8000-000000000004' as EpisodeId, title: 'Second', script: 'Second script' },
    ]
    const { props, store } = fixture([project({ episodes })])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.click(screen.getByRole('button', { name: en.episodes }))
    fireEvent.click(screen.getAllByRole('button', { name: en.script })[0]!)
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeTitle }), {
      target: { value: 'First revised' },
    })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeScript }), {
      target: { value: 'New first script' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeScript }).value).toBe('Second script')
    fireEvent.click(screen.getByRole('button', { name: en.previous }))
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeScript }).value).toBe('New first script')
    expect(store.getSnapshot().drafts[id]?.input.episodes[1]).toEqual(episodes[1])
    fireEvent.click(screen.getByRole('button', { name: /02\s*Second/ }))
    expect(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.episodeScript }).value).toBe('Second script')
  })

  it('restores history into a new revision and blocks history replacement while dirty', async () => {
    const historical = project({ outline: 'The first outline' })
    const { props, api } = fixture([project({ revision: 2, outline: 'Current outline' })])
    vi.mocked(api.history).mockResolvedValue([historical, project({ revision: 2 })])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Unfinished local draft' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.history }))
    await screen.findByRole('button', { name: en.restoreVersion })
    expect(screen.getByRole('button', { name: en.restoreVersion }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(en.historyDirty)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.loadRemote }))
    fireEvent.click(screen.getByRole('button', { name: en.restoreVersion }))
    await screen.findByText('Version 3')
    expect(api.save).toHaveBeenCalledWith(id, 2, expect.objectContaining({ outline: 'The first outline' }))
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    expect(await screen.findAllByRole('button', { name: en.restoreVersion })).toHaveLength(2)
    expect(historical.revision).toBe(1)
  })

  it('retains a conflicting draft through explicit reconciliation using the latest revision', async () => {
    const { props, api, store } = fixture([project()])
    vi.mocked(api.save).mockResolvedValueOnce({ status: 'conflict', project: project({ revision: 4, outline: 'Remote' }) })
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Local decision' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    fireEvent.click(await screen.findByRole('button', { name: en.reconcile }))
    await screen.findByText('Version 5')
    expect(api.save).toHaveBeenLastCalledWith(id, 4, expect.objectContaining({ outline: 'Local decision' }))
    expect(store.getSnapshot().drafts[id]?.dirty).toBe(false)
  })

  it('uses the project selector for all projects, new projects, and cancellation back to a project', async () => {
    const { props, store } = fixture([project(), project({ id: id2, name: 'Sea' })])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.change(screen.getByRole('combobox', { name: en.selectProject }), { target: { value: id2 } })
    await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })
    expect(store.getSnapshot().selected).toBe(id2)
    fireEvent.change(screen.getByRole('combobox', { name: en.selectProject }), { target: { value: 'new' } })
    expect(screen.getByRole('dialog', { name: en.createTitle })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.closeCreation }))
    expect(store.getSnapshot().selected).toBe(id2)
    fireEvent.change(screen.getByRole('combobox', { name: en.selectProject }), { target: { value: 'all' } })
    expect(screen.getByRole('tab', { name: en.home }).getAttribute('aria-selected')).toBe('true')
  })

  it('renders the sidebar glyph as decorative content and exports complete local fields', async () => {
    const icon = render(createElement(MulticaIcon, { size: 24, active: true } as Parameters<typeof MulticaIcon>[0]))
    expect(icon.container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(icon.container.querySelector('button')).toBeNull()
    icon.unmount()
    const { blobs, downloads } = mockDownloads()
    const input = { ...emptyInput(), name: 'Local export', sourceText: 'Source', outline: 'Draft' }
    exportDraft(input)
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const text = reader.result
        if (typeof text === 'string') resolve(text)
        else reject(new Error('Expected a text download'))
      }
      reader.onerror = () => {
        reject(reader.error ?? new Error('Read failed'))
      }
      reader.readAsText(blobs[0]!)
    })
    expect(JSON.parse(text)).toEqual(input)
    expect(downloads).toEqual(['multica-project-draft.json'])
    const episode = { id: '00000000-0000-4000-8000-000000000005' as EpisodeId, title: 'Episode preview', script: 'Historical dialogue' }
    render(<VersionPreview input={{ ...input, episodes: [episode] }} t={translator(en)} />)
    expect(screen.getByText('Episode preview')).toBeTruthy()
    expect(screen.getByText('Historical dialogue')).toBeTruthy()
  })

  it('offers retry for catalog, project, and history failures without losing drafts', async () => {
    const { props, api } = fixture([project()])
    vi.mocked(api.list).mockRejectedValueOnce(new Error('Catalog offline'))
    const view = render(<Workspace {...props} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    const card = await screen.findByRole('article', { name: 'Rain' })
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Read offline'))
    fireEvent.click(within(card).getByRole('button', { name: en.open }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })
    vi.mocked(api.history).mockRejectedValueOnce(new Error('History offline')).mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: en.history }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await screen.findByText(en.historyEmpty)
    view.unmount()
    const missing = fixture()
    missing.store.actions.select(id)
    render(<Workspace {...missing.props} />)
    await screen.findByText(en.missing)
    expect(screen.queryByRole('textbox', { name: en.outline })).toBeNull()
  })

  it('preserves failed creation input and guards missing names', async () => {
    const { props, api, store } = fixture()
    vi.mocked(api.create).mockRejectedValueOnce(new Error('Create offline'))
    render(<Workspace {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: en.newProject })[0]!)
    const name = screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name })
    fireEvent.submit(name.closest('form')!)
    expect(api.create).not.toHaveBeenCalled()
    fireEvent.change(name, { target: { value: 'Keep my idea' } })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    await screen.findByRole('alert')
    expect(store.getSnapshot().createInput.name).toBe('Keep my idea')
  })

  it('exports project, conflict, and history drafts without saving them', async () => {
    const { blobs } = mockDownloads()
    const { props, api } = fixture([project()])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.click(screen.getByRole('button', { name: en.export }))
    expect(api.save).not.toHaveBeenCalled()
    vi.mocked(api.save).mockResolvedValueOnce({ status: 'conflict', project: project({ revision: 2 }) })
    fireEvent.change(screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline }), {
      target: { value: 'Local conflict' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    const conflict = await screen.findByRole('region', { name: en.conflict })
    fireEvent.click(within(conflict).getByRole('button', { name: en.export }))
    fireEvent.click(within(conflict).getByRole('button', { name: en.loadRemote }))
    fireEvent.click(screen.getByRole('button', { name: en.history }))
    fireEvent.click(screen.getAllByRole('button', { name: en.export })[0]!)
    expect(blobs).toHaveLength(3)
    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it('shows the selected project even when a catalog refresh omits it and rejects invalid settings', async () => {
    const { props, api, store } = fixture([project()])
    vi.mocked(api.list).mockResolvedValue([])
    store.actions.select(id)
    render(<Workspace {...props} />)
    await screen.findByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.outline })
    expect(screen.getByRole('option', { name: 'Rain' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.settings }))
    const name = screen.getByRole<HTMLInputElement | HTMLTextAreaElement>('textbox', { name: en.name })
    fireEvent.change(name, { target: { value: '' } })
    fireEvent.submit(name.closest('form')!)
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: en.saveSettings }).hasAttribute('disabled')).toBe(true)
  })
  it('restores the latest successful model after remount and leaves an explicit draft choice in control', async () => {
    const { props, studio, store } = fixture([project()])
    const target = { kind: 'outline' as const, projectId: id }
    const initial = workspace(target)
    const task: StudioTaskView = {
      id: '00000000-0000-4000-8000-000000000031' as StudioTaskView['id'],
      requestId: '00000000-0000-4000-8000-000000000032' as StudioTaskView['requestId'],
      workspaceId: initial.workspace.id, target, sessionId: initial.workspace.sessionId,
      role: 'planner', roleRevision: 1, provider: 'connected', model: 'working', reasoningEffort: 'high', expectedRevision: 1,
      prompt: 'Connection test', status: 'completed', reply: 'Connected', error: null,
      createdAt: initial.workspace.createdAt, finishedAt: initial.workspace.createdAt,
    }
    initial.workspace.resolved = { provider: 'old-route', model: 'unavailable', skills: [], tools: [] }
    initial.tasks = [task, { ...task, id: '00000000-0000-4000-8000-000000000033' as StudioTaskView['id'],
      model: 'unsupported', status: 'failed', reply: '', error: 'Model unavailable' }]
    vi.mocked(studio.api.open).mockResolvedValue(initial)
    vi.mocked(studio.api.catalog).mockResolvedValue({ backendAvailable: true, enabledRoles: ['planner'], defaultModel: null, skills: [], tools: [] })
    const renderComposer = vi.fn(props.renderSlot)
    render(<Workspace {...props} renderSlot={renderComposer as unknown as WorkspaceProps['renderSlot']} />)
    await openCard('Rain')
    await screen.findByText('Connected')
    expect(renderComposer).toHaveBeenLastCalledWith('multica.assistant.composer', expect.objectContaining({
      selection: { provider: 'connected', model: 'working', reasoningEffort: 'high' },
    }))
    await act(async () => { store.actions.assistantModel(studioTargetKey(target), { provider: 'other', model: 'chosen' }) })
    expect(renderComposer).toHaveBeenLastCalledWith('multica.assistant.composer', expect.objectContaining({
      selection: { provider: 'other', model: 'chosen' },
    }))
  })

  it('prepares outline requests without sending or replacing unsent text and uses the latest editor draft', async () => {
    const { props, studio, store } = fixture([project()])
    vi.mocked(studio.api.catalog).mockResolvedValue({ backendAvailable: true, enabledRoles: ['planner'], defaultModel: null, skills: [], tools: [] })
    render(<Workspace {...props} />)
    await openCard('Rain')
    await screen.findByText(en.outlineEmptyDialogue)
    expect(screen.getByRole('button', { name: en.outlineImprove })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.outlineCheck })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: en.outlineGenerate }))
    expect(screen.getByRole('textbox', { name: en.assistantMessage })).toHaveProperty('value', en.outlineGeneratePrompt)
    expect(studio.api.start).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: en.outlineGenerate })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: en.assistantMessage }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.outline }), { target: { value: 'An unsaved new ending' } })
    fireEvent.click(screen.getByRole('button', { name: en.outlineImprove }))
    expect(screen.getByRole('textbox', { name: en.assistantMessage })).toHaveProperty('value', en.outlineImprovePrompt)
    fireEvent.change(screen.getByRole('textbox', { name: en.assistantMessage }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.outlineCheck }))
    expect(screen.getByRole('textbox', { name: en.assistantMessage })).toHaveProperty('value', en.outlineCheckPrompt)
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    await screen.findByText(en.assistantFailure)
    const request = vi.mocked(studio.api.start).mock.calls[0]![0]
    expect(request.prompt).toBe(en.outlineCheckPrompt)
    expect(request.input.outline).toBe('An unsaved new ending')
    expect(store.getSnapshot().drafts[id]?.input.outline).toBe('An unsaved new ending')
  })

  it('applies a complete outline to the editor with one explicit action and keeps review separate', async () => {
    const saved = project({ outline: 'Original outline' })
    const { props, studio, api, store } = fixture([saved])
    const target = { kind: 'outline' as const, projectId: id }
    const initial = workspace(target)
    initial.workspace.resolved = { provider: 'configured', model: 'text', reasoningEffort: 'high', skills: [], tools: [] }
    const task: StudioTaskView = {
      id: '00000000-0000-4000-8000-000000000031' as StudioTaskView['id'],
      requestId: '00000000-0000-4000-8000-000000000032' as StudioTaskView['requestId'],
      workspaceId: initial.workspace.id, target, sessionId: initial.workspace.sessionId,
      role: 'planner', roleRevision: 1, provider: 'configured', model: 'text', expectedRevision: 1,
      prompt: 'Improve the ending', status: 'completed', reply: 'Here is an alternative ending.', error: null,
      createdAt: saved.createdAt, finishedAt: saved.updatedAt,
    }
    const proposal: StudioProposal = {
      id: '00000000-0000-4000-8000-000000000033' as StudioProposal['id'],
      taskId: task.id, workspaceId: initial.workspace.id, target, expectedRevision: 1,
      changes: [{ field: 'outline', before: saved.outline, after: 'Proposed ending' }], applied: [], ignored: [], createdAt: saved.createdAt,
    }
    vi.mocked(studio.api.catalog).mockResolvedValue({ backendAvailable: true, enabledRoles: ['planner', 'writer'], defaultModel: null, skills: [], tools: [] })
    vi.mocked(studio.api.open).mockResolvedValue(initial)
    vi.mocked(studio.api.start).mockResolvedValue(task)
    vi.mocked(studio.api.workspace).mockResolvedValue({ ...initial, tasks: [task], proposals: [proposal] })
    render(<Workspace {...props} />)
    await openCard('Rain')
    await screen.findByText(en.outlineEmptyDialogue)
    expect(studio.api.start).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: en.assistantMessage }), { target: { value: task.prompt } })
    fireEvent.click(screen.getByRole('button', { name: en.send }))
    const card = await screen.findByRole('region', { name: en.proposal })
    expect(studio.api.start).toHaveBeenCalledWith(expect.objectContaining({
      modelSelection: { provider: 'configured', model: 'text', reasoningEffort: 'high' },
    }))
    expect(screen.getByRole('textbox', { name: en.outline })).toHaveProperty('value', 'Original outline')
    expect(within(card).getByRole('button', { name: en.outlineApply })).toHaveProperty('disabled', false)
    expect(studio.api.apply).not.toHaveBeenCalled()
    await act(async () => { studio.model.source.update((state) => {
      state.byId[initial.workspace.id]!.view!.lockedFields = ['outline']
    }) })
    expect(within(card).getByRole('button', { name: en.outlineApply })).toHaveProperty('disabled', true)
    await act(async () => { studio.model.source.update((state) => {
      state.byId[initial.workspace.id]!.view!.lockedFields = []
    }) })
    vi.mocked(studio.api.apply).mockResolvedValueOnce({ status: 'conflict', project: saved, creation: null, fields: ['outline'] })
    fireEvent.click(within(card).getByRole('button', { name: en.outlineApply }))
    await screen.findByText(en.proposalConflict)
    expect(screen.getByRole('textbox', { name: en.outline })).toHaveProperty('value', 'Original outline')
    const accepted = project({ revision: 2, outline: 'Proposed ending' })
    vi.mocked(studio.api.apply).mockResolvedValue({ status: 'applied', project: accepted, creation: null, input: { ...emptyInput(), name: saved.name, concept: saved.concept, outline: accepted.outline }, proposal: { ...proposal, applied: ['outline'] } })
    vi.mocked(studio.api.workspace).mockResolvedValue({ ...initial, tasks: [task], proposals: [{ ...proposal, applied: ['outline'] }] })
    fireEvent.click(within(card).getByRole('button', { name: en.outlineApply }))
    await screen.findByDisplayValue('Proposed ending')
    expect(studio.api.apply).toHaveBeenCalledWith(expect.objectContaining({ fields: ['outline'], expectedRevision: 1 }))
    expect(studio.api.submit).not.toHaveBeenCalled()
    expect(studio.api.decide).not.toHaveBeenCalled()
    const review: StudioReview = { id: '00000000-0000-4000-8000-000000000034' as StudioReview['id'], target, projectRevision: 2, status: 'pending', comment: '', createdAt: saved.createdAt, decidedAt: null }
    vi.mocked(studio.api.reviews).mockResolvedValue([review])
    vi.mocked(api.history).mockResolvedValue([saved, accepted])
    // The project service's confirmed mutation updates the catalog independently of the review queue.
    await act(async () => { store.actions.received(accepted); studio.model.source.update((state) => { state.reviews = [review] }) })
    fireEvent.click(screen.getByRole('button', { name: en.review }))
    expect(screen.queryByRole('button', { name: en.approveReview })).toBeNull()
  })

  it('retains role edits until explicit publication and keeps unavailable dependencies visible', async () => {
    const { props, studio, store } = fixture([project()])
    vi.mocked(studio.api.catalog).mockResolvedValue({ backendAvailable: true, enabledRoles: ['planner'], defaultModel: { provider: 'configured', model: 'text' }, skills: [], tools: [] })
    vi.mocked(studio.api.roles).mockResolvedValue([{ ...role, config: { ...role.config, skills: ['removed-skill'] } }])
    render(<Workspace {...props} />)
    await openCard('Rain')
    fireEvent.click(within(screen.getByRole('navigation', { name: en.planning })).getByRole('button', { name: en.agentConfig }))
    const persona = await screen.findByRole('textbox', { name: en.persona })
    expect(screen.getByRole('checkbox', { name: 'removed-skill' })).toHaveProperty('checked', true)
    fireEvent.change(persona, { target: { value: 'Plan a quiet mystery.' } })
    expect(studio.api.publishRole).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.backToWorkspace }))
    fireEvent.click(within(screen.getByRole('navigation', { name: en.planning })).getByRole('button', { name: en.agentConfig }))
    expect(screen.getByRole('textbox', { name: en.persona })).toHaveProperty('value', 'Plan a quiet mystery.')
    vi.mocked(studio.api.publishRole).mockImplementation(async (id, revision, config) => ({
      role: id, revision: revision + 1, config, createdAt: role.createdAt,
    }))
    vi.mocked(studio.api.roles).mockImplementation(async () => [{ ...role, revision: 2, config: { ...role.config, persona: 'Plan a quiet mystery.', skills: ['removed-skill'] } }])
    fireEvent.click(screen.getByRole('button', { name: en.publishRole }))
    await screen.findByText('Role configuration v2')
    expect(store.getSnapshot().roleDrafts.planner).toBeUndefined()
    expect(studio.api.start).not.toHaveBeenCalled()
  })

})
