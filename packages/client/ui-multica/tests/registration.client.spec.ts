// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyHost } from '../src/index.ts'
import { en, zh, type MulticaKey } from '../src/client/locales.ts'
import { createMulticaStore, emptyInput } from '../src/client/drafts.ts'
import type { WorkspaceInjected } from '../src/client/Workspace.tsx'
import type { Project, ProjectId, RemoteResult, StudioFolder, StudioCreationDraft } from '@deepseek-ai/dsh-api-remotes/client'

function Empty({ renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>) {
  void renderSlot
  return null
}

describe('Multica slot lifecycle', () => {
  it('waits for declarations, contributes the 漫剧 entry, and removes both entries on disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    let dictionaries = false
    ctx.provide('locale', {
      register: () => {
        dictionaries = true
        return () => {
          dictionaries = false
        }
      },
      bind: () => () => zh.nav,
    } as never)
    try {
      // The registry and locale are explicit fixture dependencies; no Remote method runs during registration.
      const feature = ctx.plugin({ inject: ['slots', 'locale'], apply })
      await feature.await()
      expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.studioProjects', 'remote.directoryPicker'])
      expect(ctx.slots.entries('main')).toEqual([])
      const declare = (): (() => void) =>
        ctx.slots.register(
          {
            name: 'root',
            children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
          },
          Empty,
        )
      const undeclare = declare()
      expect(ctx.slots.entries('main').map(e => e.options.key)).toEqual(['multica'])
      const panel = ctx.slots.entries('sidebar.panellist')[0]
      expect(panel?.options.id).toBe('multica')
      const label = panel?.options.label
      expect(typeof label === 'function' ? label() : label).toBe('漫剧')
      expect(dictionaries).toBe(true)
      undeclare()
      expect(ctx.slots.entries('main')).toEqual([])
      const redeclare = declare()
      expect(ctx.slots.entries('sidebar.panellist')).toHaveLength(1)
      await feature.dispose()
      expect(ctx.slots.entries('main')).toEqual([])
      expect(ctx.slots.entries('sidebar.panellist')).toEqual([])
      expect(dictionaries).toBe(false)
      redeclare()
      expect(applyHost).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('binds locale and Remote callbacks, unwraps failures, and warns only for unsaved work', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    let language: 'en' | 'zh' = 'zh'
    ctx.provide('locale', {
      register: () => () => {},
      bind: () => (key: MulticaKey) => (language === 'zh' ? zh : en)[key],
    } as never)
    const id = '00000000-0000-4000-8000-000000000001' as ProjectId
    const project: Project = {
      ...emptyInput(),
      id,
      name: 'Story',
      revision: 1,
      archived: false,
      createdAt: '2026-09-10T00:00:00.000Z',
      updatedAt: '2026-09-10T00:00:00.000Z',
    }
    const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
    let folders: StudioFolder[] = []
    let creation: StudioCreationDraft | null = null
    const api = {
      projectFolders: vi.fn(async () => success(folders)),
      forgetFolder: vi.fn(async () => { folders = []; return success(undefined) }),
      saveEditorDraft: vi.fn(async () => ({ ok: false as const, error: { code: 'internal', message: 'ENOENT: project.sqlite' } })),
      closeFolder: vi.fn(async () => ({ ok: false as const, error: { code: 'internal', message: 'ENOENT: project.sqlite' } })),
      creationDraft: vi.fn(async () => success(creation)),
      createFromDraft: vi.fn(async () => success(project)),
      editorDraft: vi.fn(async () => success(null)),
      coverUploadLimit: vi.fn(async () => success(1048576)),
      setCover: vi.fn(async (_id: ProjectId, revision: number, image: string | null) => success({ revision: revision + 1, image })),
      list: vi.fn(async () => success([{ ...project, cover: { revision: 0, image: null }, episodeCount: 0 }])),
      get: vi.fn(async () => success(project)),
      create: vi.fn(async () => success(project)),
      save: vi.fn(async () => success({ status: 'saved' as const, project: { ...project, revision: 2 } })),
      setArchived: vi.fn(async () => success({ status: 'saved' as const, project: { ...project, revision: 3, archived: true } })),
      history: vi.fn(async () => success([project])),
      creationDrafts: vi.fn(async () => success([])),
    }
    const picker = { pick: vi.fn(async () => success('/projects/picked')) }
    ctx.provide('remote', { studioProjects: api, directoryPicker: picker } as never)
    ctx.provide('remote.studioProjects', api as never)
    ctx.provide('remote.directoryPicker', picker as never)
    const undeclare = ctx.slots.register(
      {
        name: 'root',
        children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
      },
      Empty,
    )
    try {
      const feature = ctx.plugin({ inject, apply })
      await feature.await()
      const entry = ctx.slots.entries('main')[0]!
      const store = createMulticaStore().create()
      const injectFace = entry.inject as unknown as (actions: typeof store.actions) => WorkspaceInjected
      const face = injectFace(store.actions)
      const label = ctx.slots.entries('sidebar.panellist')[0]!.options.label
      expect(typeof label === 'function' && label()).toBe('漫剧')
      language = 'en'
      expect(typeof label === 'function' && label()).toBe('Comics')
      expect(await face.portable!.pick()).toBe('/projects/picked')
      expect(picker.pick).toHaveBeenCalledOnce()
      await face.load()
      await face.open(id)
      expect(face.hooks.projects.getSnapshot().list).toHaveLength(1)
      store.actions.startCreate()
      await face.create({ ...emptyInput(), name: 'Created' }, 0, store.getSnapshot().creationId, null)
      expect(api.create).not.toHaveBeenCalled()
      expect(api.createFromDraft).not.toHaveBeenCalled()
      creation = { id: store.getSnapshot().creationId, revision: 1, input: { ...emptyInput(), name: 'Created' }, updatedAt: project.updatedAt }
      folders = [{ id: '00000000-0000-4000-8000-000000000003' as StudioFolder['id'], path: '/projects/story',
        creationId: creation.id, projectId: null, name: 'Created', state: 'open' }]
      await face.load()
      await face.create(creation.input, 0, creation.id, null)
      expect(api.createFromDraft).toHaveBeenCalledWith(creation.id, 1, expect.objectContaining({ name: 'Created' }))
      store.actions.edit(id, { outline: 'Submitted' })
      await face.save(id, store.getSnapshot().drafts[id]!)
      expect(api.save).toHaveBeenCalledWith(id, 1, expect.objectContaining({ outline: 'Submitted' }))
      await face.save(id, store.getSnapshot().drafts[id]!, true)
      expect(api.setArchived).toHaveBeenCalledWith(id, 2, true)
      await face.history(id)
      expect(face.hooks.projects.getSnapshot().byId[id]?.history).toHaveLength(1)
      vi.mocked(api.get).mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'Unavailable' } } as never)
      await face.open(id)
      expect(face.hooks.projects.getSnapshot().byId[id]?.error).toBe(true)
      const folderId = folders[0]!.id
      store.actions.edit(id, { outline: 'Keep this unsaved draft' })
      const retained = store.getSnapshot().drafts[id]!
      await expect(face.portable!.autosave(id, retained)).rejects.toThrow('ENOENT')
      await face.portable!.forget(folderId)
      expect(api.forgetFolder).toHaveBeenCalledWith(folderId)
      expect(api.closeFolder).not.toHaveBeenCalled()
      expect(api.saveEditorDraft).toHaveBeenCalledOnce()
      expect(store.getSnapshot().drafts[id]).toEqual(retained)
      expect(face.hooks.projects.getSnapshot().folders).toEqual([])
      const clean = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(clean)
      expect(clean.defaultPrevented).toBe(false)
      face.reportUnsaved(true)
      const dirty = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(dirty)
      expect(dirty.defaultPrevented).toBe(true)
      await feature.dispose()
      const disposed = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(disposed)
      expect(disposed.defaultPrevented).toBe(false)
    } finally {
      undeclare()
      await ctx.fiber.dispose()
    }
  })
})
