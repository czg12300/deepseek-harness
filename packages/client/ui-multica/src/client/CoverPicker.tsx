/** Custom cover uploads belong to saved project cards, outside the creation form and model context. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectId, ProjectSummary } from '@deepseek-ai/dsh-api-remotes/client'
import css from './Workspace.module.css'

type CoverProps = PropsLocale<'multica'> & {
  project: ProjectSummary
  maxBytes: number | null
  status: { saving: boolean; error: boolean } | undefined
  setCover: (id: ProjectId, revision: number, image: string | null) => Promise<void>
}

/** @param props - persisted cover, upload policy and explicit replacement action. @returns cover preview and upload controls. */
export function CoverPicker({ project, maxBytes, status, setCover, t }: CoverProps) {
  const reader = useRef<FileReader | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => () => { reader.current?.abort() }, [])
  const disabled = project.archived || reading || status?.saving || maxBytes === null
  return (
    <div className={css.coverArea}>
      <div className={css.cover}>
        {project.cover.image ? <img src={project.cover.image} alt={t('coverAlt', { name: project.name })} /> : <>
          <span aria-hidden="true">{Array.from(project.name)[0]}</span>
          <small>{t('noCover')}</small>
        </>}
      </div>
      {!project.archived && <div className={css.coverActions}>
        <label className={css.coverUpload}>
          {t(project.cover.image ? 'replaceCover' : 'uploadCover')}
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
            aria-label={t(project.cover.image ? 'replaceCover' : 'uploadCover')}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file || maxBytes === null) return
              setError(false)
              if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > maxBytes) {
                setError(true)
                return
              }
              const current = new FileReader()
              reader.current = current
              setReading(true)
              current.onerror = () => { setReading(false); setError(true) }
              current.onload = () => {
                setReading(false)
                void setCover(project.id, project.cover.revision, current.result as string)
              }
              current.readAsDataURL(file)
            }} />
        </label>
        {project.cover.image && <Button disabled={disabled} onClick={() => {
          void setCover(project.id, project.cover.revision, null)
        }}>{t('removeCover')}</Button>}
        {(reading || status?.saving) && <small role="status">{t('saving')}</small>}
      </div>}
      {(error || status?.error) && <p role="alert" className={css.coverError}>{t('coverFailed', { bytes: maxBytes })}</p>}
    </div>
  )
}
