/** Complete manual project form shared by creation and project settings. */
import { useId } from 'react'
import clsx from 'clsx'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectInput } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { validInput } from './drafts.ts'
import css from './Workspace.module.css'

/** Form-owned editable data and mutation callback. */
type FieldsProps = PropsLocale<'multica'> & {
  input: ProjectInput
  change: (patch: Partial<ProjectInput>) => void
  disabled?: boolean
  creation?: boolean
}

/** @param props - current draft fields and localized labels. @returns the project specification form. */
export function ProjectFields({ input, change, disabled, creation = false, t }: FieldsProps) {
  const fieldId = useId()
  const nameLength = Array.from(input.name).length
  const conceptLength = Array.from(input.concept).length
  const conceptField = (
    <label className={css.field}>
      {t('concept')}
      <textarea
        rows={creation ? 5 : 3}
        placeholder={creation ? t('conceptPlaceholder') : undefined}
        aria-label={t('concept')}
        aria-describedby={`${fieldId}-concept-count`}
        aria-invalid={conceptLength > 3000}
        value={input.concept}
        onChange={(e) => {
          change({ concept: e.target.value })
        }}
      />
      <small id={`${fieldId}-concept-count`}>{t('conceptCount', { count: conceptLength })}</small>
    </label>
  )
  const sourceField = (
    <label className={css.field}>
      {t('source')}
      <textarea
        rows={6}
        value={input.sourceText}
        onChange={(e) => {
          change({ sourceText: e.target.value })
        }}
      />
    </label>
  )
  const specification = (
    <fieldset className={creation ? css.creationFields : css.fields} disabled={disabled}>
      {!creation && <legend>{t('basic')}</legend>}
      <label className={css.field}>
        {t('name')}
        <Input
          required
          aria-label={t('name')}
          aria-describedby={`${fieldId}-name-count`}
          aria-invalid={nameLength > 50}
          value={input.name}
          onChange={(e) => {
            change({ name: e.target.value })
          }}
        />
        <small id={`${fieldId}-name-count`}>{t('nameCount', { count: nameLength })}</small>
      </label>
      {conceptField}
      <fieldset className={css.ratios}>
        <legend>{t('ratio')}</legend>
        {(
          [
            ['16:9', 'landscape'],
            ['9:16', 'portrait'],
            ['1:1', 'square'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={css.choice}>
            <input
              type="radio"
              name={`${fieldId}-ratio`}
              value={value}
              checked={input.aspectRatio === value}
              onChange={() => {
                change({ aspectRatio: value })
              }}
            />
            <span aria-hidden="true" className={clsx(css.frame, label === 'portrait' && css.portrait, label === 'square' && css.square)} />
            <span>{t(label)}</span>
          </label>
        ))}
      </fieldset>
      {!creation && (
        <>
          <div className={css.columns}>
            <label className={css.field}>
              {t('count')}
              <Input
                type="number"
                min={1}
                step={1}
                placeholder={t('unknown')}
                value={input.targetEpisodes ?? ''}
                onChange={(e) => {
                  change({ targetEpisodes: e.target.value === '' ? null : Number(e.target.value) })
                }}
              />
            </label>
            <label className={css.field}>
              {t('duration')}
              <Input
                type="number"
                min={0}
                step="any"
                placeholder={t('unknown')}
                value={input.episodeDuration ?? ''}
                onChange={(e) => {
                  change({ episodeDuration: e.target.value === '' ? null : Number(e.target.value) })
                }}
              />
            </label>
          </div>
          {sourceField}
        </>
      )}
      {!creation && !validInput(input) && <p className={css.validation}>{t('validation')}</p>}
    </fieldset>
  )
  return specification
}
