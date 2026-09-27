/** Project media catalog and original-file preview. */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectId, ProjectMediaAsset } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProjectContentActions } from './project-content.ts'
import type { MulticaKey } from './locales.ts'
import css from './Workspace.module.css'

interface Props {
  id: ProjectId
  assets: ProjectMediaAsset[]
  contentActions: ProjectContentActions
  t: (key: MulticaKey, params?: Record<string, string | number>) => string
}

function AssetThumb({ id, asset, contentActions, label }: {
  id: ProjectId
  asset: ProjectMediaAsset
  contentActions: ProjectContentActions
  label: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (asset.kind !== 'image' || !element.current) return
    if (!('IntersectionObserver' in window)) { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => { if (entries.some(entry => entry.isIntersecting)) setVisible(true) })
    observer.observe(element.current)
    return () => { observer.disconnect() }
  }, [asset.id, asset.kind])
  useEffect(() => {
    if (!visible || asset.kind !== 'image') return
    let active = true
    void contentActions.mediaData(id, asset.id).then((data) => { if (active) setSrc(data) }).catch(() => {})
    return () => { active = false }
  }, [visible, id, asset.id, asset.kind, contentActions])
  return <div ref={element} className={css.assetThumb}>
    {src ? <img src={src} alt="" loading="lazy" /> : <span>{asset.kind === 'image' ? '▧' : asset.kind === 'video' ? '▶' : '♫'}</span>}
    <small>{label}</small>
  </div>
}

/** @param props - indexed media and read-only preview callback. @returns filterable cards and a media dialog. */
export function ProjectAssets({ id, assets, contentActions, t }: Props) {
  const [kind, setKind] = useState<'all' | ProjectMediaAsset['kind']>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ProjectMediaAsset | null>(null)
  const [data, setData] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    let active = true
    setData(null); setError(null); setZoom(1)
    if (selected) void contentActions.mediaData(id, selected.id).then((value) => {
      if (active) setData(value)
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [id, selected?.id, contentActions])
  const shown = assets.filter(asset => (kind === 'all' || asset.kind === kind)
    && asset.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const label = (value: ProjectMediaAsset['kind']): string => t(value === 'image' ? 'images' : value === 'video' ? 'videos' : 'audios')
  return <main className={css.assetsView}>
    <header className={css.assetsHeader}><div><p>{t('studio')} / {t('projectAssets')}</p><h1>{t('projectAssets')}</h1>
      <span>{t('assetTotal', { count: assets.length })}</span></div>
    <Button onClick={() => { setKind('all'); setSearch('') }}>{t('refresh')}</Button></header>
    <div className={css.assetFilters} role="group" aria-label={t('assetFilter')}>
      {(['all', 'image', 'video', 'audio'] as const).map(value => <Button key={value}
        className={kind === value ? css.selected : undefined} onClick={() =>{  setKind(value) }}>
        {value === 'all' ? t('allAssets') : label(value)}</Button>)}
      <input aria-label={t('searchAssets')} placeholder={t('searchAssets')} value={search}
        onChange={(event) =>{  setSearch(event.target.value) }} />
    </div>
    {shown.length === 0 ? <p className={css.assetEmpty}>{t('noAssets')}</p> : <div className={css.assetGrid}>
      {shown.map(asset => <button type="button" className={css.assetCard} key={asset.id} onClick={() =>{  setSelected(asset) }}>
        <AssetThumb id={id} asset={asset} contentActions={contentActions} label={label(asset.kind)} />
        <strong>{asset.name}</strong><p>{t('mediaSize', { size: (asset.byteSize / 1024 / 1024).toFixed(1) })}</p>
      </button>)}
    </div>}
    <Modal open={!!selected} onClose={() =>{  setSelected(null) }} title={selected?.name ?? t('assetPreview')}
      closeLabel={t('cancel')} className={css.assetPreviewDialog ?? ''}>
      {selected && <div className={css.assetPreview}>
        <div className={css.assetPreviewStage}>
          {error && <p role="alert">{error}</p>}
          {!data && !error && <p>{t('loading')}</p>}
          {data && selected.kind === 'image' && <img src={data} alt={selected.name}
            style={{ transform: `scale(${zoom})` }} />}
          {data && selected.kind === 'video' && <video src={data} controls playsInline aria-label={selected.name} />}
          {data && selected.kind === 'audio' && <audio src={data} controls aria-label={selected.name} />}
        </div>
        <aside><strong>{selected.name}</strong><p>{label(selected.kind)} · {selected.mime}</p>
          <p>{t('mediaSize', { size: (selected.byteSize / 1024 / 1024).toFixed(1) })}</p>
          {selected.kind === 'image' && <div className={css.row}>
            <Button onClick={() =>{  setZoom(value => Math.max(0.5, +(value - 0.25).toFixed(2))) }}>−</Button>
            <span>{Math.round(zoom * 100)}%</span>
            <Button onClick={() =>{  setZoom(value => Math.min(4, +(value + 0.25).toFixed(2))) }}>+</Button>
            <Button onClick={() =>{  setZoom(1) }}>{t('originalSize')}</Button>
          </div>}
          {data && <a href={data} download={selected.name}>{t('downloadOriginal')}</a>}
        </aside>
      </div>}
    </Modal>
  </main>
}
