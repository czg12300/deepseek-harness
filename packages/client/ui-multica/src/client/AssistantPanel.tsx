/** One professional dialogue and proposal UI shared by all authoring targets. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ProjectInput,
  StudioTarget,
  StudioFieldValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { createMulticaStore, MulticaDrafts } from './drafts.ts'
import type { StudioActions, StudioState } from './studio.ts'
import { studioTargetKey } from './studio.ts'
import { roleKeys, fieldKeys, taskLabels } from './locales.ts'
import css from './Workspace.module.css'

/** Render a project field for human comparison without exposing internal episode identifiers.
 * @param value - typed authoring field value.
 * @param empty - already-localized undecided label.
 * @returns readable text preserving scripts and episode ordering.
 */
export function fieldText(value: StudioFieldValue, empty: string): string {
  if (value === null) return empty
  return Array.isArray(value) ? value.map(episode => `${episode.title}\n${episode.script}`).join('\n\n') : String(value)
}

type AssistantProps = PropsLocale<'multica'> &
  Pick<PropsStore<ReturnType<typeof createMulticaStore>>, 'actions'> & {
    state: MulticaDrafts
    studio: StudioState
    studioActions: StudioActions
    target: StudioTarget
    input: ProjectInput
    revision: number | null
    disabled: boolean
    saveFirst?: boolean
  }

/**
 * @param props - immutable target, current local draft, and declared mutation channels.
 * @returns professional dialogue and explicit proposal controls.
 */
