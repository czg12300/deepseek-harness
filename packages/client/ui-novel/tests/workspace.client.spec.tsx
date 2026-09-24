// @vitest-environment jsdom
import { createElement, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {
  NovelDocument,
  NovelDocumentId,
  NovelId,
  NovelProject,
  NovelProposalId,
  NovelTaskId,
} from '@deepseek-ai/dsh-novel-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createNovelViewStore } from '../src/client/stores.ts'
import { NovelModel } from '../src/client/model.ts'
import { Workspace } from '../src/client/Workspace.tsx'
import type { NovelProps } from '../src/client/contract.ts'
import { en, type NovelKey } from '../src/client/locales.ts'

const novelId = '00000000-0000-4000-8000-000000000001' as NovelId
const documentId = '00000000-0000-4000-8000-000000000002' as NovelDocumentId
const project: NovelProject = {
  id: novelId,
  title: 'The letter',
  synopsis: 'A letter arrives at night.',
  directory: '/novels/the-letter',
  revision: 1,
  chapterCount: 1,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
}
const document: NovelDocument = {
  id: documentId,
  novelId,
  kind: 'chapter',
  title: 'The quay',
  position: 0,
  revision: 1,
  content: 'Original ending.',
  updatedAt: project.updatedAt,
}
const models: NovelModel[] = []
afterEach(() => {
  cleanup()
  for (const model of models.splice(0)) model.dispose()
})

function selector<T>(source: ObservableSnapshot<T>) {
  return <S,>(select: (value: T) => S): S =>
    select(
      useSyncExternalStore(
        listener => source.subscribe(listener),
        () => source.getSnapshot(),
      ),
    )
}
function fixture() {
  const model = new NovelModel()
  models.push(model)
  model.list([project])
  model.documents(novelId, [document])
  model.document(document)
  model.availability(true)
  const store = createNovelViewStore().create()
  const props = {
    useStore: selector(store),
    useNovelData: selector(model.source),
    actions: store.actions,
    t: (key: NovelKey, params: Record<string, unknown> = {}) =>
      en[key].replace(/\{(\w+)\}/g, (_, name: string) => String(params[name])),
    refresh: vi.fn(async () => {}),
    open: vi.fn(async (id: NovelId) => {
      store.actions.open(id)
    }),
    create: vi.fn(async () => {}),
    importProject: vi.fn(async () => {}),
    updateInfo: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    read: vi.fn(async () => {}),
    createDocument: vi.fn(async () => {}),
    save: vi.fn(async () => document),
    reorder: vi.fn(async () => {}),
    history: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    apply: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    pickDirectory: vi.fn(async () => '/novels'),
    listDirectory: vi.fn(async () => ({
      path: '/novels',
      home: '/novels',
      crumbs: [{ path: '/novels', name: 'novels', hidden: false }],
      entries: [],
      truncated: false,
    })),
    useNovelAutoSave: (select: (value: number | null) => unknown) => select(0),
    reportUnsaved: vi.fn(),
    // This root panel does not consume the other framework-owned standard seats.
  } as unknown as NovelProps
  return { props, model, store }
}

describe('novel workspace presentation', () => {
  it('moves chapters within their kind while preserving other document positions', async () => {
    const { props, store, model } = fixture()
    const outline = {
      ...document,
      id: '00000000-0000-4000-8000-000000000004' as NovelDocumentId,
      kind: 'outline' as const,
      position: 1,
    }
    const next = {
      ...document,
      id: '00000000-0000-4000-8000-000000000005' as NovelDocumentId,
      title: 'Next chapter',
      position: 2,
    }
    model.documents(novelId, [document, outline, next])
    store.actions.open(novelId)
    store.actions.document(documentId)
    store.actions.received(document)
    render(createElement(Workspace, props))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move down' }))
    })
    expect(props.reorder).toHaveBeenCalledWith(novelId, [next.id, outline.id, documentId])
  })

  it('keeps a typed folder path when the initial directory listing finishes later', async () => {
    const { props, store } = fixture()
    let resolveListing!: (value: Awaited<ReturnType<NovelProps['listDirectory']>>) => void
    props.listDirectory = () =>
      new Promise((resolve) => {
        resolveListing = resolve
      })
    store.actions.create()
    render(createElement(Workspace, props))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }))
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Folder path' }), { target: { value: '/selected/books' } })
    await act(async () => {
      resolveListing({ path: '/home', home: '/home', crumbs: [], entries: [], truncated: false })
    })
    expect(screen.getByDisplayValue('/selected/books')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose this folder' }))
    })
    expect(store.getSnapshot().creation.parentDirectory).toBe('/selected/books')
  })

  it('requires only title, synopsis and folder before creation', async () => {
    const { props, store } = fixture()
    store.actions.create()
    render(createElement(Workspace, props))
    expect(screen.getAllByRole('textbox')).toHaveLength(2)
    const create = screen.getByRole('button', { name: 'Create novel' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New book' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Synopsis' }), { target: { value: 'A new story.' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose this folder' }))
    })
    expect(create.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(create)
    })
    expect(props.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New book', synopsis: 'A new story.', parentDirectory: '/novels' }),
    )
  })

  it('binds chat requests to the visible saved document and keeps the manuscript editable', async () => {
    const { props, store } = fixture()
    store.actions.open(novelId)
    store.actions.document(documentId)
    store.actions.received(document)
    render(createElement(Workspace, props))
    fireEvent.change(screen.getByRole('textbox', { name: 'Document text' }), { target: { value: 'Human draft' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Tell the Agent how to change this document…' }), {
      target: { value: 'Improve the ending' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    })
    expect(props.send).toHaveBeenCalledWith(
      novelId,
      documentId,
      expect.objectContaining({ content: 'Human draft', revision: 1, dirty: true }),
      'Improve the ending',
      null,
    )
  })

  it('shows immutable before/after text and refuses application after a manual revision', async () => {
    const { props, store, model } = fixture()
    store.actions.open(novelId)
    store.actions.document(documentId)
    store.actions.received(document)
    const proposalId = '00000000-0000-4000-8000-000000000003' as NovelProposalId
    await model.conversation(documentId, async () => ({
      sessionId: 'session' as SessionId,
      tasks: [],
      proposals: [
        {
          id: proposalId,
          taskId: 'task' as NovelTaskId,
          documentId,
          baseRevision: 1,
          status: 'pending',
          appliedRevision: null,
          changes: [{ start: 0, end: document.content.length, before: document.content, after: 'Suggested ending.' }],
        },
      ],
    }))
    render(createElement(Workspace, props))
    expect(screen.getByText('Suggested ending.')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    })
    expect(props.apply).toHaveBeenCalledWith(novelId, documentId, proposalId, 1)
    act(() => {
      store.actions.received({ ...document, revision: 2, content: 'Newer human revision' }, true)
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply changes' }).disabled).toBe(true)
    expect(screen.getByText(en.stale)).toBeTruthy()
  })
})

describe('draft ownership', () => {
  it('retains edits made while an earlier save is in flight', () => {
    const store = createNovelViewStore().create()
    store.actions.received(document)
    store.actions.change(documentId, 'content', 'First edit')
    const captured = store.getSnapshot().drafts[documentId]!
    store.actions.change(documentId, 'content', 'Second edit')
    store.actions.saved({ ...document, revision: 2, content: 'First edit' }, captured.edit)
    expect(store.getSnapshot().drafts[documentId]).toMatchObject({ content: 'Second edit', revision: 2, dirty: true })
  })
  it('does not replace a dirty local draft with a newly observed saved version', () => {
    const store = createNovelViewStore().create()
    store.actions.received(document)
    store.actions.change(documentId, 'content', 'Local draft')
    store.actions.received({ ...document, revision: 2, content: 'Other window' })
    expect(store.getSnapshot().drafts[documentId]).toMatchObject({
      content: 'Local draft',
      revision: 1,
      dirty: true,
      conflict: true,
    })
  })
})
