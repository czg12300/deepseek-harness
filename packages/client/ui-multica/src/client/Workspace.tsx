/** Multica main entry receives all live facts through framework props. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
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

/** Callback and observable inputs captured at plugin registration. */
export interface WorkspaceInjected {
  hooks: { projects: ObservableSnapshot<ProjectQueries>; studio: ObservableSnapshot<StudioState> }
  studioActions: StudioActions
  setCover: (id: ProjectId, revision: number, image: string | null) => Promise<void>
  load: () => Promise<void>
  open: (id: ProjectId) => Promise<void>
  create: (input: ProjectInput, edit: number, creationId: StudioCreationId, revision: number | null) => Promise<void>
  save: (id: ProjectId, draft: ProjectDraft, archived?: boolean) => Promise<void>
  history: (id: ProjectId) => Promise<void>
  reportUnsaved: (value: boolean) => void
}

/** Framework-derived main workspace props. */
export type WorkspaceProps = PropsRuntime<'main'> &
  PropsLocale<'multica'> &
  PropsStore<ReturnType<typeof createMulticaStore>> &
  InjectFace<WorkspaceInjected>

/** @param props - injected project queries, declared drafts, and locale. @returns the manual workspace. */
export function Workspace(props: WorkspaceProps) {
  const { useStore, useProjects, actions, t, load, open, reportUnsaved } = props
  const state = useStore(s => s)
  const queries = useProjects(s => s)
  const studio = props.useStudio(s => s)
  const canCreate = validInput(state.createInput)
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
    <section className={css.workspace} aria-label={t('studio')}>
      {state.creating ? (
        <div className={css.creation}>
          <main className={css.creationMain}>
            <Button
              onClick={() => {
                if (state.selected) actions.select(state.selected)
                else actions.home()
              }}
            >
              {t('cancel')}
            </Button>
            <header className={css.heading}>
              <div>
                <p className={css.eyebrow}>{t('home')}</p>
                <h1>{t('createTitle')}</h1>
                <p>{t('createHint')}</p>
              </div>
            </header>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (canCreate && !queries.creating && !studio.creationSaving)
                  void props.create(state.createInput, state.createEdit, state.creationId, state.createRevision)
              }}
            >
              <ProjectFields
                creation
                input={state.createInput}
                change={actions.editCreate}
                disabled={queries.creating || studio.creationSaving}
                t={t}
              />
              {!canCreate && state.createDirty && <p role="alert" className={css.notice}>{t('creationValidation')}</p>}
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
              <footer className={css.saveBar}>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={queries.creating || studio.creationSaving || !canCreate}
                >
                  {t(queries.creating ? 'saving' : 'create')}
                </Button>
              </footer>
            </form>
          </main>
        </div>
      ) : state.selected ? (
        <ProjectEditor {...props} state={state} queries={queries} studio={studio} id={state.selected} choose={choose} />
      ) : (
        <Home
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
    </section>
  )
}
