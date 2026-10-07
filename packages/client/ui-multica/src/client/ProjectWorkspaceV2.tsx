/** Project directory, Markdown reader and stage-dependent production views. */
import { useEffect, useState } from 'react'
import { Button, Input, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { EpisodeId, ProductionUnit, ProjectId, StudioTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceProps } from './Workspace.tsx'
import type { MulticaDrafts, ProjectPage } from './drafts.ts'
import { validInput } from './drafts.ts'
import type { ProjectQueries } from './projects.ts'
import type { StudioState } from './studio.ts'
import type { ProjectContentState } from './project-content.ts'
import { AssistantPanel } from './AssistantPanel.tsx'
import { CharacterAssistant } from './CharacterAssistant.tsx'
import { ProductionCanvas } from './ProductionCanvas.tsx'
import { ProjectAssets } from './ProjectAssets.tsx'
import css from './Workspace.module.css'

type Props = WorkspaceProps & {
  state: MulticaDrafts
  queries: ProjectQueries
  studio: StudioState
  content: ProjectContentState
  id: ProjectId
  choose: (id: ProjectId) => void
}

/** @param props - selected project, saved content and registered callbacks. @returns the project workspace. */
export function ProjectWorkspaceV2({ state, queries, studio, content, id, choose, actions, save, contentActions,
  studioActions, t, renderSlot }: Props) {
  const page = state.pages[id]
  const query = queries.byId[id]
  const project = query?.project
  const draft = state.drafts[id]
  const current = content.projectId === id ? content : null
  const docs = current?.documents ?? []
  const units = current?.units ?? []
  const assets = current?.assets ?? []
  const selectedDoc = docs.find(doc => doc.id === page || doc.episodeId === page)
    ?? (page === 'outline' || page === 'episodes' ? docs[0] : undefined)
  const selectedUnit = units.find(unit => unit.id === page)
  const assetsSelected = page === 'assets'
  const [editing, setEditing] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [creatingEpisode, setCreatingEpisode] = useState(false)
  const [episodeTitle, setEpisodeTitle] = useState('')
  const [unitKind, setUnitKind] = useState<ProductionUnit['kind']>('episode')
  const [unitEpisode, setUnitEpisode] = useState<EpisodeId | null>(null)
  const [unitTitle, setUnitTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void contentActions.load(id) }, [id, contentActions])
  useEffect(() => { if (selectedUnit) void contentActions.loadNodes(id, selectedUnit.id) }, [id, selectedUnit?.id, contentActions])
  useEffect(() => { setEditing(false); setMarkdown(selectedDoc?.markdown ?? '') }, [selectedDoc?.id])
  const run = async (operation: () => Promise<void>): Promise<void> => {
    if (saving) return
    setSaving(true); setError(null)
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  const setPage = (next: ProjectPage): void => { actions.page(id, next) }
  const confirmScript = (): void => { if (project) void run(() => contentActions.confirm(id, project.revision)) }
  const createUnit = (): void => {
    void run(async () => {
      const episodeId = unitKind === 'episode' ? unitEpisode ?? project?.episodes[0]?.id ?? null : null
      const created = await contentActions.createUnit(id, unitKind, episodeId, unitTitle)
      setCreatingUnit(false)
      setPage(created.id)
    })
  }
  const createEpisode = (): void => {
    if (!draft || !project || !episodeTitle.trim() || draft.dirty || draft.conflict) return
    void run(async () => {
      const episodeId = randomUUID() as EpisodeId
      const saved = await save(id, { ...draft, input: { ...draft.input,
        episodes: [...draft.input.episodes, { id: episodeId, title: episodeTitle.trim(), script: '' }],
      }, dirty: true })
      if (!saved) throw new Error(t('failed'))
      await contentActions.load(id)
      setCreatingEpisode(false)
      setPage(episodeId)
    })
  }
  const selectedEpisode = project?.episodes.find(episode => episode.id === selectedDoc?.episodeId)
  const target: StudioTarget = selectedEpisode
    ? { kind: 'episode', projectId: id, episodeId: selectedEpisode.id }
    : { kind: 'outline', projectId: id }
  return <div className={css.projectV2}>
    <nav className={css.projectDirectory} aria-label={t('projectDirectoryNav')}>
      <div className={css.directoryHead}>
        <p>{t('studio')} / {t('home')}</p>
        <strong>{project?.name ?? t('loading')}</strong>
      </div>
      <Button onClick={() => { actions.home() }}>{t('back')}</Button>
      <label className={css.field}>{t('selectProject')}
        <select value={id} onChange={(event) => {
          if (event.target.value === 'all') actions.home()
          else if (event.target.value === 'new') actions.startCreate()
          else choose(event.target.value as ProjectId)
        }}>
          <option value="all">{t('home')}</option>
          {queries.list.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          <option value="new">{t('newProject')}</option>
        </select>
      </label>
      <p className={css.directoryCaption}>{t('projectDirectoryNav')}</p>
      <div className={css.directorySection}>
        <strong>{t('storyScripts')}</strong>
        {docs.map(doc => <Button key={doc.id} className={selectedDoc?.id === doc.id ? css.selected : undefined}
          aria-current={selectedDoc?.id === doc.id ? 'page' : undefined}
          onClick={() => { setPage(doc.id) }}>{doc.title}</Button>)}
        <Button variant="outline" disabled={!project || project.archived || !!draft?.dirty || !!draft?.conflict}
          onClick={() => { setEpisodeTitle(t('episodeDefault', { count: (project?.episodes.length ?? 0) + 1 })); setCreatingEpisode(true) }}>
          {t('addEpisode')}</Button>
      </div>
      <div className={css.directorySection}>
        <Button className={selectedUnit ? css.selected : undefined} disabled={!current?.complete}
          title={!current?.complete ? t('finishScriptFirst') : undefined}
          onClick={() => { if (units[0]) setPage(units[0].id) }}>{t('productionUnits')}</Button>
        {!current?.complete && <small>{t('finishScriptFirst')}</small>}
        {current?.complete && <>
          {units.filter(unit => unit.kind === 'episode').map(unit => <Button key={unit.id}
            className={selectedUnit?.id === unit.id ? css.selected : undefined}
            onClick={() => { setPage(unit.id) }}>{unit.title}</Button>)}
          {units.filter(unit => unit.kind === 'whole').map(unit => <Button key={unit.id}
            className={selectedUnit?.id === unit.id ? css.selected : undefined}
            onClick={() => { setPage(unit.id) }}>{unit.title}</Button>)}
          <Button variant="outline" onClick={() => {
            setUnitKind('episode'); setUnitEpisode(project?.episodes[0]?.id ?? null)
            setUnitTitle(t('firstProductionUnit')); setCreatingUnit(true)
          }}>{t('newProductionUnit')}</Button>
        </>}
      </div>
      <div className={css.directorySection}>
        <Button disabled={assets.length === 0} title={!assets.length ? t('mediaUnavailable') : undefined}
          className={assetsSelected ? css.selected : undefined} onClick={() => { setPage('assets') }}>{t('projectAssets')}</Button>
        {assets.length === 0 && <small>{t('mediaUnavailable')}</small>}
        {assets.length > 0 && <small>{t('assetTotal', { count: assets.length })}</small>}
      </div>
      <div className={css.directoryFoot}>
        <Button onClick={() => { setPage('reviews') }}>{t('review')}</Button>
        <Button onClick={() => { setPage('history') }}>{t('history')}</Button>
        <Button onClick={() => { setPage('settings') }}>{t('settings')}</Button>
      </div>
    </nav>
    {selectedUnit && current ? <ProductionCanvas id={id} unit={selectedUnit} nodes={current.nodes[selectedUnit.id] ?? []}
      project={project ?? undefined} draft={draft} studio={studio} studioActions={studioActions}
      contentActions={contentActions} t={t} />
      : assetsSelected && current ? <ProjectAssets id={id} assets={assets} contentActions={contentActions} t={t} />
        : <main className={css.scriptBrowser}>
          <header className={css.scriptBrowserHead}>
            <div><p>{t('storyScripts')} / {selectedDoc?.title ?? t('loading')}</p>
              <h1>{selectedDoc?.title.replace(/\.md$/, '') ?? t('storyScripts')}</h1></div>
            {project && <span className={css.badge}>{t('revision', { revision: project.revision })}</span>}
          </header>
          {current?.error && <p role="alert">{current.error}</p>}
          {error && <p role="alert">{error}</p>}
          {selectedDoc && <article className={css.markdownPaper}>
            <p className={css.eyebrow}>{t('markdownDocument')}</p>
            <MarkdownText text={selectedDoc.markdown} labels={{
              code: { copyLabel: t('copyMarkdown'), copiedLabel: t('copiedMarkdown') }, footnotes: t('markdownFootnotes'),
            }} />
            <footer className={css.documentActions}>
              <span>{selectedDoc.relativePath}</span>
              <Button disabled={!!project?.archived} onClick={() => { setMarkdown(selectedDoc.markdown); setEditing(true) }}>{t('editMarkdown')}</Button>
            </footer>
          </article>}
          {!current?.complete && project && <div className={css.scriptConfirm}>
            <p>{t('finishScriptFirst')}</p>
            <Button disabled={saving || !!draft?.dirty || project.archived || !project.outline.trim()
              || project.episodes.length === 0 || project.episodes.some(episode => !episode.script.trim())}
            onClick={confirmScript}>{t('confirmScript')}</Button>
          </div>}
          {current?.complete && <p role="status">{t('scriptConfirmed')}</p>}
        </main>}
    {selectedDoc && !assetsSelected && !selectedUnit && draft && (selectedDoc.kind === 'characters'
      ? <CharacterAssistant projectId={id} document={selectedDoc} input={draft.input} revision={draft.baseRevision}
        disabled={!!project?.archived || draft.conflict || !validInput(draft.input)} studio={studio}
        studioActions={studioActions} contentActions={contentActions} t={t} />
      : <AssistantPanel renderSlot={renderSlot} state={state} studio={studio} studioActions={studioActions}
        actions={actions} target={target} input={draft.input} revision={draft.baseRevision}
        disabled={!!project?.archived || draft.conflict || !validInput(draft.input)} t={t} />)}
    <Modal open={editing} onClose={() => { if (!saving) setEditing(false) }} title={t('editMarkdown')}
      closeLabel={t('cancel')} className={css.markdownEditorDialog ?? ''} footer={<>
        <Button disabled={saving} onClick={() => { setEditing(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving || !selectedDoc || markdown === selectedDoc.markdown}
          onClick={() => void run(async () => {
            if (!selectedDoc) return
            await contentActions.saveDocument(id, selectedDoc.id, selectedDoc.revision, markdown)
            setEditing(false)
          })}>{t('save')}</Button>
      </>}>
      <textarea aria-label={t('markdownSource')} value={markdown}
        onChange={(event) => { setMarkdown(event.target.value) }} />
      {error && <p role="alert">{error}</p>}
    </Modal>
    <Modal open={creatingUnit} onClose={() => { if (!saving) setCreatingUnit(false) }} title={t('newProductionUnit')}
      closeLabel={t('cancel')} footer={<>
        <Button onClick={() => { setCreatingUnit(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving || !unitTitle.trim() || (unitKind === 'episode' && !unitEpisode)}
          onClick={createUnit}>{t('createProductionUnit')}</Button>
      </>}>
      <div className={css.unitForm}>
        <label className={css.field}>{t('productionTemplate')}
          <select value={unitKind} onChange={(event) => {
            const kind = event.target.value as ProductionUnit['kind']
            setUnitKind(kind); setUnitTitle(kind === 'episode' ? t('firstProductionUnit') : t('wholeProductionUnit'))
          }}>
            <option value="episode">{t('episodeProduction')}</option>
            <option value="whole">{t('wholeProduction')}</option>
          </select>
        </label>
        {unitKind === 'episode' && <label className={css.field}>{t('selectEpisode')}
          <select value={unitEpisode ?? ''} onChange={(event) => { setUnitEpisode(event.target.value as EpisodeId) }}>
            {project?.episodes.map(episode => <option key={episode.id} value={episode.id}>{episode.title}</option>)}
          </select>
        </label>}
        <label className={css.field}>{t('name')}<Input value={unitTitle} onChange={(event) => { setUnitTitle(event.target.value) }} /></label>
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
    <Modal open={creatingEpisode} onClose={() => { if (!saving) setCreatingEpisode(false) }} title={t('addEpisode')}
      closeLabel={t('cancel')} footer={<>
        <Button onClick={() =>{  setCreatingEpisode(false) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving || !episodeTitle.trim()} onClick={createEpisode}>{t('addEpisode')}</Button>
      </>}>
      <label className={css.field}>{t('episodeTitle')}
        <Input value={episodeTitle} onChange={(event) =>{  setEpisodeTitle(event.target.value) }} /></label>
      {error && <p role="alert">{error}</p>}
    </Modal>
  </div>
}
