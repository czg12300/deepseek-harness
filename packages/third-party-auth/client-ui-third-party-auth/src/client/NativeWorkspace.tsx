/** Native conversation window mounted through the additive shell overlay slot. */
import { useEffect, useRef, useState } from 'react'
import type { NativeProps } from './index.ts'
import css from './NativeWorkspace.module.css'

/**
 * Render native Claude history, streamed output, and private approval prompts.
 * @param props - injected native state and operations with localized copy.
 * @returns the separate native conversation window.
 */
export function NativeWorkspace({ native, useNative, t }: NativeProps) {
  const state = useNative(value => value)
  const dialog = useRef<HTMLDialogElement>(null)
  const [message, setMessage] = useState('')
  const [answer, setAnswer] = useState('')
  useEffect(() => {
    if (state.open && !dialog.current?.open) dialog.current?.showModal()
    if (!state.open && dialog.current?.open) dialog.current?.close()
  }, [state.open])
  useEffect(() => { setAnswer('') }, [state.prompt?.id])
  return <dialog ref={dialog} className={css.window} onCancel={(event) => { event.preventDefault(); native.close() }}>
    <header className={css.heading}><h2>{t('nativeTitle')}</h2>
      <button onClick={() => native.close()}>{t('dismiss')}</button></header>
    <div className={css.layout}>
      <aside className={css.history} aria-label={t('nativeHistory')}>
        <button disabled={state.busy} onClick={() => native.fresh()}>{t('newSession')}</button>
        {state.sessions.map(session => <button key={session.id} disabled={state.busy}
          aria-pressed={state.session?.id === session.id} onClick={() => { void native.select(session) }}>
          {session.title || t('newSession')}
        </button>)}
      </aside>
      <main className={css.content}>
        <div className={css.options}>
          <label>{t('workspace')}<input value={state.cwd} disabled={state.busy || state.session !== null}
            onChange={event => native.state.update((value) => { value.cwd = event.target.value })} /></label>
          <label>{t('defaultModel')}<select value={state.model} disabled={state.busy}
            onChange={event => native.state.update((value) => { value.model = event.target.value })}>
            {state.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select></label>
        </div>
        <div className={css.messages} aria-live="polite">
          {state.messages.length === 0 && !state.busy && <p className={css.empty}>{t('nativeEmpty')}</p>}
          {state.messages.map((item, index) => <article key={index} className={css.message}>
            <strong>{t(item.role === 'user' ? 'you' : 'claude')}</strong><pre>{item.text}</pre>
          </article>)}
          {state.streaming && <article className={css.message}><strong>{t('claude')}</strong><pre>{state.streaming}</pre></article>}
          {state.tool && <p role="status"><code>{state.tool}</code></p>}
        </div>
        {state.failed && <p role="alert">{t('nativeFailed')}</p>}
        {state.cancelled && <p role="status">{t('nativeCancelled')}</p>}
        {state.prompt && <section className={css.permission}>
          <pre>{state.prompt.value.message}</pre>
          {state.prompt.value.kind === 'select' ? <div className={css.actions}>
            {state.prompt.value.options.map(option => <button key={option.id} onClick={() => { void native.answer(option.id) }}>
              {option.id === 'allow' || option.id === 'deny' ? t(option.id) : option.label}
            </button>)}
          </div> : <form onSubmit={(event) => { event.preventDefault(); void native.answer(answer); setAnswer('') }}>
            <input aria-label={t('answer')} value={answer} onChange={event => setAnswer(event.target.value)} />
            <button disabled={!answer.trim()}>{t('submit')}</button>
          </form>}
        </section>}
        <form className={css.composer} onSubmit={(event) => {
          event.preventDefault()
          const submitted = message
          void native.send(submitted).then(() => {
            const outcome = native.state.getSnapshot()
            if (!outcome.failed && !outcome.cancelled) setMessage(current => current === submitted ? '' : current)
          })
        }}>
          <textarea aria-label={t('message')} placeholder={t('message')} value={message} disabled={state.busy}
            onChange={event => setMessage(event.target.value)} rows={3} />
          <div className={css.actions}>{state.busy
            ? <button type="button" onClick={() => { void native.stop() }}>{t('stop')}</button>
            : <button disabled={!message.trim() || !state.cwd.trim() || !state.model}>{t('send')}</button>}</div>
        </form>
      </main>
    </div>
  </dialog>
}