export function AssistantPanel({ state, studio, studioActions, target, input, revision, disabled, saveFirst, actions, t }: AssistantProps) {
  const key = studioTargetKey(target)
  const roleId = target.kind === 'creation' || target.kind === 'outline' ? 'planner' : 'writer'
  const latestRole = studio.roles.find(role => role.role === roleId)
  const backend = studio.catalog?.backendAvailable === true
  const id = studio.bindings[key]
  const query = id ? studio.byId[id] : undefined
  const view = query?.view
  const running = view?.tasks.find(task => task.status === 'running')
  const prompt = state.assistantPrompts[key] ?? ''
  const oldVersion = view !== undefined && view !== null && latestRole !== undefined && view.workspace.role.revision !== latestRole.revision
  const pending = view?.proposals.some(proposal =>
    proposal.changes.some(change => !proposal.applied.includes(change.field) && !proposal.ignored.includes(change.field)),
  )
  useEffect(() => {
    if (backend) void studioActions.open(target)
  }, [key, backend, latestRole?.revision, studioActions])
  const send = (): void => {
    if (id && !disabled && !saveFirst && !running && !query?.busy && !query?.retry && !oldVersion && prompt.trim())
      void studioActions.send(id, revision, input, prompt)
  }
  const targetName =
    target.kind === 'creation'
      ? t('creationDraft')
      : target.kind === 'outline'
        ? t('outline')
        : target.kind === 'episodes'
          ? t('episodes')
          : (input.episodes.find(episode => episode.id === target.episodeId)?.title ?? t('episodeScript'))
  return (
    <aside className={css.professional} aria-label={t(roleKeys[roleId])}>
      <header className={css.professionalHead}>
        <div className={css.roleAvatar} aria-hidden="true">
          {t(roleKeys[roleId]).slice(0, 1)}
        </div>
        <div>
          <h2>{t(roleKeys[roleId])}</h2>
          <span className={css.badge}>{t(running ? 'assistantRunning' : pending ? 'assistantPending' : 'assistantIdle')}</span>
        </div>
        <Button
          onClick={() => {
            actions.manage('roles')
            actions.selectRole(roleId)
          }}
        >
          {t('agentConfig')}
        </Button>
      </header>
      <p className={css.contextLine}>
        {t('assistantContext', { name: targetName, version: revision === null ? t('creationDraft') : t('revision', { revision }) })}
      </p>
      {!backend ? (
        <div className={css.notice}>
          <p>{t('assistantUnavailable')}</p>
          <p>{t('assistantHint')}</p>
          <Button onClick={() => void studioActions.catalog()}>{t('retry')}</Button>
        </div>
      ) : (
        <>
          {(studio.opening[key] || query?.loading) && <p role="status">{t('loading')}</p>}
          {studio.openErrors[key] != null && (
            <div className={css.notice} role="alert">
              <p>{t('assistantFailure')}</p>
              <p>{studio.openErrors[key]}</p>
              <Button onClick={() => void studioActions.open(target)}>{t('retry')}</Button>
            </div>
          )}
          {view && (
            <>
              <label className={css.field}>
                {t('workspaceVersion')}
                <select
                  value={view.workspace.id}
                  onChange={event => void studioActions.selectVersion(target, event.target.value as typeof view.workspace.id)}
                >
                  {view.versions.map(version => (
                    <option key={version.id} value={version.id}>
                      {t('roleVersion', { revision: version.roleRevision })}
                      {version.running ? ` · ${t('taskRunning')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {oldVersion && (
                <div className={css.notice}>
                  <p>{t('olderWorkspace')}</p>
                  <Button onClick={() => void studioActions.open(target)}>{t('openLatestWorkspace')}</Button>
                </div>
              )}
              <details className={css.capabilities}>
                <summary>{t('capabilities')}</summary>
                <p>{t('roleVersion', { revision: view.workspace.role.revision })}</p>
                {view.workspace.resolved && (
                  <p>
                    {view.workspace.resolved.provider} / {view.workspace.resolved.model}
                  </p>
                )}
                <p>
                  {t('skills')}: {view.workspace.role.config.skills.join(', ') || t('noSkills')}
                </p>
                <p>
                  {t('contextTools')}: {view.workspace.role.config.tools.join(', ') || t('noContextTools')}
                </p>
                <p>{t('rolePermissions')}</p>
              </details>
              <details className={css.capabilities}>
                <summary>{t('fieldLocks')}</summary>
                <p>{t('lockHint')}</p>
                {view.allowedFields.map(field => (
                  <label className={css.checkRow} key={field}>
                    <input
                      type="checkbox"
                      disabled={disabled || query.busy}
                      checked={view.lockedFields.includes(field)}
                      onChange={event =>
                        void studioActions.locks(
                          view,
                          event.target.checked ? [...view.lockedFields, field] : view.lockedFields.filter(value => value !== field),
                        )
                      }
                    />
                    {t(fieldKeys[field])}
                  </label>
                ))}
              </details>
              <div className={css.dialogue} aria-label={t('assistantReply')}>
                {view.tasks.length === 0 && <p className={css.emptyDialogue}>{t('noDialogue')}</p>}
                {view.tasks.map(task => (
                  <article className={css.dialogueTurn} key={task.id}>
                    <div className={css.userBubble}>
                      <strong>{t('userMessage')}</strong>
                      <p>{task.prompt}</p>
                    </div>
                    <div className={css.assistantBubble}>
                      <div className={css.row}>
                        <strong>{t(roleKeys[task.role])}</strong>
                        <span className={css.badge}>{t(taskLabels[task.status])}</span>
                      </div>
                      {task.reply && <p>{task.reply}</p>}
                      {task.error && <p role="alert">{task.error}</p>}
                      {task.status === 'running' && <Button onClick={() => void studioActions.cancel(task)}>{t('stopAssistant')}</Button>}
                      {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') && (
                        <Button
                          disabled={disabled || query.busy || !!running || oldVersion || !!query.retry}
                          onClick={() => void studioActions.send(view.workspace.id, revision, input, task.prompt)}
                        >
                          {t('taskRetry')}
                        </Button>
                      )}
                    </div>
                    {view.proposals
                      .filter(proposal => proposal.taskId === task.id)
                      .map((proposal) => {
                        const selected = (state.proposalSelection[proposal.id] ?? []).filter(
                          field => !proposal.applied.includes(field) && !proposal.ignored.includes(field),
                        )
                        return (
                          <section className={css.proposalCard} key={proposal.id} aria-label={t('proposal')}>
                            <h3>{t('proposal')}</h3>
                            {proposal.changes.map((change) => {
                              const applied = proposal.applied.includes(change.field)
                              const ignored = proposal.ignored.includes(change.field)
                              const locked = view.lockedFields.includes(change.field)
                              return (
                                <div className={css.proposalField} key={change.field}>
                                  <label className={css.checkRow}>
                                    <input
                                      type="checkbox"
                                      checked={selected.includes(change.field)}
                                      disabled={disabled || applied || ignored || query.busy}
                                      onChange={(event) => {
                                        actions.proposalField(proposal.id, change.field, event.target.checked)
                                      }}
                                    />
                                    {t(fieldKeys[change.field])}
                                    {(applied || ignored || locked) && (
                                      <span>{t(applied ? 'proposalApplied' : ignored ? 'proposalIgnored' : 'protected')}</span>
                                    )}
                                  </label>
                                  <details>
                                    <summary>{t('before')}</summary>
                                    <pre>{fieldText(change.before, t('unknown'))}</pre>
                                  </details>
                                  <strong>{t('after')}</strong>
                                  <pre className={css.proposedText}>{fieldText(change.after, t('unknown'))}</pre>
                                </div>
                              )
                            })}
                            <div className={css.row}>
                              <Button
                                variant="primary"
                                disabled={
                                  disabled ||
                                  query.busy ||
                                  selected.length === 0 ||
                                  selected.some(field => view.lockedFields.includes(field))
                                }
                                onClick={() =>
                                  void studioActions.apply(view.workspace.id, proposal.target, {
                                    proposalId: proposal.id,
                                    expectedRevision: revision,
                                    input,
                                    fields: selected,
                                  })
                                }
                              >
                                {t('applySelected')}
                              </Button>
                              <Button
                                disabled={disabled || query.busy || selected.length === 0}
                                onClick={() => void studioActions.ignore(view.workspace.id, proposal.id, selected)}
                              >
                                {t('ignoreSelected')}
                              </Button>
                            </div>
                            <p>{t('proposalHint')}</p>
                          </section>
                        )
                      })}
                  </article>
                ))}
              </div>
              {query.outcome && (
                <p role="status" className={css.notice}>
                  {t(
                    query.outcome === 'applied'
                      ? 'proposalApplied'
                      : query.outcome === 'locked'
                        ? 'proposalLocked'
                        : query.outcome === 'archived'
                          ? 'archivedHint'
                          : 'proposalConflict',
                  )}
                </p>
              )}
              {query.error !== null && (
                <div className={css.notice} role="alert">
                  <p>{t('assistantFailure')}</p>
                  <p>{query.error}</p>
                </div>
              )}
              {query.retry && !query.busy && (
                <div className={css.notice}>
                  <p>{t('submissionUnknown')}</p>
                  <Button onClick={() => void studioActions.retry(view.workspace.id)}>{t('retrySubmission')}</Button>
                  <p>{t('abandonHint')}</p>
                  <Button
                    onClick={() => {
                      studioActions.abandon(view.workspace.id)
                    }}
                  >
                    {t('abandonSubmission')}
                  </Button>
                </div>
              )}
              <Button onClick={() => void studioActions.refresh(view.workspace.id)}>{t('refresh')}</Button>
            </>
          )}
        </>
      )}
      <form
        className={css.assistantComposer}
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {saveFirst && <p>{t('saveEpisodeFirst')}</p>}
        {target.kind === 'creation' && <p>{t('creationSendHint')}</p>}
        <textarea
          rows={4}
          aria-label={t('assistantMessage')}
          placeholder={t('assistantPlaceholder')}
          value={prompt}
          disabled={!backend || disabled}
          onChange={(event) => {
            actions.assistantPrompt(key, event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <Button
          variant="primary"
          type="submit"
          disabled={
            !backend || !view || disabled || saveFirst || !prompt.trim() || !!running || query.busy || !!query.retry || oldVersion
          }
        >
          {t('send')}
        </Button>
      </form>
    </aside>
  )
}
