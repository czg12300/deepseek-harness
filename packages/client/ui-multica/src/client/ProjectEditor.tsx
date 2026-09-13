/** Project navigation and manual editors share a project-owned draft. */
import { useEffect, useMemo } from 'react'
import clsx from 'clsx'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EpisodeId, ProjectId, ProjectInput, StudioTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { MulticaDrafts, ProjectPage } from './drafts.ts'
import { projectInput, validInput } from './drafts.ts'
import type { ProjectQueries } from './projects.ts'
import type { WorkspaceProps } from './Workspace.tsx'
import { AssistantPanel } from './AssistantPanel.tsx'
import { ReviewCenter } from './ReviewCenter.tsx'
import { studioTargetKey, type StudioState } from './studio.ts'
import { ProjectFields } from './ProjectFields.tsx'
import { VersionPreview, exportDraft } from './VersionPreview.tsx'
import css from './Workspace.module.css'

type EditorProps = WorkspaceProps & {
  state: MulticaDrafts
  queries: ProjectQueries
  studio: StudioState
  id: ProjectId
  choose: (id: ProjectId) => void
}

/** @param props - current project selection, remote observations, and editor callbacks. @returns the project workspace. */
export function ProjectEditor({ state, queries, studio, studioActions, id, choose, actions, t, save, open, history }: EditorProps) {
  const query = queries.byId[id]
  const draft = state.drafts[id]
  const page = state.pages[id]
  useEffect(() => {
    if (page === 'history') void history(id)
  }, [id, page, history])
  const project = query?.project
  const episode = draft?.input.episodes.find(e => e.id === page)
  const episodeIndex = draft?.input.episodes.findIndex(e => e.id === page) ?? -1
  const previous = draft?.input.episodes[episodeIndex - 1]
  const next = draft?.input.episodes[episodeIndex + 1]
  const archived = project?.archived ?? false
  const blocked = archived || !!query?.saving || !!query?.missing
  const target = useMemo<StudioTarget>(
    () =>
      page === 'episodes'
        ? { kind: 'episodes', projectId: id }
        : episode
          ? { kind: 'episode', projectId: id, episodeId: episode.id }
          : { kind: 'outline', projectId: id },
    [id, page, episode?.id],
  )
  const currentReview = studio.reviews.find(
    review => studioTargetKey(review.target) === studioTargetKey(target) && review.projectRevision === draft?.baseRevision,
  )
  const setPage = (next: ProjectPage): void => {
    actions.page(id, next)
  }
  const addEpisode = (episodes: ProjectInput['episodes']): void => {
    const episodeId = randomUUID() as EpisodeId
    actions.edit(id, { episodes: [...episodes, { id: episodeId, title: t('episodeDefault', { count: episodes.length + 1 }), script: '' }] })
    setPage(episodeId)
  }
  const pageTitle = episode
    ? episode.title
    : t(page === 'settings' ? 'settings' : page === 'history' ? 'history' : page === 'episodes' ? 'episodes' : 'outline')
  if (page === 'reviews')
    return (
      <ReviewCenter
        projectId={id}
        state={state}
        studio={studio}
        queries={queries}
        studioActions={studioActions}
        history={history}
        actions={actions}
        t={t}
      />
    )
  return (
    <div className={css.project}>
      <nav className={css.projectNav} aria-label={t('planning')}>
        <Button
          onClick={() => {
            actions.home()
          }}
        >
          {t('back')}
        </Button>
        <label className={css.field}>
          {t('selectProject')}
          <select
            value={id}
            onChange={(e) => {
              if (e.target.value === 'all') actions.home()
              else if (e.target.value === 'new') actions.startCreate()
              else choose(e.target.value as ProjectId)
            }}
          >
            <option value="all">{t('home')}</option>
            {queries.list.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {!queries.list.some(p => p.id === id) && <option value={id}>{project?.name ?? t('loading')}</option>}
            <option value="new">{t('newProject')}</option>
          </select>
        </label>
        <p className={css.eyebrow}>{t('planning')}</p>
        <Button
          className={clsx(page === 'outline' && css.selected)}
          aria-current={page === 'outline' ? 'page' : undefined}
          onClick={() => {
            setPage('outline')
          }}
        >
          {t('outline')}
        </Button>
        <Button
          className={clsx(page === 'episodes' && css.selected)}
          aria-current={page === 'episodes' ? 'page' : undefined}
          onClick={() => {
            setPage('episodes')
          }}
        >
          {t('episodes')}
        </Button>
        {draft?.input.episodes.map((e, index) => (
          <Button
            key={e.id}
            className={clsx(page === e.id && css.selected)}
            aria-current={page === e.id ? 'page' : undefined}
            onClick={() => {
              setPage(e.id)
            }}
          >
            <span className={css.episodeNumber}>{String(index + 1).padStart(2, '0')}</span>
            {e.title}
          </Button>
        ))}
        <p className={css.eyebrow}>{t('sharedLibrary')}</p>
        {(['characters', 'scenes', 'props'] as const).map(key => (
          <Button key={key} disabled title={t('productionHint')}>
            {t(key)}
          </Button>
        ))}
        <p className={css.eyebrow}>{t('productionManagement')}</p>
        <Button
          onClick={() => {
            setPage('reviews')
          }}
        >
          {t('review')}
        </Button>
        <Button disabled title={t('productionHint')}>
          {t('tasks')}
        </Button>
        <Button
          onClick={() => {
            actions.manage('roles')
          }}
        >
          {t('agentConfig')}
        </Button>
        <div className={css.navFoot}>
          <Button
            className={clsx(page === 'history' && css.selected)}
            onClick={() => {
              setPage('history')
            }}
          >
            {t('history')}
          </Button>
          <Button
            className={clsx(page === 'settings' && css.selected)}
            onClick={() => {
              setPage('settings')
            }}
          >
            {t('settings')}
          </Button>
        </div>
      </nav>
      <main className={css.editor}>
        <header className={css.heading}>
          <div>
            <p className={css.eyebrow}>{draft?.input.name ?? project?.name}</p>
            <h1>{pageTitle}</h1>
          </div>
          {project && <span className={css.badge}>{t('revision', { revision: project.revision })}</span>}
          {currentReview && !draft?.dirty && (
            <span className={css.badge}>
              {t(
                currentReview.status === 'approved'
                  ? 'reviewApproved'
                  : currentReview.status === 'returned'
                    ? 'reviewReturned'
                    : 'reviewPending',
              )}
            </span>
          )}
        </header>
        {query?.loading && <p role="status">{t('loading')}</p>}
        {query?.error && (
          <div className={css.notice} role="alert">
            {t('failed')}
            <Button onClick={() => void open(id)}>{t('retry')}</Button>
          </div>
        )}
        {query?.missing && <p role="alert">{t('missing')}</p>}
        {draft && project && (
          <>
            {archived && (
              <p className={css.notice} role="status">
                {t('archivedHint')}
              </p>
            )}
            {draft.conflict && (
              <section className={css.conflict} aria-label={t('conflict')}>
                <h2>{t('conflict')}</h2>
                <p>{t('conflictHint')}</p>
                <details>
                  <summary>{t('remoteVersion', { revision: project.revision })}</summary>
                  <VersionPreview input={project} t={t} />
                </details>
                <details>
                  <summary>{t('localDraft')}</summary>
                  <VersionPreview input={draft.input} t={t} />
                </details>
                <div className={css.row}>
                  <Button
                    variant="outline"
                    onClick={() => {
                      exportDraft(draft.input)
                    }}
                  >
                    {t('export')}
                  </Button>
                  <Button
                    disabled={query.saving}
                    onClick={() => {
                      actions.loadRemote(project)
                    }}
                  >
                    {t('loadRemote')}
                  </Button>
                </div>
                <p>{t('reconcileHint')}</p>
                <Button
                  variant="outline"
                  disabled={blocked || !validInput(draft.input)}
                  onClick={() => void save(id, { ...draft, baseRevision: project.revision })}
                >
                  {t('reconcile')}
                </Button>
              </section>
            )}
            {page === 'settings' ? (
              <>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (validInput(draft.input) && !blocked && !draft.conflict) void save(id, draft)
                  }}
                >
                  <ProjectFields
                    input={draft.input}
                    change={(patch) => {
                      actions.edit(id, patch)
                    }}
                    disabled={blocked}
                    t={t}
                  />
                  <div className={css.unavailable}>
                    <h2>{t('settingsUnavailable')}</h2>
                    <p>{t('productionHint')}</p>
                  </div>
                  <footer className={css.saveBar}>
                    <span role="status">{t(query.saving ? 'saving' : draft.dirty ? 'dirty' : 'saved')}</span>
                    <Button
                      variant="primary"
                      type="submit"
                      disabled={blocked || draft.conflict || !draft.dirty || !validInput(draft.input)}
                    >
                      {t('saveSettings')}
                    </Button>
                  </footer>
                </form>
                <section className={css.archiveBox}>
                  <h2>{t(archived ? 'restore' : 'archive')}</h2>
                  <p>{t('archiveHint')}</p>
                  {draft.dirty && !archived && <p>{t('archiveDirty')}</p>}
                  <Button
                    variant="outline"
                    disabled={query.saving || (!archived && (draft.dirty || draft.conflict))}
                    onClick={() => void save(id, { ...draft, baseRevision: project.revision }, !archived)}
                  >
                    {t(archived ? 'restore' : 'archive')}
                  </Button>
                </section>
              </>
            ) : page === 'history' ? (
              <>
                <p>{t('historyHint')}</p>
                {draft.dirty && <p className={css.notice}>{t('historyDirty')}</p>}
                <div className={css.row}>
                  <Button onClick={() => void history(id)} disabled={query.historyLoading}>
                    {t('refresh')}
                  </Button>
                  <Button
                    onClick={() => {
                      exportDraft(draft.input)
                    }}
                  >
                    {t('export')}
                  </Button>
                </div>
                {query.historyLoading && <p role="status">{t('loading')}</p>}
                {query.historyError && <p role="alert">{t('failed')}</p>}
                {!query.historyLoading && query.history.length === 0 && <p>{t('historyEmpty')}</p>}
                {[...query.history].reverse().map(version => (
                  <article key={version.revision} className={css.historyEntry}>
                    <details>
                      <summary>
                        {t('revision', { revision: version.revision })}
                        <time dateTime={version.updatedAt}>{version.updatedAt}</time>
                      </summary>
                      <VersionPreview input={version} t={t} />
                    </details>
                    <Button
                      variant="outline"
                      disabled={blocked || draft.dirty || draft.conflict || version.revision === project.revision}
                      onClick={() => {
                        actions.stageVersion(id, projectInput(version))
                        void save(id, { ...draft, input: projectInput(version), dirty: true, edit: draft.edit + 1 })
                      }}
                    >
                      {t(version.revision === project.revision ? 'current' : 'restoreVersion')}
                    </Button>
                  </article>
                ))}
              </>
            ) : (
              <>
                {page === 'episodes' ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={blocked}
                      onClick={() => {
                        addEpisode(draft.input.episodes)
                      }}
                    >
                      {t('addEpisode')}
                    </Button>
                    {draft.input.episodes.length === 0 && <p className={css.empty}>{t('episodeEmpty')}</p>}
                    {draft.input.episodes.map(e => (
                      <article className={css.episodeRow} key={e.id}>
                        <h2>{e.title}</h2>
                        <Button
                          onClick={() => {
                            setPage(e.id)
                          }}
                        >
                          {t('script')}
                        </Button>
                      </article>
                    ))}
                  </>
                ) : episode ? (
                  <>
                    <div className={css.row}>
                      <Button aria-current="page">{t('script')}</Button>
                      {(['storyboard', 'production', 'editing'] as const).map(key => (
                        <Button key={key} disabled title={t('productionHint')}>
                          {t(key)}
                        </Button>
                      ))}
                    </div>
                    <fieldset className={css.fields} disabled={blocked}>
                      <label className={css.field}>
                        {t('episodeTitle')}
                        <Input
                          value={episode.title}
                          onChange={(e) => {
                            actions.edit(id, {
                              episodes: draft.input.episodes.map(item =>
                                item.id === episode.id ? { ...item, title: e.target.value } : item,
                              ),
                            })
                          }}
                        />
                      </label>
                      <label className={css.field}>
                        {t('episodeScript')}
                        <textarea
                          className={css.manuscript}
                          value={episode.script}
                          onChange={(e) => {
                            actions.edit(id, {
                              episodes: draft.input.episodes.map(item =>
                                item.id === episode.id ? { ...item, script: e.target.value } : item,
                              ),
                            })
                          }}
                        />
                      </label>
                    </fieldset>
                    <div className={css.row}>
                      <Button
                        disabled={!previous}
                        onClick={
                          previous
                            ? () => {
                              setPage(previous.id)
                            }
                            : undefined
                        }
                      >
                        {t('previous')}
                      </Button>
                      <Button
                        disabled={!next}
                        onClick={
                          next
                            ? () => {
                              setPage(next.id)
                            }
                            : undefined
                        }
                      >
                        {t('next')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <label className={css.field}>
                    {t('outline')}
                    <textarea
                      className={css.manuscript}
                      placeholder={t('outlineHint')}
                      value={draft.input.outline}
                      disabled={blocked}
                      onChange={(e) => {
                        actions.edit(id, { outline: e.target.value })
                      }}
                    />
                  </label>
                )}
                <footer className={css.saveBar}>
                  <span role="status">{t(query.saving ? 'saving' : draft.dirty ? 'dirty' : 'saved')}</span>
                  <div className={css.row}>
                    <Button
                      disabled={blocked || draft.dirty || draft.conflict || studio.reviewBusy || !!currentReview}
                      onClick={() => {
                        if (target.kind !== 'creation') void studioActions.submitReview(target, draft.baseRevision)
                      }}
                    >
                      {t('submitReview')}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={blocked || draft.conflict || !draft.dirty || !validInput(draft.input)}
                      onClick={() => void save(id, draft)}
                    >
                      {t('save')}
                    </Button>
                  </div>
                </footer>
              </>
            )}
            <div className={css.draftFoot}>
              <p>{t('draftNotice')}</p>
              {draft.dirty && !draft.conflict && (
                <Button
                  disabled={query.saving}
                  onClick={() => {
                    actions.loadRemote(project)
                  }}
                >
                  {t('loadRemote')}
                </Button>
              )}
              <Button
                onClick={() => {
                  exportDraft(draft.input)
                }}
              >
                {t('export')}
              </Button>
            </div>
          </>
        )}
      </main>
      {page !== 'settings' && page !== 'history' && draft && (
        <AssistantPanel
          state={state}
          studio={studio}
          studioActions={studioActions}
          actions={actions}
          target={target}
          input={draft.input}
          revision={draft.baseRevision}
          disabled={blocked || draft.conflict || !validInput(draft.input)}
          saveFirst={!!episode && !project?.episodes.some(value => value.id === episode.id)}
          t={t}
        />
      )}
    </div>
  )
}
