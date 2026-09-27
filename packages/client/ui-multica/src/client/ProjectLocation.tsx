/** Directory ownership and portable project lifecycle controls. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ProjectId, ProjectInput, StudioCreationId, StudioFolderId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MulticaDrafts, ProjectDraft } from './drafts.ts'
import type { ProjectQueries } from './projects.ts'
import css from './Workspace.module.css'

/** Host operations with no direct filesystem access in the browser. */
export interface PortableProjectActions {
  pick(this: void): Promise<string | null>
  reveal(this: void, id: StudioFolderId): Promise<void>
  open(this: void, path: string): Promise<void>
  prepare(this: void, path: string, id: StudioCreationId, input: ProjectInput): Promise<void>
  close(this: void, id: StudioFolderId, state: MulticaDrafts): Promise<void>
  forget(this: void, id: StudioFolderId): Promise<void>
  backup(this: void, id: StudioFolderId, path: string, state: MulticaDrafts): Promise<void>
  migrate(this: void, id: ProjectId, path: string): Promise<void>
  autosave(this: void, id: ProjectId, draft: ProjectDraft): Promise<void>
  select(this: void, id: StudioFolderId | undefined): void
}

/**
 * @param props - selected project, recent paths, and host callbacks.
 * @returns directory and close controls.
 */
export function ProjectLocation({ state, queries, portable, t }: PropsLocale<'multica'> & {
  state: MulticaDrafts
  queries: ProjectQueries
  portable: PortableProjectActions
}) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [buffer, setBuffer] = useState<'saving' | 'saved' | 'failed' | null>(null)
  const editGeneration = useRef(0)
  const folder = queries.folders?.find(item => state.creating
    ? item.creationId === state.creationId
    : state.selected !== null && item.projectId === state.selected)
  const draft = state.selected ? state.drafts[state.selected] : undefined
  useEffect(() => { portable.select(folder?.state === 'open' ? folder.id : undefined) }, [folder?.id, folder?.state, portable])
  useEffect(() => {
    const generation = ++editGeneration.current
    if (!state.selected || !draft?.dirty || !folder) return
    setBuffer('saving')
    void portable.autosave(state.selected, draft).then(
      () => { if (editGeneration.current === generation) { setBuffer('saved'); setError(null) } },
      (reason: unknown) => {
        if (editGeneration.current !== generation) return
        setBuffer('failed')
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => { editGeneration.current++ }
  }, [state.selected, draft?.edit, draft?.dirty, folder?.id, portable])
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true); setError(null)
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const locationInput = <div className={css.row}>
    <label className={css.field}>
      {t('projectDirectory')}
      <Input aria-label={t('projectDirectory')} value={path} placeholder={t('directoryPlaceholder')} disabled={busy}
        onChange={(event) =>{  setPath(event.target.value) }} />
    </label>
    <Button type="button" disabled={busy} onClick={() => void run(async () => {
      const chosen = await portable.pick()
      if (!chosen) return
      setPath(chosen)
      if (state.creating) await portable.prepare(chosen, state.creationId, state.createInput)
    })}>{t('chooseDirectory')}</Button>
  </div>
  return <div className={state.creating ? `${css.projectLocation} ${css.creationLocation}` : css.projectLocation} aria-label={t('projectFiles')}>
    {folder ? <>
      <div className={css.row}>
        <strong>{t('projectDirectory')}</strong><span>{folder.path}</span>
        <span>{t(folder.state === 'missing' ? 'diskOffline' : folder.state === 'closed' ? 'directoryClosed' : 'portableProject')}</span>
      </div>
      {state.creating && <p>{t('workFolderReady')}</p>}
      <div className={css.row}>
        <Button type="button" disabled={busy || folder.state !== 'open'} onClick={() => void run(() => portable.reveal(folder.id))}>{t('revealProjectDirectory')}</Button>
        {!state.creating && <Button type="button" disabled={busy || folder.state !== 'open'} onClick={() => { setConfirmClose(true) }}>{t('closeProject')}</Button>}
        {folder.state !== 'open' && <Button type="button" disabled={busy} onClick={() => void run(() => portable.open(folder.path))}>{t('open')}</Button>}
        {draft?.dirty && <span role="status">{t(buffer === 'saved' ? 'bufferSaved' : buffer === 'failed' ? 'bufferFailed' : 'saving')}</span>}
      </div>
      {confirmClose && <div>
        <p>{t('closeProjectHint')}</p>
        <Button type="button" disabled={busy} onClick={() => void run(async () => {
          await portable.close(folder.id, state)
          setConfirmClose(false)
        })}>{t('saveAndClose')}</Button>
        <Button type="button" disabled={busy} onClick={() =>{  setConfirmClose(false) }}>{t('cancel')}</Button>
      </div>}
      {state.selected && state.pages[state.selected] === 'settings' && <>
        {locationInput}
        <Button type="button" disabled={busy || !path.trim()} onClick={() => void run(async () => {
          await portable.backup(folder.id, path, state)
        })}>{t('backupAndClose')}</Button>
      </>}
    </> : <>
      {locationInput}
      {state.creating ? <>
        <p>{t('chooseBeforeCreate')}</p>
        <Button type="button" disabled={busy || !path.trim()} onClick={() => void run(() => portable.prepare(path, state.creationId, state.createInput))}>{t('useProjectDirectory')}</Button>
      </> : state.selected ? <>
        <p>{t('legacyProjectHint')}</p>
        <Button type="button" disabled={busy || !path.trim() || !!draft?.dirty} onClick={() => void run(async () => { if (state.selected) await portable.migrate(state.selected, path) })}>{t('moveIntoDirectory')}</Button>
      </> : <Button type="button" disabled={busy || !path.trim()} onClick={() => void run(() => portable.open(path))}>{t('openProjectDirectory')}</Button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {!state.selected && !state.creating && (queries.folders?.length ?? 0) > 0 && <details>
      <summary>{t('recentDirectories')}</summary>
      {queries.folders?.map(item => <div className={css.row} key={item.id}>
        <span>{item.name || t('creationDraft')} · {item.path}</span>
        <span>{t(item.state === 'missing' ? 'diskOffline' : item.state === 'open' ? 'directoryOpen' : 'directoryClosed')}</span>
        <Button type="button" disabled={busy} onClick={() => void run(() => portable.open(item.path))}>{t('open')}</Button>
        <Button type="button" disabled={busy} onClick={() => void run(() => portable.forget(item.id))}>{t('forgetDirectory')}</Button>
      </div>)}
    </details>}
  </div>
}
