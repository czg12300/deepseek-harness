/** Independent actor-library catalog and manual actor editor. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ActorId, ActorInput } from '@deepseek-ai/dsh-api-remotes/client'
import type { ActorActions, ActorState } from './actors.ts'
import { CatalogTabs } from './CatalogTabs.tsx'
import css from './Workspace.module.css'

const emptyActor = (): ActorInput => ({ name: '', description: '', period: '', region: '', portrait: null, fullBody: null })

/** Read a user-selected image into the Remote's bounded data URL form. */
function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)
    return Promise.reject(new Error('Choose a PNG, JPEG or WebP image under 2 MiB'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read image'))
    }
    reader.onerror = () =>{  reject(reader.error ?? new Error('Could not read image')) }
    reader.readAsDataURL(file)
  })
}

/** @param props - actor view, host callbacks and locale. @returns library catalog and editor. */
export function ActorLibraryPage({ state, actors, projects, t }: PropsLocale<'multica'> & {
  state: ActorState
  actors: ActorActions
  projects: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [libraryName, setLibraryName] = useState('')
  const [editing, setEditing] = useState<ActorId | 'new' | null>(null)
  const [draft, setDraft] = useState<ActorInput>(emptyActor)
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const mergeChoice = useRef(false)
  useEffect(() => { void actors.load() }, [actors])
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (localBusy) return
    setLocalBusy(true); setLocalError(null)
    try { await operation() } catch (error) { setLocalError(error instanceof Error ? error.message : String(error)) }
    finally { setLocalBusy(false) }
  }
  const openActor = (id: ActorId): void => {
    void run(async () => {
      const actor = await actors.actor(id)
      if (!actor) throw new Error(t('actorMissing'))
      setDraft({ name: actor.name, description: actor.description, period: actor.period,
        region: actor.region, portrait: actor.portrait, fullBody: actor.fullBody })
      setEditing(id)
    })
  }
  const upload = (key: 'portrait' | 'fullBody', file: File | undefined): void => {
    if (!file) return
    void run(async () => { const value = await readImage(file); setDraft(current => ({ ...current, [key]: value })) })
  }
  const importFile = (file: File | undefined): void => {
    if (!file) return
    void run(async () => {
      if (!file.name.toLowerCase().endsWith('.zip') || file.size > 32 * 1024 * 1024)
        throw new Error(t('actorZipLimit'))
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      await actors.import(`data:application/zip;base64,${btoa(binary)}`, mergeChoice.current)
    })
    if (fileInput.current) fileInput.current.value = ''
  }
  const exportLibrary = (): void => {
    void run(async () => {
      const archive = await actors.export()
      const link = document.createElement('a')
      link.href = archive.dataUrl; link.download = archive.name
      document.body.append(link); link.click(); link.remove()
    })
  }
  const selected = state.libraries.find(item => item.id === state.selected)
  return <div className={css.actorHome}>
    <header className={css.heading}>
      <div>
        <p className={css.eyebrow}>{t('studio')}</p>
        <CatalogTabs active="actors" projects={projects} actors={() => {}} t={t} />
        <p>{t('actorLibraryHint')}</p>
      </div>
      <div className={css.row}>
        <Button variant="outline" onClick={() => { setLibraryName(''); setCreating(true) }}>{t('createActorLibrary')}</Button>
        <Button variant="outline" onClick={() => { mergeChoice.current = false; fileInput.current?.click() }}>{t('importActorLibrary')}</Button>
        <Button variant="outline" disabled={!selected} onClick={() => { mergeChoice.current = true; fileInput.current?.click() }}>
          {t('mergeActorLibrary')}
        </Button>
        <Button variant="outline" disabled={!selected || localBusy} onClick={exportLibrary}>{t('exportActorLibrary')}</Button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" aria-label={t('actorZip')}
          className={css.actorHiddenInput} onChange={(event) => { importFile(event.target.files?.[0]) }} />
      </div>
    </header>
    <div id="multica-actors-panel" role="tabpanel" aria-labelledby="multica-actors-tab">
      <div className={css.actorToolbar}>
        <label>{t('selectedActorLibrary')}
          <select value={state.selected ?? ''} onChange={(event) => { void actors.select(event.target.value as typeof state.selected & string) }}>
            {state.libraries.length === 0 && <option value="">{t('noActorLibrary')}</option>}
            {state.libraries.map(item => <option key={item.id} value={item.id}>{item.name} · {item.actorCount}</option>)}
          </select>
        </label>
        <Input aria-label={t('searchActors')} placeholder={t('searchActors')} value={state.search}
          onChange={(event) => { void actors.filter(event.target.value, state.period, state.region) }} />
        <Input aria-label={t('actorPeriod')} placeholder={t('actorPeriod')} value={state.period}
          onChange={(event) => { void actors.filter(state.search, event.target.value, state.region) }} />
        <Input aria-label={t('actorRegion')} placeholder={t('actorRegion')} value={state.region}
          onChange={(event) => { void actors.filter(state.search, state.period, event.target.value) }} />
        <Button disabled={!selected} onClick={() => { setDraft(emptyActor()); setEditing('new') }}>{t('addActor')}</Button>
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      {localError && <p role="alert">{localError}</p>}
      {state.importResult && <p role="status">{t('actorImportResult', {
        added: state.importResult.added, skipped: state.importResult.skipped, conflicts: state.importResult.conflicts,
      })}</p>}
      {!selected && <div className={css.actorEmpty}>{t('actorLibraryEmpty')}</div>}
      {selected && <>
        <p role="status">{t('actorCount', { count: state.page.total })}</p>
        <div className={css.actorGrid}>
          {state.page.actors.map(actor => <button key={actor.id} className={css.actorCard} aria-label={actor.name}
            onClick={() => { openActor(actor.id) }}>
            {actor.portrait ? <img src={actor.portrait} alt="" /> : <span className={css.actorInitial}>{actor.name.slice(0, 1)}</span>}
            <span className={css.actorCardLabel}>{actor.name}</span>
            <small>{[actor.period, actor.region].filter(Boolean).join(' · ')}</small>
          </button>)}
        </div>
        {state.page.actors.length < state.page.total && <Button disabled={state.busy} onClick={() => void actors.more()}>{t('loadMoreActors')}</Button>}
      </>}
      <Modal open={creating} onClose={() => { if (!localBusy) setCreating(false) }} title={t('createActorLibrary')}
        closeLabel={t('cancel')} footer={<>
          <Button onClick={() => { setCreating(false) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!libraryName.trim() || localBusy} onClick={() => void run(async () => {
            await actors.create(libraryName); setCreating(false)
          })}>{t('createActorLibrary')}</Button>
        </>}>
        <label className={css.field}>{t('actorLibraryName')}
          <Input value={libraryName} onChange={(event) => { setLibraryName(event.target.value) }} />
        </label>
      </Modal>
      <Modal open={editing !== null} onClose={() => { if (!localBusy) setEditing(null) }} title={t(editing === 'new' ? 'addActor' : 'editActor')}
        closeLabel={t('cancel')} footer={<>
          <Button onClick={() => { setEditing(null) }}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!draft.name.trim() || localBusy} onClick={() => void run(async () => {
            await actors.save(editing === 'new' ? null : editing, draft); setEditing(null)
          })}>{t('saveActor')}</Button>
        </>}>
        <div className={css.actorFields}>
          <label className={css.field}>{t('actorName')}<Input value={draft.name} onChange={(event) => { setDraft(current => ({ ...current, name: event.target.value })) }} /></label>
          <label className={css.field}>{t('actorDescription')}
            <textarea value={draft.description}
              onChange={(event) => { setDraft(current => ({ ...current, description: event.target.value })) }} />
          </label>
          <label className={css.field}>{t('actorPeriod')}<Input value={draft.period} onChange={(event) => { setDraft(current => ({ ...current, period: event.target.value })) }} /></label>
          <label className={css.field}>{t('actorRegion')}
            <Input value={draft.region} onChange={(event) => { setDraft(current => ({ ...current, region: event.target.value })) }} />
          </label>
          {(['portrait', 'fullBody'] as const).map(key => <label className={css.field} key={key}>
            {t(key === 'portrait' ? 'actorPortrait' : 'actorFullBody')}
            {draft[key] && <img className={css.actorPreview} src={draft[key]} alt="" />}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { upload(key, event.target.files?.[0]) }} />
            {draft[key] && <Button type="button" onClick={(event) => { event.preventDefault(); setDraft(current => ({ ...current, [key]: null })) }}>{t('removeImage')}</Button>}
          </label>)}
        </div>
      </Modal>
    </div>
  </div>
}
