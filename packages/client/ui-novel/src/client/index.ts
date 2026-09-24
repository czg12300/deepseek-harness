/** Novel page registration and Remote orchestration using existing shell and locale services. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { NovelId, NovelDocumentId, NovelRequestId } from '@deepseek-ai/dsh-novel-core/types'
import { createNovelViewStore } from './stores.ts'
import { NovelModel } from './model.ts'
import { Workspace } from './Workspace.tsx'
import { NovelIcon } from './NovelIcon.tsx'
import { en, zh, NS, type NovelKey } from './locales.ts'
import type { NovelInjected } from './contract.ts'

export { createNovelViewStore } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Novel management, editor and assistant copy. */
    novel: NovelKey
  }
}

/** Services consumed by the main page's apply closure. */
export const inject = ['slots', 'locale', 'remote', 'remote.novels', 'remote.directoryPicker', 'settingsScope']

async function unwrap<T>(operation: Promise<RemoteResult<T>>): Promise<T> {
  const result = await operation
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Register the novel page in the existing application shell.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const model = new NovelModel()
  const settings = ctx.settingsScope.bind<{ autoSaveMs: number }>({ namespace: 'ui-novel' })
  const timing: HostObservable<number | null> = {
    getSnapshot: () => settings.getSnapshot().value?.autoSaveMs ?? null,
    subscribe: listener => settings.subscribe(listener),
  }
  const store = createNovelViewStore()
  const api = ctx.remote.novels
  const requestId = () => randomUUID() as NovelRequestId
  let unsaved = false
  ctx.effect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (unsaved) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  })
  ctx.effect(() => () => {
    model.dispose()
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const refresh = async (): Promise<void> => {
    await model.request('catalog', async () => {
      model.list(await unwrap(api.list()))
      model.availability(await unwrap(api.assistantAvailable()))
    })
  }
  const documents = async (id: NovelId): Promise<void> => {
    model.documents(id, await unwrap(api.documents(id)))
    model.project(await unwrap(api.get(id)))
  }
  const conversation = (id: NovelId, documentId: NovelDocumentId) =>
    model.conversation(documentId, () => unwrap(api.conversation(id, documentId)))
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: 'novel',
        locale: NS,
        store,
        inject: (actions): Omit<NovelInjected, 'useNovelData' | 'useNovelAutoSave'> & { hooks: { novelData: typeof model.source; novelAutoSave: typeof timing } } => {
          const save: NovelInjected['save'] = async (id, documentId, draft) =>
            model.request(`save:${documentId}`, async () => {
              const result = await unwrap(
                api.saveDocument(id, documentId, draft.revision, draft.title, draft.content, requestId()),
              )
              model.document(result.document)
              if (result.status === 'conflict') {
                actions.conflict(documentId)
                return undefined
              }
              actions.saved(result.document, draft.edit)
              await documents(id)
              return result.document
            })
          return {
            hooks: { novelData: model.source, novelAutoSave: timing },
            refresh,
            reportUnsaved: (value) => {
              unsaved = value
            },
            open: async (id) => {
              actions.open(id)
              await model.request(`project:${id}`, () => documents(id))
            },
            create: async (input) => {
              await model.request('create', async () => {
                const project = await unwrap(api.create(input))
                model.project(project)
                actions.createdProject(project.id, input.requestId)
                await documents(project.id)
              })
            },
            importProject: async (path) => {
              await model.request('import', async () => {
                const project = await unwrap(api.importProject(path))
                model.project(project)
                actions.open(project.id)
                await documents(project.id)
              })
            },
            updateInfo: async (id, revision, info) => {
              await model.request(`info:${id}`, async () => {
                model.project(await unwrap(api.updateInfo(id, revision, info)))
                actions.list()
              })
            },
            remove: async (id) => {
              await model.request(`remove:${id}`, async () => {
                await unwrap(api.removeRegistration(id))
                await refresh()
              })
            },
            read: async (id, documentId) => {
              actions.document(documentId)
              await model.request(`read:${documentId}`, async () => {
                const document = await unwrap(api.readDocument(id, documentId))
                model.document(document)
                actions.received(document)
                await conversation(id, documentId)
                const running = model.source
                  .getSnapshot()
                  .conversations[documentId]?.tasks.find(task => task.status === 'running')
                if (running)
                  void model.request(`follow:${running.id}`, async () => {
                    await unwrap(api.waitTask(id, running.id))
                    await conversation(id, documentId)
                  })
              })
            },
            createDocument: async (id, kind, title) => {
              await model.request(`create-document:${id}`, async () => {
                const document = await unwrap(api.createDocument(id, kind, title, requestId()))
                model.document(document)
                actions.received(document)
                actions.createdDocument(id, document.id)
                await documents(id)
                await conversation(id, document.id)
              })
            },
            save,
            reorder: async (id, ids) => {
              await model.request(`order:${id}`, async () => {
                model.documents(id, await unwrap(api.reorder(id, ids)))
              })
            },
            history: async (id, documentId) => {
              actions.history(true)
              await model.request(`history:${documentId}`, async () => {
                model.history(documentId, await unwrap(api.history(id, documentId)))
              })
            },
            restore: async (id, documentId, expected, revision) => {
              await model.request(`save:${documentId}`, async () => {
                const result = await unwrap(api.restore(id, documentId, expected, revision, requestId()))
                model.document(result.document)
                if (result.status === 'conflict') actions.conflict(documentId)
                else actions.received(result.document, true)
                await documents(id)
                actions.history(false)
              })
            },
            send: async (id, documentId, draft, prompt, selection) => {
              await model.request(`send:${documentId}`, async () => {
                const saved = draft.dirty
                  ? await save(id, documentId, draft)
                  : model.source.getSnapshot().content[documentId]
                if (!saved) return
                const task = await unwrap(
                  api.send({
                    novelId: id,
                    documentId,
                    expectedRevision: saved.revision,
                    prompt,
                    selection,
                    requestId: requestId(),
                  }),
                )
                actions.submitted(documentId, prompt)
                await conversation(id, documentId)
                await unwrap(api.waitTask(id, task.id))
                await conversation(id, documentId)
              })
            },
            cancel: async (id, taskId) => {
              await model.request(`cancel:${taskId}`, async () => {
                const task = await unwrap(api.cancelTask(id, taskId))
                await conversation(id, task.documentId)
              })
            },
            apply: async (id, documentId, proposalId, revision) => {
              await model.request(`save:${documentId}`, async () => {
                const result = await unwrap(api.applyProposal(id, proposalId, revision, requestId()))
                model.document(result.document)
                if (result.status === 'conflict') actions.conflict(documentId)
                else actions.received(result.document, true)
                await conversation(id, documentId)
                await documents(id)
              })
            },
            discard: async (id, documentId, proposalId) => {
              await model.request(`discard:${proposalId}`, async () => {
                await unwrap(api.discardProposal(id, proposalId))
                await conversation(id, documentId)
              })
            },
            pickDirectory: () => unwrap(ctx.remote.directoryPicker.pick()),
            listDirectory: path => unwrap(ctx.remote.directoryPicker.list(path)),
          }
        },
      },
      Workspace,
    ),
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: 'novel', order: 1, label: () => ctx.locale.bind(NS)('nav') },
      NovelIcon,
    ),
  )
}
