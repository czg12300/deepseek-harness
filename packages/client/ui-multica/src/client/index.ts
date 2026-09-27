/** Multica browser registration; services remain outside React components. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult, StudioFolderId, ProjectId } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
export type {} from './composer.ts'
import { createMulticaStore, type MulticaDrafts, type ProjectDraft } from './drafts.ts'
import { ProjectModel } from './projects.ts'
import { StudioModel, studioTargetKey } from './studio.ts'
import { Workspace, type WorkspaceInjected } from './Workspace.tsx'
import { MulticaIcon } from './MulticaIcon.tsx'
import { en, NS, zh, type MulticaKey } from './locales.ts'
import { ActorModel, type ActorActions } from './actors.ts'
import { ProjectContentModel, type ProjectContentActions } from './project-content.ts'

export { createMulticaStore } from './drafts.ts'

async function unwrap<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw result.error
  return result.value
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Manual project creation, editing, and version history. */
    multica: MulticaKey
  }
}

/** Services required by this optional project workspace. */
export const inject = ['slots', 'locale', 'remote', 'remote.studioProjects', 'remote.directoryPicker']

/** Register the main workspace and its sidebar-owned navigation button.
 * @param ctx - browser context with generated project operations.
 */
export function apply(ctx: Context): void {
  let selectedFolder: StudioFolderId | undefined
  const buffers = new Map<ProjectId, Promise<void>>()
  const saveBuffer = (id: ProjectId, draft: ProjectDraft): Promise<void> => {
    const previous = buffers.get(id) ?? Promise.resolve()
    // A failed write was reported to its caller; a later edit may retry after reconnecting the disk.
    const next = previous.catch(() => {}).then(() => unwrap(ctx.remote.studioProjects.saveEditorDraft(id, draft.baseRevision, draft.input)))
    buffers.set(id, next)
    return next
  }
  const checkpoint = async (state: MulticaDrafts): Promise<void> => {
    if (state.selected) {
      const draft = state.drafts[state.selected]
      if (draft?.dirty) await saveBuffer(state.selected, draft)
      else await buffers.get(state.selected)
    }
    if (state.creating && state.createRevision !== null) {
      const result = await unwrap(ctx.remote.studioProjects.saveCreationDraft(state.creationId, state.createRevision, state.createInput))
      if (result.status === 'conflict') throw new Error(ctx.locale.bind(NS)('proposalConflict'))
    }
  }
  const model = new ProjectModel({
    folders: () => unwrap(ctx.remote.studioProjects.projectFolders()),
    list: () => unwrap(ctx.remote.studioProjects.list()),
    coverUploadLimit: () => unwrap(ctx.remote.studioProjects.coverUploadLimit()),
    setCover: (id, revision, image) => unwrap(ctx.remote.studioProjects.setCover(id, revision, image)),
    get: id => unwrap(ctx.remote.studioProjects.get(id)),
    create: input => unwrap(ctx.remote.studioProjects.create(input)),
    save: (id, revision, input) => unwrap(ctx.remote.studioProjects.save(id, revision, input)),
    setArchived: (id, revision, archived) => unwrap(ctx.remote.studioProjects.setArchived(id, revision, archived)),
    history: id => unwrap(ctx.remote.studioProjects.history(id)),
  })
  const studio = new StudioModel({
    catalog: () => unwrap(ctx.remote.studioProjects.assistantCatalog()),
    roles: () => unwrap(ctx.remote.studioProjects.roles(selectedFolder)),
    publishRole: (role, revision, config) => unwrap(ctx.remote.studioProjects.publishRole(role, revision, config, selectedFolder)),
    creations: () => unwrap(ctx.remote.studioProjects.creationDrafts()),
    creation: id => unwrap(ctx.remote.studioProjects.creationDraft(id)),
    saveCreation: (id, revision, input) => unwrap(ctx.remote.studioProjects.saveCreationDraft(id, revision, input)),
    open: target => unwrap(ctx.remote.studioProjects.openWorkspace(target)),
    workspace: id => unwrap(ctx.remote.studioProjects.workspace(id)),
    start: request => unwrap(ctx.remote.studioProjects.startAssistant(request)),
    wait: id => unwrap(ctx.remote.studioProjects.waitTask(id)),
    cancel: id => unwrap(ctx.remote.studioProjects.cancelAssistant(id)),
    apply: request => unwrap(ctx.remote.studioProjects.applyProposal(request)),
    ignore: (id, fields) => unwrap(ctx.remote.studioProjects.ignoreProposal(id, fields)),
    locks: (target, fields) => unwrap(ctx.remote.studioProjects.setFieldLocks(target, fields)),
    reviews: () => unwrap(ctx.remote.studioProjects.reviewQueue()),
    submit: (target, revision) => unwrap(ctx.remote.studioProjects.submitReview(target, revision)),
    decide: (id, decision, comment) => unwrap(ctx.remote.studioProjects.decideReview(id, decision, comment)),
  })
  const actorModel = new ActorModel({
    libraries: () => unwrap(ctx.remote.studioProjects.actorLibraries()),
    create: name => unwrap(ctx.remote.studioProjects.createActorLibrary(name)),
    list: (id, search, period, region, offset) => unwrap(ctx.remote.studioProjects.libraryActors(id, search, period, region, offset)),
    actor: (libraryId, actorId) => unwrap(ctx.remote.studioProjects.libraryActor(libraryId, actorId)),
    save: (libraryId, actorId, input) => unwrap(ctx.remote.studioProjects.saveLibraryActor(libraryId, actorId, input)),
    export: id => unwrap(ctx.remote.studioProjects.exportActorLibrary(id)),
    import: (dataUrl, target) => unwrap(ctx.remote.studioProjects.importActorLibrary(dataUrl, target)),
  })
  const actorActions: ActorActions = {
    load: () => actorModel.load(), select: id => actorModel.select(id),
    filter: (search, period, region) => actorModel.filter(search, period, region),
    more: () => actorModel.more(), create: name => actorModel.create(name),
    actor: id => actorModel.actor(id), save: (id, input) => actorModel.save(id, input),
    export: () => actorModel.export(), import: (dataUrl, merge) => actorModel.import(dataUrl, merge),
  }
  const contentModel = new ProjectContentModel({
    documents: id => unwrap(ctx.remote.studioProjects.scriptDocuments(id)),
    saveDocument: (id, documentId, revision, markdown) =>
      unwrap(ctx.remote.studioProjects.saveScriptDocument(id, documentId, revision, markdown)),
    complete: id => unwrap(ctx.remote.studioProjects.scriptComplete(id)),
    confirm: (id, revision) => unwrap(ctx.remote.studioProjects.completeScript(id, revision)),
    units: id => unwrap(ctx.remote.studioProjects.productionUnits(id)),
    createUnit: (id, kind, episodeId, title) => unwrap(ctx.remote.studioProjects.createProductionUnit(id, kind, episodeId, title)),
    nodes: (id, unitId) => unwrap(ctx.remote.studioProjects.canvasNodes(id, unitId)),
    addNode: (id, unitId, kind, label, x, y, assetId, text) =>
      unwrap(ctx.remote.studioProjects.addCanvasNode(id, unitId, kind, label, x, y, assetId, text)),
    moveNode: (id, unitId, nodeId, revision, x, y) => unwrap(ctx.remote.studioProjects.moveCanvasNode(id, unitId, nodeId, revision, x, y)),
    assets: id => unwrap(ctx.remote.studioProjects.projectMedia(id)),
    importMedia: (id, unitId, name, dataUrl) => unwrap(ctx.remote.studioProjects.importProjectMedia(id, unitId, name, dataUrl)),
    mediaData: (id, assetId) => unwrap(ctx.remote.studioProjects.projectMediaData(id, assetId)),
  })
  const store = createMulticaStore()
  const closingProject = async (operation: () => Promise<void>): Promise<void> => {
    model.source.update((d) => { d.lifecycleBusy = true })
    try { await operation() } finally { model.source.update((d) => { d.lifecycleBusy = false }) }
  }
  let unsaved = false
  ctx.effect(() => () => {
    studio.dispose()
    model.dispose()
    actorModel.dispose()
    contentModel.dispose()
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  ctx.effect(() => {
    const warn = (event: BeforeUnloadEvent): void => {
      if (unsaved) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  })
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: 'multica',
        locale: NS,
        children: { 'multica.assistant.composer': { kind: 'single', scope: 'root' } },
        store,
        inject: (actions): WorkspaceInjected => ({
          portable: {
            pick: () => unwrap(ctx.remote.directoryPicker.pick()),
            reveal: id => unwrap(ctx.remote.studioProjects.revealFolder(id)),
            select: (id) => {
              if (selectedFolder === id) return
              selectedFolder = id
              void studio.catalog()
            },
            open: async (path) => {
              const folder = await unwrap(ctx.remote.studioProjects.openFolder(path))
              await model.list()
              if (folder.projectId) actions.select(folder.projectId)
              else if (folder.creationId) await studio.resumeCreation(folder.creationId, (draft) =>{  actions.restoreCreation(draft) })
            },
            prepare: async (path, id, input) => {
              await unwrap(ctx.remote.studioProjects.prepareFolder(path, id, input))
              const draft = await unwrap(ctx.remote.studioProjects.creationDraft(id))
              if (draft) actions.creationSaved(draft, input)
              await model.list()
              await studio.creations()
            },
            close: (id, state) => closingProject(async () => {
              await checkpoint(state)
              await unwrap(ctx.remote.studioProjects.closeFolder(id))
              model.source.update((d) => { d.closedFolder = id })
              actions.closeProject(state.selected)
              await model.list()
              await studio.creations()
            }),
            forget: async (id) => {
              await unwrap(ctx.remote.studioProjects.forgetFolder(id))
              await model.list()
            },
            backup: (id, path, state) => closingProject(async () => {
              await checkpoint(state)
              await unwrap(ctx.remote.studioProjects.backupFolder(id, path))
              model.source.update((d) => { d.closedFolder = id })
              actions.closeProject(state.selected)
              await model.list()
            }),
            migrate: async (id, path) => {
              await unwrap(ctx.remote.studioProjects.migrateProject(id, path))
              await model.list()
              await model.open(id, actions)
            },
            autosave: saveBuffer,
          },
          hooks: { projects: model.source, studio: studio.source, actors: actorModel.source, content: contentModel.source },
          actorActions,
          contentActions: {
            load: id => contentModel.load(id),
            loadNodes: (id, unitId) => contentModel.loadNodes(id, unitId),
            saveDocument: async (id, documentId, revision, markdown) => {
              const saved = await contentModel.saveDocument(id, documentId, revision, markdown)
              await model.open(id, actions)
              return saved
            },
            confirm: (id, revision) => contentModel.confirm(id, revision),
            createUnit: (id, kind, episodeId, title) => contentModel.createUnit(id, kind, episodeId, title),
            addNode: (id, unitId, kind, label, x, y, assetId, text) => contentModel.addNode(id, unitId, kind, label, x, y, assetId, text),
            moveNode: (id, unitId, nodeId, revision, x, y) => contentModel.moveNode(id, unitId, nodeId, revision, x, y),
            importMedia: (id, unitId, name, dataUrl) => contentModel.importMedia(id, unitId, name, dataUrl),
            mediaData: (id, assetId) => contentModel.mediaData(id, assetId),
          } satisfies ProjectContentActions,
          studioActions: {
            catalog: () => studio.catalog(),
            creations: () => studio.creations(),
            saveCreation: async (id, revision, input) => {
              const saved = await studio.saveCreation(id, revision, input)
              if (saved) actions.creationSaved(saved, input)
            },
            resumeCreation: id =>
              studio.resumeCreation(id, (draft) => {
                actions.restoreCreation(draft)
              }),
            open: target => studio.open(target),
            refresh: id => studio.refresh(id),
            selectVersion: (target, id) => studio.selectVersion(target, id),
            send: async (id, revision, input, prompt, modelSelection) => {
              const view = studio.source.getSnapshot().byId[id]?.view
              if (!view) return
              const key = studioTargetKey(view.workspace.target)
              if (view.workspace.target.kind === 'creation') {
                const saved = await studio.saveCreation(view.workspace.target.draftId, revision, input)
                if (!saved) return
                actions.creationSaved(saved, input)
                revision = saved.revision
                input = saved.input
              }
              await studio.send(id, revision, input, prompt, () => {
                actions.promptSubmitted(key, prompt)
              }, modelSelection)
            },
            retry: (id) => {
              const view = studio.source.getSnapshot().byId[id]?.view
              const request = studio.source.getSnapshot().byId[id]?.retry
              return studio.retry(id, () => {
                if (view && request) actions.promptSubmitted(studioTargetKey(view.workspace.target), request.prompt)
              })
            },
            abandon: (id) => {
              studio.abandon(id)
            },
            cancel: task => studio.cancel(task),
            apply: (id, target, request) =>
              studio.apply(id, request, (result) => {
                if (result.project) {
                  const observed = model.adopt(result.project)
                  if (observed.revision > result.project.revision) {
                    actions.received(observed)
                    return
                  }
                }
                if (result.status === 'applied') {
                  actions.proposalApplied(target, request.input, result.input, result.project, request.fields, result.creation)
                  if (result.project) void contentModel.load(result.project.id)
                  if (target.kind === 'creation') {
                    unsaved = true
                    void studio.creations()
                  }
                } else if (result.project) actions.received(result.project)
              }),
            ignore: (id, proposal, fields) => studio.ignore(id, proposal, fields),
            locks: (view, fields) => studio.locks(view, fields),
            publish: (role, config, edit) =>
              studio.publish(role, config, (published) => {
                actions.rolePublished(published, edit)
              }),
            reviews: () => studio.reviews(),
            submitReview: (target, revision) => studio.submitReview(target, revision),
            decide: (review, decision, comment) => studio.decide(review, decision, comment),
          },
          load: () => model.list(),
          setCover: (id, revision, image) => model.setCover(id, revision, image),
          open: async (id) => {
            const folder = model.source.getSnapshot().folders?.find(folder => folder.projectId === id)
            if (folder && folder.state !== 'open') {
              try { await unwrap(ctx.remote.studioProjects.openFolder(folder.path)) } catch {
                await model.open(id, actions)
                return
              }
            }
            await model.open(id, actions)
            if (model.source.getSnapshot().byId[id]?.error) return
            try {
              const buffer = await unwrap(ctx.remote.studioProjects.editorDraft(id))
              if (buffer) actions.restoreBuffer(id, buffer)
              await model.list()
            } catch {
              model.source.update((d) => { const query = d.byId[id]; if (query) query.error = true })
            }
          },
          create: async (input, edit, creationId, revision) => {
            await model.create(
              input,
              edit,
              actions,
              async () => {
                const folder = model.source.getSnapshot().folders?.find(item => item.creationId === creationId && item.state === 'open')
                if (!folder) throw new Error(ctx.locale.bind(NS)('chooseBeforeCreate'))
                const saved = revision === null ? await unwrap(ctx.remote.studioProjects.creationDraft(creationId)) : null
                const expected = revision ?? saved?.revision
                if (expected === undefined) throw new Error(ctx.locale.bind(NS)('chooseBeforeCreate'))
                return unwrap(ctx.remote.studioProjects.createFromDraft(creationId, expected, input))
              },
            )
            await studio.creations()
          },
          save: (id, draft, archived) => model.save(id, draft, actions, archived),
          history: id => model.history(id),
          reportUnsaved: (value) => {
            unsaved = value
          },
        }),
      },
      Workspace,
    ),
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'multica',
        order: 0,
        label: () => ctx.locale.bind(NS)('nav'),
      },
      MulticaIcon,
    ),
  )
}
