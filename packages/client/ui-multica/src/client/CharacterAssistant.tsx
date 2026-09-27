/** Character-biography text drafting through the existing planner, without applying an outline proposal. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectId, ProjectInput, ScriptDocument, StudioTarget } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProjectContentActions } from './project-content.ts'
import type { StudioActions, StudioState } from './studio.ts'
import { studioTargetKey } from './studio.ts'
import type { MulticaKey } from './locales.ts'
import css from './Workspace.module.css'

interface Props {
  projectId: ProjectId
  document: ScriptDocument
  input: ProjectInput
  revision: number
  disabled: boolean
  studio: StudioState
  studioActions: StudioActions
  contentActions: ProjectContentActions
  t: (key: MulticaKey, params?: Record<string, string | number>) => string
}

/** @param props - character document and planner callbacks. @returns explicit biography save controls. */
export function CharacterAssistant({ projectId, document, input, revision, disabled, studio, studioActions,
  contentActions, t }: Props) {
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target: StudioTarget = { kind: 'outline', projectId }
  const key = studioTargetKey(target)
  const workspaceId = studio.bindings[key]
  const query = workspaceId ? studio.byId[workspaceId] : undefined
  const view = query?.view
  const prefix = t('characterAiPrefix')
  const lastTask = view?.tasks.filter(task => task.prompt.startsWith(prefix)).at(-1)
  const proposal = view?.proposals.find(item => item.taskId === lastTask?.id)
  const generated = proposal?.changes.find(change => change.field === 'outline')?.after
  const biography = typeof generated === 'string' ? generated : null
  const backend = studio.catalog?.backendAvailable === true
  useEffect(() => { if (backend) void studioActions.open(target) }, [key, backend, studioActions])
  const send = (): void => {
    if (!workspaceId || !prompt.trim()) return
    setError(null)
    void studioActions.send(workspaceId, revision, input, `${prefix}\n${prompt.trim()}`).then(() => { setPrompt('') })
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }
  const apply = (): void => {
    if (!biography) return
    setSaving(true); setError(null)
    void contentActions.saveDocument(projectId, document.id, document.revision, `# 人物小传\n\n${biography}`)
      .catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setSaving(false) })
  }
  return <aside className={css.professional} aria-label={t('characterAssistant')}>
    <header className={css.professionalHead}><h2>{t('characterAssistant')}</h2></header>
    <p className={css.assistantMission}>{t('characterAiHint')}</p>
    {lastTask && <div className={css.dialogue}>
      <p>{lastTask.prompt}</p>
      {lastTask.reply && <p>{lastTask.reply}</p>}
      {lastTask.error && <p role="alert">{lastTask.error}</p>}
      {biography && <article className={css.proposalCard}><h3>{t('characterBiography')}</h3>
        <pre className={css.proposedText}>{biography}</pre>
        <Button variant="primary" disabled={disabled || saving || `# 人物小传\n\n${biography}` === document.markdown}
          onClick={apply}>{t('saveBiography')}</Button></article>}
    </div>}
    {query?.error && <p role="alert">{query.error}</p>}
    {error && <p role="alert">{error}</p>}
    <div className={css.assistantComposer}>
      <textarea aria-label={t('characterRequest')} value={prompt} placeholder={t('characterRequestHint')}
        onChange={(event) => { setPrompt(event.target.value) }} />
      <Button variant="primary" disabled={disabled || !backend || !workspaceId || !prompt.trim() || !!query?.busy
        || !!view?.tasks.some(task => task.status === 'running')} onClick={send}>{t('send')}</Button>
    </div>
  </aside>
}
