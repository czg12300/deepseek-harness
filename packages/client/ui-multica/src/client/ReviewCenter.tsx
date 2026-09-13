/** Human-only comparison and decisions for exact saved text revisions. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Project, ProjectId, StudioReview } from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, MulticaDrafts } from './drafts.ts'
import type { ProjectQueries } from './projects.ts'
import type { StudioActions, StudioState } from './studio.ts'
import { studioTargetKey } from './studio.ts'
import css from './Workspace.module.css'

type ReviewProps = PropsLocale<'multica'> &
  Pick<PropsStore<ReturnType<typeof createMulticaStore>>, 'actions'> & {
    state: MulticaDrafts
    studio: StudioState
    queries: ProjectQueries
    studioActions: StudioActions
    history: (id: ProjectId) => Promise<void>
    projectId?: ProjectId
  }

/** Extract the target's text from its immutable project version.
 * @param project - reviewed project revision.
 * @param target - reviewed object identity.
 * @returns readable target content, or undefined if the reference is missing.
 */
export function reviewedText(project: Project, target: StudioReview['target']): string | undefined {
  if (target.kind === 'outline') return project.outline
  if (target.kind === 'episodes') return project.episodes.map(episode => `${episode.title}\n${episode.script}`).join('\n\n')
  const episode = project.episodes.find(episode => episode.id === target.episodeId)
  return episode ? `${episode.title}\n${episode.script}` : undefined
}

/** @param props - review records, immutable history, and human decision callbacks. @returns review queue and content comparison. */
export function ReviewCenter({ state, studio, queries, studioActions, history, projectId, actions, t }: ReviewProps) {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'returned' | 'all'>('pending')
  useEffect(() => {
    void studioActions.reviews()
  }, [studioActions])
  const reviews = studio.reviews.filter(review => projectId === undefined || review.target.projectId === projectId)
  const selected = reviews.find(review => review.id === state.selectedReview)
  useEffect(() => {
    if (selected) void history(selected.target.projectId)
  }, [selected?.id, selected?.projectRevision, history])
  const current = selected ? queries.list.find(project => project.id === selected.target.projectId) : undefined
  const query = selected ? queries.byId[selected.target.projectId] : undefined
  const candidate = query?.history.find(project => project.revision === selected?.projectRevision)
  const baselineReview = selected
    ? reviews
      .filter(
        review =>
          review.status === 'approved' &&
            review.projectRevision < selected.projectRevision &&
            studioTargetKey(review.target) === studioTargetKey(selected.target),
      )
      .sort((a, b) => b.projectRevision - a.projectRevision)[0]
    : undefined
  const baseline = query?.history.find(project => project.revision === baselineReview?.projectRevision)
  const stale = selected !== undefined && current !== undefined && current.revision !== selected.projectRevision
  const pending = selected?.status === 'pending'
  const canDecide =
    selected !== undefined &&
    current !== undefined &&
    candidate !== undefined &&
    pending &&
    !stale &&
    !current.archived &&
    !studio.reviewBusy
  return (
    <div className={css.management}>
      <header className={css.heading}>
        <div>
          <Button
            onClick={() => {
              if (projectId) actions.page(projectId, 'outline')
              else actions.manage(null)
            }}
          >
            {t('backToWorkspace')}
          </Button>
          <h1>{t('reviewCenter')}</h1>
          <p>{t('reviewHint')}</p>
        </div>
        <Button disabled={studio.reviewLoading} onClick={() => void studioActions.reviews()}>
          {t('refresh')}
        </Button>
      </header>
      {studio.reviewLoading && <p role="status">{t('loading')}</p>}
      {studio.reviewError !== null && (
        <div className={css.notice} role="alert">
          <p>{t('failed')}</p>
          <p>{studio.reviewError}</p>
        </div>
      )}
      <div className={css.reviewLayout}>
        <nav className={css.reviewList} aria-label={t('reviewCenter')}>
          <label className={css.field}>
            {t('reviewFilter')}
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as typeof filter)
              }}
            >
              <option value="pending">{t('reviewPending')}</option>
              <option value="approved">{t('reviewApproved')}</option>
              <option value="returned">{t('reviewReturned')}</option>
              <option value="all">{t('reviewAll')}</option>
            </select>
          </label>
          {reviews.length === 0 && <p>{t('reviewEmpty')}</p>}
          {reviews
            .filter(review => filter === 'all' || review.status === filter)
            .map(review => (
              <Button
                className={selected?.id === review.id ? css.selected : undefined}
                key={review.id}
                onClick={() => {
                  actions.selectReview(review.id)
                }}
              >
                <span>
                  {queries.list.find(project => project.id === review.target.projectId)?.name ?? t('missing')}
                  <small>
                    {t(review.target.kind === 'outline' ? 'outline' : review.target.kind === 'episodes' ? 'episodes' : 'episodeScript')} ·{' '}
                    {t('revision', { revision: review.projectRevision })}
                  </small>
                </span>
              </Button>
            ))}
        </nav>
        <main className={css.reviewContent}>
          {!selected ? (
            <p>{t('reviewSelect')}</p>
          ) : (
            <>
              <header className={css.heading}>
                <h2>{current?.name}</h2>
                <span className={css.badge}>
                  {t(
                    selected.status === 'approved' ? 'reviewApproved' : selected.status === 'returned' ? 'reviewReturned' : 'reviewPending',
                  )}
                </span>
              </header>
              {stale && <p className={css.notice}>{t('reviewStale')}</p>}
              {current?.archived && <p className={css.notice}>{t('archivedHint')}</p>}
              {query?.historyLoading && <p role="status">{t('reviewLoading')}</p>}
              {query?.historyError && (
                <div role="alert">
                  <p>{t('failed')}</p>
                  <Button onClick={() => void history(selected.target.projectId)}>{t('retry')}</Button>
                </div>
              )}
              <div className={css.reviewColumns}>
                <section>
                  <h3>
                    {t('reviewCandidate')} · {t('revision', { revision: selected.projectRevision })}
                  </h3>
                  <pre>{candidate ? (reviewedText(candidate, selected.target) ?? t('missing')) : t('reviewLoading')}</pre>
                </section>
                <section>
                  <h3>{t('reviewBaseline')}</h3>
                  {baseline ? (
                    <>
                      <p>{t('revision', { revision: baseline.revision })}</p>
                      <pre>{reviewedText(baseline, selected.target)}</pre>
                    </>
                  ) : (
                    <p>{t('reviewNoBaseline')}</p>
                  )}
                </section>
              </div>
              <label className={css.field}>
                {t('reviewComment')}
                <textarea
                  rows={4}
                  disabled={!pending || studio.reviewBusy}
                  value={pending ? (state.reviewComments[selected.id] ?? '') : selected.comment}
                  onChange={(event) => {
                    actions.reviewComment(selected.id, event.target.value)
                  }}
                />
              </label>
              <footer className={css.saveBar}>
                <p>{t('reviewHint')}</p>
                <div className={css.row}>
                  <Button
                    disabled={!canDecide}
                    onClick={() => void studioActions.decide(selected, 'returned', state.reviewComments[selected.id] ?? '')}
                  >
                    {t('returnReview')}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canDecide}
                    onClick={() => void studioActions.decide(selected, 'approved', state.reviewComments[selected.id] ?? '')}
                  >
                    {t('approveReview')}
                  </Button>
                </div>
              </footer>
            </>
          )}
        </main>
        <aside className={css.permissionSummary}>
          <h2>{t('roleReviewer')}</h2>
          <p>{t('roleLater')}</p>
          <p>{t('reviewHint')}</p>
        </aside>
      </div>
    </div>
  )
}
