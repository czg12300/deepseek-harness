/** Account settings page, with all product copy supplied by its locale dictionary. */
import { useEffect, useRef, useState } from 'react'
import type { ProviderId } from '@deepseek-ai/dsh-third-party-auth/types'
import type { PageProps } from './index.ts'
import css from './Page.module.css'

/**
 * Render account connection states and provider-local model defaults.
 * @param props - slot-injected operations, state hook, and translated text.
 * @returns the settings page and its active authorization dialog.
 */
export function Page({ controller, useAccounts, t, local, startSession, close }: PageProps) {
  const state = useAccounts(value => value)
  const [disconnect, setDisconnect] = useState<ProviderId | null>(null)
  const [answer, setAnswer] = useState('')
  const [startFailed, setStartFailed] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const isOpen = state.active !== null || disconnect !== null
  useEffect(() => controller.watch(), [controller])
  useEffect(() => { setAnswer('') }, [state.prompt?.id])
  useEffect(() => {
    if (isOpen && !dialog.current?.open) dialog.current?.showModal()
    if (!isOpen && dialog.current?.open) dialog.current?.close()
  }, [isOpen])
  const cancel = () => { controller.cancel(); setDisconnect(null); setAnswer('') }
  return <section className={css.page}>
    <h2>{t('nav')}</h2><p className={css.intro}>{t('intro')}</p>
    {state.message && <p role="status" className={css.message}>{t(state.message)}</p>}
    {!local && <p role="status">{t('localOnly')}</p>}
    {state.loading && <p role="status">{t('loading')}</p>}
    {state.accounts.map((account) => {
      const connected = account.connected && account.enabled
      const selectedModel = account.model
      return <article className={css.card} key={account.id} aria-label={t(account.id)}>
        <header className={css.header}>
          <div className={css.identity}><strong>{t(account.id)}</strong><span>{t(account.id === 'chatgpt' ? 'chatgptDetail' : 'claudeDetail')}</span></div>
          <span className={connected ? css.connected : css.status}>
            {t(account.connecting ? 'connecting' : connected ? 'connected' : 'disconnected')}
          </span>
        </header>
        {account.unavailable && <p role="status">{t(account.unavailable === 'route-conflict' ? 'routeConflict'
          : account.unavailable === 'runtime-missing' ? 'runtimeMissing' : 'failed')}</p>}
        {account.unavailable === 'status-failed' && <button onClick={() => { void controller.load() }}>{t('retry')}</button>}
        {connected ? <div className={css.details}>
          <div className={css.account}><span>{account.email ?? t('account')}</span>
            <button className={css.textButton} disabled={state.busy || !local} onClick={() => setDisconnect(account.id)}>{t('disconnect')}</button>
          </div>
          <label className={css.field}><span>{t('defaultModel')}<small>{t('defaultHint')}</small></span>
            <select disabled={state.busy || !local || account.catalogFailed} value={account.model ?? ''}
              onChange={(event) => { void controller.selectModel(account.id, event.target.value) }}>
              <option value="" disabled>{t('choose')}</option>
              {account.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          {account.catalogFailed && <p role="status">{t('modelsFailed')} <button onClick={() => { void controller.load() }}>{t('retry')}</button></p>}
          {!account.catalogFailed && account.models.length === 0 && <p>{t('emptyModels')}</p>}
          {selectedModel && <button className={css.textButton} disabled={state.busy || !local || account.unavailable !== undefined}
            onClick={() => {
              setStartFailed(false)
              void startSession(account.id, selectedModel).then(() => close(), () => setStartFailed(true))
            }}>{t('useModel')}</button>}
        </div> : <div className={css.details}>
          <p className={css.hint}>{t(account.id === 'chatgpt' ? 'loginHint' : 'claudeHint')}</p>
          <button className={css.primary} disabled={!local || state.busy || account.unavailable !== undefined}
            onClick={() => { void controller.connect(account.id) }}>{t(account.id === 'chatgpt'
              ? account.connected ? 'resumeConnection' : 'loginChatgpt' : 'loginClaude')}</button>
        </div>}
      </article>
    })}
    <p className={css.hint}>{t('availableHint')}</p>
    {startFailed && <p role="alert">{t('failed')}</p>}
    {!state.loading && state.accounts.length === 0 && <button onClick={() => { void controller.load() }}>{t('retry')}</button>}
    <dialog ref={dialog} className={css.dialog} onCancel={(event) => { event.preventDefault(); cancel() }}>
      <h3>{t(disconnect ? 'confirmDisconnect' : 'authorizing')}</h3>
      {disconnect ? <p>{t(disconnect === 'claude' ? 'claudeDisconnectHint' : 'disconnectHint')}</p> : <>
        <p>{state.notice ?? t('waiting')}</p>
        {state.url && <a href={state.url} target="_blank" rel="noreferrer">{t('openBrowser')}</a>}
        {state.code && <p><code>{state.code}</code></p>}
        {state.prompt && <label className={css.field}>{state.prompt.value.message}
          {state.prompt.value.kind === 'select'
            ? <select value={answer} onChange={event => setAnswer(event.target.value)}>
              <option value="" disabled>{t('choose')}</option>
              {state.prompt.value.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            : <input type={state.prompt.value.kind === 'secret' ? 'password' : 'text'} value={answer} autoComplete="off"
              onChange={event => setAnswer(event.target.value)} />}
        </label>}
      </>}
      <footer className={css.actions}>
        <button onClick={cancel}>{t('cancel')}</button>
        {disconnect && <button className={css.primary} onClick={() => {
          void controller.disconnect(disconnect); setDisconnect(null)
        }}>{t('disconnect')}</button>}
        {state.prompt && <button className={css.primary} disabled={!answer.trim()} onClick={() => {
          void controller.answer(answer); setAnswer('')
        }}>{t('submit')}</button>}
      </footer>
    </dialog>
  </section>
}
