/** Multica browser registration; services remain outside React components. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createMulticaStore } from './drafts.ts'
import { ProjectModel } from './projects.ts'
import { StudioModel, studioTargetKey } from './studio.ts'
import { Workspace, type WorkspaceInjected } from './Workspace.tsx'
import { MulticaIcon } from './MulticaIcon.tsx'
import { en, NS, zh, type MulticaKey } from './locales.ts'

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
export const inject = ['slots', 'locale', 'remote', 'remote.studioProjects']

/** Register the main workspace and its sidebar-owned navigation button.
 * @param ctx - browser context with generated project operations.
 */
export function apply(ctx: Context): void {
  const model = new ProjectModel({
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
    roles: () => unwrap(ctx.remote.studioProjects.roles()),
    publishRole: (role, revision, config) => unwrap(ctx.remote.studioProjects.publishRole(role, revision, config)),
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
  const store = createMulticaStore()
  let unsaved = false
  ctx.effect(() => () => {
    studio.dispose()
    model.dispose()
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
        store,
        inject: (actions): WorkspaceInjected => ({
          hooks: { projects: model.source, studio: studio.source },
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
            send: async (id, revision, input, prompt) => {
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
              })
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
          open: id => model.open(id, actions),
          create: async (input, edit, creationId, revision) => {
            await model.create(
              input,
              edit,
              actions,
              revision === null ? undefined : () => unwrap(ctx.remote.studioProjects.createFromDraft(creationId, revision, input)),
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
