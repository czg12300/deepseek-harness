/** Switch between project and actor catalogs within one Multica workspace. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './Workspace.module.css'

/** @param props - active catalog, selection callbacks, and locale. @returns the two catalog tabs. */
export function CatalogTabs({ active, projects, actors, t }: PropsLocale<'multica'> & {
  active: 'projects' | 'actors'
  projects: () => void
  actors: () => void
}) {
  return <>
    <div className={css.catalogTabs} role="tablist" aria-label={t('catalogTabs')}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const next = active === 'projects' ? 'actors' : 'projects'
        if (next === 'projects') projects()
        else actors()
        requestAnimationFrame(() => { document.getElementById(`multica-${next}-tab`)?.focus() })
      }}>
      <button type="button" id="multica-projects-tab" role="tab" aria-controls="multica-projects-panel"
        aria-selected={active === 'projects'} tabIndex={active === 'projects' ? 0 : -1}
        className={css.catalogTab} onClick={projects}>{t('home')}</button>
      <button type="button" id="multica-actors-tab" role="tab" aria-controls="multica-actors-panel"
        aria-selected={active === 'actors'} tabIndex={active === 'actors' ? 0 : -1}
        className={css.catalogTab} onClick={actors}>{t('actorLibrary')}</button>
    </div>
    {active === 'projects'
      ? <div id="multica-actors-panel" role="tabpanel" aria-labelledby="multica-actors-tab" hidden />
      : <div id="multica-projects-panel" role="tabpanel" aria-labelledby="multica-projects-tab" hidden />}
  </>
}
