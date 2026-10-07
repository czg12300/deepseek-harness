/** Multica main entry receives all live facts through framework props. */
import { useEffect, useId } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ProjectId, ProjectInput, StudioCreationId } from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, ProjectDraft } from './drafts.ts'
import { validInput } from './drafts.ts'
import type { ProjectQueries } from './projects.ts'
import { ProjectFields } from './ProjectFields.tsx'
import { Home } from './Home.tsx'
import { RoleSettings } from './RoleSettings.tsx'
import { ReviewCenter } from './ReviewCenter.tsx'
import type { StudioActions, StudioState } from './studio.ts'
import { ProjectEditor } from './ProjectEditor.tsx'
import css from './Workspace.module.css'
import { ProjectLocation, type PortableProjectActions } from './ProjectLocation.tsx'
import { ActorLibraryPage } from './ActorLibraryPage.tsx'
import type { ActorActions, ActorState } from './actors.ts'
import type { ProjectContentActions, ProjectContentState } from './project-content.ts'
import { ProjectWorkspaceV2 } from './ProjectWorkspaceV2.tsx'

/** Callback and observable inputs captured at plugin registration. */
export interface WorkspaceInjected {
  portable?: PortableProjectActions
  hooks: {
    projects: ObservableSnapshot<ProjectQueries>
    studio: ObservableSnapshot<StudioState>
    actors: ObservableSnapshot<ActorState>
    content: ObservableSnapshot<ProjectContentState>
  }
  actorActions: ActorActions
  contentActions: ProjectContentActions
  studioActions: StudioActions
  setCover: (id: ProjectId, revision: number, image: string | null) => Promise<void>
  load: () => Promise<void>
  open: (id: ProjectId) => Promise<void>
  create: (input: ProjectInput, edit: number, creationId: StudioCreationId, revision: number | null) => Promise<void>
  save: (id: ProjectId, draft: ProjectDraft, archived?: boolean) => Promise<boolean>
  history: (id: ProjectId) => Promise<void>
  reportUnsaved: (value: boolean) => void
}

/** Framework-derived main workspace props. */
export type WorkspaceProps = PropsRuntime<'main'> & PropsRenderSlots<'multica.assistant.composer' | 'chat-feed.view'> &
  PropsLocale<'multica'> &
  PropsStore<ReturnType<typeof createMulticaStore>> &
  InjectFace<WorkspaceInjected>

