/** Project catalog renders only persisted metadata and explicit empty states. */
import { Button, Input, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectId, ProjectSummary } from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, MulticaDrafts } from './drafts.ts'
import type { StudioState, StudioActions } from './studio.ts'
import type { ProjectQueries } from './projects.ts'
import { CoverPicker } from './CoverPicker.tsx'
import css from './Workspace.module.css'

type HomeProps = PropsLocale<'multica'> &
  Pick<PropsStore<ReturnType<typeof createMulticaStore>>, 'actions'> & {
    state: MulticaDrafts
    queries: ProjectQueries
    studio: StudioState
    studioActions: StudioActions
    open: (id: ProjectId) => void
    setCover: (id: ProjectId, revision: number, image: string | null) => Promise<void>
    refresh: () => void
  }

/** Filter and order persisted project summaries without changing the source array.
 * @param list - remote project metadata.
 * @param state - selected filter, search, and sort.
 * @returns visible project cards in stable order.
 */
export function visibleProjects(list: ProjectSummary[], state: Pick<MulticaDrafts, 'filter' | 'search' | 'sort'>): ProjectSummary[] {
  const search = state.search.trim().toLocaleLowerCase()
  return list
    .filter(p => p.archived === (state.filter === 'archived') && p.name.toLocaleLowerCase().includes(search))
    .sort((a, b) =>
      state.sort === 'byName'
        ? a.name.localeCompare(b.name)
        : state.sort === 'oldest'
          ? a.updatedAt.localeCompare(b.updatedAt)
          : b.updatedAt.localeCompare(a.updatedAt),
    )
}

/** @param props - catalog snapshot, viewing state, and navigation. @returns the project home. */
export function Home({ state, queries, studio, studioActions, actions, open, refresh, setCover, t }: HomeProps) {
  const visible = visibleProjects(queries.list, state)
  return (
    <div className={css.home}>
      <header className={css.heading}>
        <div>
          <p className={css.eyebrow}>{t('studio')}</p>
          <h1>{t('home')}</h1>
          <p>{t('homeHint')}</p>
        </div>
        <div className={css.row}>
          <Button
            onClick={() => {
              actions.manage('reviews')
            }}
          >
            {t('review')}
          </Button>
          <Button
            onClick={() => {
              actions.manage('roles')
            }}
          >
            {t('agentConfig')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              actions.startCreate()
            }}
          >
            {t('newProject')}
          </Button>
        </div>
      </header>
      {state.createDirty && (
        <div className={css.notice}>
          <p>{t('unsavedCreationHint')}</p>
          <Button
            onClick={() => {
              actions.startCreate()
            }}
          >
            {t('continueCreation')}
          </Button>
        </div>
      )}
      {studio.creations.length > 0 && (
        <section className={css.creationRecovery}>
          <h2>{t('savedCreationDrafts')}</h2>
          <div className={css.row}>
            {studio.creations.map(draft => (
              <Button
                key={draft.id}
                disabled={studio.creationSaving || (state.createDirty && state.creationId !== draft.id)}
                onClick={() => void studioActions.resumeCreation(draft.id)}
              >
                {draft.name || t('creationDraft')} · {t('revision', { revision: draft.revision })}
              </Button>
            ))}
          </div>
        </section>
      )}
      <div className={css.filters}>
        <div className={css.row}>
          <Pill
            active={state.filter === 'active'}
            aria-label={t('active')}
            onClick={() => {
              actions.browse({ filter: 'active' })
            }}
          >
            {t('active')}
            <span aria-hidden="true">{queries.list.filter(p => !p.archived).length}</span>
          </Pill>
          <Pill
            active={state.filter === 'archived'}
            aria-label={t('archived')}
            onClick={() => {
              actions.browse({ filter: 'archived' })
            }}
          >
            {t('archived')}
            <span aria-hidden="true">{queries.list.filter(p => p.archived).length}</span>
          </Pill>
        </div>
        <Input
          aria-label={t('search')}
          placeholder={t('search')}
          value={state.search}
          onChange={(e) => {
            actions.browse({ search: e.target.value })
          }}
        />
        <select
          aria-label={t('sort')}
          value={state.sort}
          onChange={(e) => {
            actions.browse({ sort: e.target.value as MulticaDrafts['sort'] })
          }}
        >
          <option value="updated">{t('updated')}</option>
          <option value="oldest">{t('oldest')}</option>
          <option value="byName">{t('byName')}</option>
        </select>
        <Button onClick={refresh} disabled={queries.loading}>
          {t('refresh')}
        </Button>
      </div>
      {queries.loading && <p role="status">{t('loading')}</p>}
      {queries.error && (
        <div role="alert" className={css.notice}>
          {t('failed')}
          <Button onClick={refresh}>{t('retry')}</Button>
        </div>
      )}
      {!queries.loading && !queries.error && visible.length === 0 && (
        <div className={css.empty}>
          <h2>{t(state.search ? 'noMatches' : state.filter === 'archived' ? 'noArchived' : 'empty')}</h2>
          <p>{t('emptyHint')}</p>
        </div>
      )}
      <div className={css.cards}>
        {visible.map(project => (
          <article className={css.card} aria-label={project.name} key={project.id}>
            <CoverPicker project={project} maxBytes={queries.maxCoverBytes} status={queries.covers[project.id]} setCover={setCover} t={t} />
            <div className={css.cardBody}>
              <h2>{project.name}</h2>
              <p>{project.concept}</p>
              <div className={css.row}>
                <span className={css.badge}>{t(project.archived ? 'archived' : 'manual')}</span>
                <span>{project.aspectRatio}</span>
              </div>
              <div className={css.row}>
                <span>{t('episodesCount', { count: project.episodeCount })}</span>
                <span>{t('revision', { revision: project.revision })}</span>
              </div>
            </div>
            <footer className={css.cardFoot}>
              <time dateTime={project.updatedAt}>{t('updatedAt', { date: new Date(project.updatedAt).toLocaleString() })}</time>
              <Button
                onClick={() => {
                  open(project.id)
                }}
              >
                {t('open')}
              </Button>
            </footer>
          </article>
        ))}
        {state.filter === 'active' && (
          <div className={css.createCard}>
            <span className={css.plus} aria-hidden="true">
              +
            </span>
            <h2>{t('createTitle')}</h2>
            <p>{t('emptyHint')}</p>
            <Button
              variant="outline"
              onClick={() => {
                actions.startCreate()
              }}
            >
              {t('newProject')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
