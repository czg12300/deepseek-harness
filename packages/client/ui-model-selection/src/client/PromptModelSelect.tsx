/** Model and effort selection for a task draft without activating a Session. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ModelCatalogState } from './catalog.ts'
import { ModelSelectView } from './ModelSelect.tsx'

/** Shared catalog subscription and load action bound by the slot renderer. */
export interface PromptModelInjected {
  hooks: { catalog: ObservableSnapshot<ModelCatalogState> }
  load: () => void
}

/** @param props - target-owned selection and framework-bound catalog. @returns the main composer model menu. */
export function PromptModelSelect({ locked, selection, onSelect, useCatalog, load, t }: PropsRuntime<'multica.assistant.composer.model'> & InjectFace<PromptModelInjected> & PropsLocale<'model'>) {
  const catalog = useCatalog(state => state)
  const current = selection ?? catalog.value?.default ?? null
  return <ModelSelectView locked={locked} available showLabel state={{
    current,
    routable: current && catalog.value ? catalog.value.routableProviders.includes(current.provider) : null,
    groups: catalog.value?.groups ?? [],
    failures: catalog.value?.failures ?? [],
    status: catalog.status,
    error: catalog.error,
  }} load={load} select={(selected) => { onSelect(selected); return Promise.resolve(true) }} selectionError={() => catalog.error} t={t} />
}
