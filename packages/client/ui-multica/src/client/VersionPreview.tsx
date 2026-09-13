/** Human-readable immutable project content for history and conflict review. */
import type { ProjectInput } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Workspace.module.css'

/** @param props - complete project fields and locale. @returns named fields and creative text. */
export function VersionPreview({ input, t }: PropsLocale<'multica'> & { input: ProjectInput }) {
  return (
    <div className={css.preview}>
      <dl className={css.specification}>
        <div>
          <dt>{t('name')}</dt>
          <dd>{input.name}</dd>
        </div>
        <div>
          <dt>{t('concept')}</dt>
          <dd>{input.concept}</dd>
        </div>
        <div>
          <dt>{t('ratio')}</dt>
          <dd>{input.aspectRatio}</dd>
        </div>
        <div>
          <dt>{t('count')}</dt>
          <dd>{input.targetEpisodes ?? t('unknown')}</dd>
        </div>
        <div>
          <dt>{t('duration')}</dt>
          <dd>{input.episodeDuration ?? t('unknown')}</dd>
        </div>
      </dl>
      <h3>{t('outline')}</h3>
      <pre>{input.outline}</pre>
      <details>
        <summary>{t('source')}</summary>
        <pre>{input.sourceText}</pre>
      </details>
      <h3>{t('episodes')}</h3>
      {input.episodes.map(episode => (
        <details key={episode.id}>
          <summary>{episode.title}</summary>
          <pre>{episode.script}</pre>
        </details>
      ))}
    </div>
  )
}

/** Export an explicit user-selected draft without sending it to a service.
 * @param input - complete local editable content.
 */
export function exportDraft(input: ProjectInput): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(input, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'multica-project-draft.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
