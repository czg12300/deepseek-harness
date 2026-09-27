/** Persisted production canvas with a floating text-assistant composer. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CanvasNode, Project, ProjectId, ProductionUnit, StudioTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProjectContentActions } from './project-content.ts'
import type { ProjectDraft } from './drafts.ts'
import type { StudioActions, StudioState } from './studio.ts'
import { studioTargetKey } from './studio.ts'
import type { MulticaKey } from './locales.ts'
import css from './Workspace.module.css'

interface Props {
  id: ProjectId
  unit: ProductionUnit
  nodes: CanvasNode[]
  project: Project | undefined
  draft: ProjectDraft | undefined
  studio: StudioState
  studioActions: StudioActions
  contentActions: ProjectContentActions
  t: (key: MulticaKey, params?: Record<string, string | number>) => string
}

/** @param props - selected unit and Host-backed actions. @returns draggable nodes and a floating assistant. */
export function ProductionCanvas({ id, unit, nodes, project, draft, studio, studioActions, contentActions, t }: Props) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ id: CanvasNode['id']; x: number; y: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const drag = useRef<{ node: CanvasNode; startX: number; startY: number } | null>(null)
  const pan = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const target: StudioTarget = unit.episodeId
    ? { kind: 'episode', projectId: id, episodeId: unit.episodeId }
    : { kind: 'outline', projectId: id }
  const key = studioTargetKey(target)
  const workspaceId = studio.bindings[key]
  const query = workspaceId ? studio.byId[workspaceId] : undefined
  const view = query?.view
  const latest = view?.tasks.filter(task => task.status === 'completed' && task.reply).at(-1)
  const backend = studio.catalog?.backendAvailable === true
  useEffect(() => { if (backend) void studioActions.open(target) }, [key, backend, studioActions])
  const guarded = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(null)
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const addText = (): void => { void guarded(() => contentActions.addNode(id, unit.id, 'script', t('canvasText'),
    360 - offset.x, 260 - offset.y, null, '')) }
  const importFile = (file: File): void => {
    if (file.size > 16 * 1024 * 1024) { setError(t('mediaTooLarge')); return }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') void guarded(() => contentActions.importMedia(id, unit.id, file.name, reader.result as string))
    }
    reader.onerror = () => { setError(t('mediaReadFailed')) }
    reader.readAsDataURL(file)
  }
  const send = (): void => {
    if (!workspaceId || !draft || !project || !prompt.trim()) return
    void guarded(async () => {
      await studioActions.send(workspaceId, project.revision, draft.input,
        `${t('productionAiContext', { unit: unit.title })}\n${prompt.trim()}`)
      setPrompt('')
    })
  }
  const dragEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    const current = drag.current
    if (!current) { pan.current = null; return }
    drag.current = null
    setPreview(null)
    const x = Math.max(0, Math.round(current.node.x + (event.clientX - current.startX) / zoom))
    const y = Math.max(0, Math.round(current.node.y + (event.clientY - current.startY) / zoom))
    if (x !== current.node.x || y !== current.node.y)
      void guarded(() => contentActions.moveNode(id, unit.id, current.node.id, current.node.revision, x, y))
  }
  return <main className={css.canvasView}>
    <header className={css.canvasHeader}><div><p>{t('productionUnits')} / {unit.title}</p><h1>{unit.title}</h1></div>
      <div className={css.canvasToolbar}>
        <Button onClick={addText}>{t('addTextNode')}</Button>
        <Button onClick={() => fileInput.current?.click()}>{t('importMedia')}</Button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,audio/mpeg,audio/wav,audio/ogg"
          hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = '' }} />
        <Button onClick={() =>{  setZoom(value => Math.max(0.5, +(value - 0.1).toFixed(1))) }}>−</Button>
        <span>{Math.round(zoom * 100)}%</span>
        <Button onClick={() =>{  setZoom(value => Math.min(2, +(value + 0.1).toFixed(1))) }}>+</Button>
      </div>
    </header>
    {error && <p role="alert" className={css.canvasError}>{error}</p>}
    <div ref={surface} className={css.canvasSurface} onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('article,button')) return
      pan.current = { startX: event.clientX, startY: event.clientY, x: offset.x, y: offset.y }
      surface.current?.setPointerCapture(event.pointerId)
    }} onPointerMove={(event) => {
      if (drag.current) {
        const { node, startX, startY } = drag.current
        setPreview({ id: node.id, x: Math.max(0, Math.round(node.x + (event.clientX - startX) / zoom)),
          y: Math.max(0, Math.round(node.y + (event.clientY - startY) / zoom)) })
      } else if (pan.current) {
        const { startX, startY, x, y } = pan.current
        setOffset({ x: x + event.clientX - startX, y: y + event.clientY - startY })
      }
    }} onPointerUp={dragEnd} onPointerCancel={() => { drag.current = null; pan.current = null; setPreview(null) }}>
      <div className={css.canvasPlane} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
        {nodes.map(node => <article key={node.id} className={css.canvasNode}
          style={{ left: preview?.id === node.id ? preview.x : node.x,
            top: preview?.id === node.id ? preview.y : node.y }} onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest('button,textarea')) return
            drag.current = { node, startX: event.clientX, startY: event.clientY }
            surface.current?.setPointerCapture(event.pointerId)
          }}>
          <span className={css.nodeType}>{t(node.kind === 'script' ? 'scriptNode' : 'mediaNode')}</span>
          <strong>{node.label}</strong>
          {node.text && <p>{node.text}</p>}
        </article>)}
      </div>
      <div className={css.canvasPan}>
        <Button onClick={() =>{  setOffset(value => ({ x: value.x - 120, y: value.y })) }}>←</Button>
        <Button onClick={() =>{  setOffset(value => ({ x: value.x + 120, y: value.y })) }}>→</Button>
        <Button onClick={() =>{  setOffset(value => ({ x: value.x, y: value.y - 120 })) }}>↑</Button>
        <Button onClick={() =>{  setOffset(value => ({ x: value.x, y: value.y + 120 })) }}>↓</Button>
      </div>
    </div>
    <aside className={css.canvasComposer} aria-label={t('productionAi')}>
      <div className={css.row}><strong>{t('productionAi')}</strong><span>{backend ? t('assistantIdle') : t('assistantUnavailable')}</span></div>
      {latest?.reply && <div className={css.canvasReply}>
        <p>{latest.reply}</p>
        <Button disabled={busy} onClick={() => void guarded(() => contentActions.addNode(id, unit.id, 'script', t('canvasText'),
          400 - offset.x, 300 - offset.y, null, latest.reply))}>{t('addAiToCanvas')}</Button>
      </div>}
      {query?.error && <p role="alert">{query.error}</p>}
      <textarea aria-label={t('productionPrompt')} placeholder={t('productionPromptHint')} value={prompt}
        onChange={(event) =>{  setPrompt(event.target.value) }} />
      <div className={css.row}><span>{t('textProductionOnly')}</span>
        <Button variant="primary" disabled={!backend || !workspaceId || !draft || !prompt.trim() || busy || !!query?.busy
          || !!view?.tasks.some(task => task.status === 'running')} onClick={send}>{t('send')}</Button></div>
    </aside>
  </main>
}
