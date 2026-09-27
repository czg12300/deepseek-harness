// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PromptComposer } from '../src/client/skeleton/PromptComposer.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('sends on Enter but preserves Shift+Enter and IME composition, and exposes cancellation while sending is locked', () => {
  const onSend = vi.fn()
  const onStop = vi.fn()
  const onChange = vi.fn()
  const renderSlot = vi.fn(() => null)
  const props = {
    value: 'Draft request', label: 'Request', placeholder: 'Describe the task',
    disabled: false, sendDisabled: false, modelLocked: false,
    selection: { provider: 'fixture', model: 'writer', reasoningEffort: 'high' },
    onSend, onChange, onSelect: vi.fn(), renderSlot,
    t: (key: string) => en[key as keyof typeof en] ?? key,
  } as unknown as ComponentProps<typeof PromptComposer>
  const { rerender } = render(<PromptComposer {...props} />)
  const input = screen.getByRole('textbox', { name: 'Request' })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(onSend).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: 'Updated request' } })
  expect(onChange).toHaveBeenCalledWith('Updated request')
  expect(renderSlot).toHaveBeenCalledWith('multica.assistant.composer.model', expect.objectContaining({ selection: props.selection, locked: false }))
  rerender(<PromptComposer {...props} sendDisabled modelLocked onStop={onStop} />)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onSend).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: en['input.send'] })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: en['input.stop'] }))
  expect(onStop).toHaveBeenCalledTimes(1)
})