/** @param props - injected project queries, declared drafts, and locale. @returns the manual workspace. */
export function Workspace(props: WorkspaceProps) {
  const { useStore, useProjects, actions, t, load, open, reportUnsaved } = props
  const creationFormId = useId()
  const state = useStore(s => s)
  const queries = useProjects(s => s)
  const studio = props.useStudio(s => s)
  const actors = props.useActors(s => s)
  const content = props.useContent(s => s)
  const hasFolder = !props.portable || !!queries.folders?.some(folder => folder.state === 'open' && folder.creationId === state.creationId)
  const canCreate = validInput(state.createInput) && hasFolder
  const boundedProject = props.portable && state.selected !== null && state.pages[state.selected] !== 'reviews'
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    void props.studioActions.catalog()
    void props.studioActions.creations()
    void props.studioActions.reviews()
  }, [props.studioActions])
  useEffect(() => {
    if (state.selected) void open(state.selected)
  }, [state.selected, open])
  useEffect(() => {
    reportUnsaved(
      state.createDirty ||
        Object.values(state.drafts).some(d => d.dirty) ||
        Object.values(state.assistantPrompts).some(text => text.length > 0) ||
        Object.values(state.roleDrafts).some(draft => draft.dirty),
    )
  }, [state.createDirty, state.drafts, state.assistantPrompts, state.roleDrafts, reportUnsaved])

  const choose = (id: ProjectId): void => {
    actions.select(id)
  }
  if (state.management === 'roles')
    return (
      <section className={css.workspace} aria-label={t('studio')}>
        <RoleSettings state={state} studio={studio} studioActions={props.studioActions} actions={actions} t={t} />
      </section>
    )
  if (state.management === 'reviews')
    return (
      <section className={css.workspace} aria-label={t('studio')}>
        <ReviewCenter
          state={state}
          studio={studio}
          queries={queries}
          studioActions={props.studioActions}
          history={props.history}
          actions={actions}
          t={t}
        />
      </section>
    )
  return (
    <section ref={(element) => { if (element) element.inert = state.creating }} aria-hidden={state.creating || undefined} className={boundedProject ? `${css.workspace} ${css.portableWorkspace}` : css.workspace} aria-label={t('studio')}>
      {state.management === 'actors' ? (
        <ActorLibraryPage state={actors} actors={props.actorActions} projects={() => { actions.manage(null) }} t={t} />
      ) : <>
        {props.portable && state.selected && !state.creating && (
          <ProjectLocation key={state.selected} state={state} queries={queries} portable={props.portable} t={t} />
        )}
        <Modal
          open={state.creating}
          onClose={() => {
            if (state.selected) actions.select(state.selected)
            else actions.home()
          }}
          title={t('createTitle')}
          description={t('createHint')}
          closeLabel={t('closeCreation')}
          className={`${css.workspace} ${css.creation}`}
          contentClassName={`${css.creationContent}`}
          footer={
            <Button
              variant="primary"
              type="submit"
              form={creationFormId}
              disabled={queries.creating || studio.creationSaving || !!queries.lifecycleBusy || !canCreate}
            >
              {t(queries.creating ? 'saving' : 'create')}
            </Button>
          }
        >
          <form id={creationFormId}
            onSubmit={(e) => {
              e.preventDefault()
              if (canCreate && !queries.creating && !studio.creationSaving && !queries.lifecycleBusy)
                void props.create(state.createInput, state.createEdit, state.creationId, state.createRevision)
            }}
          >
            <ProjectFields
              creation
              location={props.portable && (
                <ProjectLocation key={state.creationId} state={state} queries={queries} portable={props.portable} t={t} />
              )}
              input={state.createInput}
              change={actions.editCreate}
              disabled={queries.creating || studio.creationSaving || !!queries.lifecycleBusy}
              t={t}
            />
            {!validInput(state.createInput) && state.createDirty && <p role="alert" className={css.notice}>{t('creationValidation')}</p>}
            {queries.createError && (
              <p role="alert" className={css.notice}>
                {t('failed')}
              </p>
            )}
            {studio.creationError !== null && (
              <div role="alert" className={css.notice}>
                {t('failed')}
                <p>{studio.creationError}</p>
              </div>
            )}
            {studio.creationConflict && (
              <div role="alert" className={css.notice}>
                <p>{t('proposalConflict')}</p>
                <Button
                  onClick={() => {
                    if (studio.creationConflict) actions.restoreCreation(studio.creationConflict, true)
                  }}
                >
                  {t('loadRemote')}
                </Button>
              </div>
            )}
          </form>
        </Modal>
        {state.selected ? (
          props.portable && queries.folders?.some(folder => folder.projectId === state.selected)
          && !['settings', 'history', 'reviews'].includes(state.pages[state.selected] ?? '')
            ? <ProjectWorkspaceV2 {...props} state={state} queries={queries} studio={studio}
              content={content} id={state.selected} choose={choose} />
            : <ProjectEditor {...props} state={state} queries={queries} studio={studio} id={state.selected} choose={choose} />
        ) : (
          <Home
            portable={props.portable}
            state={state}
            studio={studio}
            studioActions={props.studioActions}
            queries={queries}
            actions={actions}
            open={choose}
            setCover={props.setCover}
            refresh={() => void load()}
            t={t}
          />
        )}
      </>}
    </section>
  )
}
