/** Controlled authoring input using the main conversation card and toolbar styles. */
import { useLayoutEffect, useRef } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './InputBar.module.css'

type Props = PropsRuntime<'multica.assistant.composer'> &
  PropsRenderSlots<'multica.assistant.composer.model'> & PropsLocale<'conversation'>

/** @param props - target-owned draft, model selection, and task actions. @returns the shared composer presentation. */
export function PromptComposer({
  value, label, placeholder, disabled, sendDisabled, modelLocked, selection,
  onChange, onSelect, onSend, onStop, renderSlot, t,
}: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = input.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  return (
    <form className={css.card} data-composer-card onSubmit={(event) => { event.preventDefault(); if (!sendDisabled) onSend() }}>
      <div className={css.scroll}>
        <textarea
          ref={input}
          className={`${css.input} ${css.promptInput}`}
          rows={2}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(event) => { onChange(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!sendDisabled) onSend()
            }
          }}
        />
      </div>
      <div className={css.row}>
        {renderSlot('multica.assistant.composer.model', { locked: modelLocked, selection, onSelect })}
        <div className={css.trailing}>
          {onStop && <button type="button" className={css.primary} aria-label={t('input.stop')} onClick={onStop}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg>
          </button>}
          <button type="submit" className={css.primary} aria-label={t('input.send')} disabled={sendDisabled}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8 2v12M3 7l5-5 5 5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          </button>
        </div>
      </div>
    </form>
  )
}
