// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { AccountView, ConnectEvent } from '@deepseek-ai/dsh-third-party-auth/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttemptId } from '@deepseek-ai/dsh-third-party-auth/types'
import { AccountPageStore, type AccountOperations } from '../src/client/store.ts'
import { Page } from '../src/client/Page.tsx'
import type { PageProps } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const stores: AccountPageStore[] = []
let restoreDialogs: () => void
beforeEach(() => {
  const prototype = HTMLDialogElement.prototype
  const show = Object.getOwnPropertyDescriptor(prototype, 'showModal')
  const close = Object.getOwnPropertyDescriptor(prototype, 'close')
  Object.defineProperty(prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false } })
  restoreDialogs = () => {
    if (show) Object.defineProperty(prototype, 'showModal', show)
    else Reflect.deleteProperty(prototype, 'showModal')
    if (close) Object.defineProperty(prototype, 'close', close)
    else Reflect.deleteProperty(prototype, 'close')
  }
})
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.dispose(); restoreDialogs(); vi.restoreAllMocks() })

function mount(overrides: Partial<AccountOperations> = {}) {
  const accounts: AccountView[] = [
    { id: 'chatgpt', connected: true, enabled: true, connecting: false, model: 'model-a',
      models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }], catalogFailed: false },
    { id: 'claude', connected: false, enabled: false, connecting: false, models: [], catalogFailed: false },
  ]
  const operations: AccountOperations = {
    async *changes(signal) {
      yield 0
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    },
    list: async () => structuredClone(accounts),
    async *connect(_id, signal) {
      yield { kind: 'started', attemptId: brandString<AttemptId>('attempt') }
      yield { kind: 'notice', notice: { message: 'Native sign-in', url: 'https://claude.ai/oauth/authorize' } }
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      yield { kind: 'settled', status: 'cancelled' }
    },
    answer: async () => {}, disconnect: async () => {}, selectModel: async () => {}, ...overrides,
  }
  const store = new AccountPageStore(operations)
  stores.push(store)
  const start = vi.fn(async () => {})
  const props = { controller: store, useAccounts: bindSnapshotSelector(store.state),
    t: (key: keyof typeof en) => en[key], local: true, startSession: start, close: () => {} } as PageProps
  const view = render(<Page {...props} />)
  return { store, operations, start, ...view }
}

describe('third-party authorization settings', () => {
  it('records the account settings presentation without private login data', async () => {
    const { container } = mount()
    const picker = await screen.findByRole('combobox') as HTMLSelectElement
    const view = {
      heading: screen.getByRole('heading', { name: en.nav }).textContent,
      accounts: [...container.querySelectorAll('article')].map(article => article.textContent),
      controls: screen.getAllByRole('button').map(button => button.textContent),
      models: [...picker.options].map(option => ({ value: option.value, label: option.textContent })),
    }
    await expect(`${JSON.stringify(view, null, 2)}\n`).toMatchFileSnapshot('./expected/accounts.json')
  })

  it('shows account cards and changes only the selected provider default', async () => {
    const select = vi.fn(async () => {})
    mount({ selectModel: select })
    const picker = await screen.findByRole('combobox')
    fireEvent.change(picker, { target: { value: 'model-b' } })
    await waitFor(() => expect(select).toHaveBeenCalledWith('chatgpt', 'model-b', expect.any(AbortSignal)))
    expect(screen.getByText(en.saved)).toBeDefined()
    expect(screen.queryByLabelText('API key')).toBeNull()
  })

  it('cancels the owned authorization stream when the dialog is cancelled', async () => {
    const { store } = mount()
    fireEvent.click(await screen.findByRole('button', { name: en.loginClaude }))
    expect(await screen.findByRole('link', { name: en.openBrowser })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    await waitFor(() => expect(store.state.getSnapshot().active).toBeNull())
    expect(store.state.getSnapshot().url).toBeNull()
  })

  it('clears private authorization state when the page unmounts', async () => {
    const { store, unmount } = mount()
    fireEvent.click(await screen.findByRole('button', { name: en.loginClaude }))
    await screen.findByRole('link', { name: en.openBrowser })
    unmount()
    await waitFor(() => expect(store.state.getSnapshot().active).toBeNull())
    expect(store.state.getSnapshot().prompt).toBeNull()
  })

  it('uses the chosen model when starting a new conversation', async () => {
    const { start } = mount()
    fireEvent.click(await screen.findByRole('button', { name: en.useModel }))
    await waitFor(() => expect(start).toHaveBeenCalledWith('chatgpt', 'model-a'))
  })

  it('does not let an old read overwrite a newer connection view', async () => {
    let finish = (_value: AccountView[]): void => {}
    const pending = new Promise<AccountView[]>((resolve) => { finish = resolve })
    let reads = 0
    const { store } = mount({ list: () => ++reads === 1 ? pending : Promise.resolve([]) })
    await waitFor(() => expect(reads).toBe(1))
    await act(async () => { await store.load(); finish([{ id: 'claude', enabled: false, connected: false,
      connecting: false, models: [], catalogFailed: false }]); await pending })
    expect(store.state.getSnapshot().accounts).toEqual([])
  })

  it('reports login failures without echoing provider exception text', async () => {
    mount({ async *connect(): AsyncGenerator<ConnectEvent> { throw new Error('secret-token'); yield* [] } })
    fireEvent.click(await screen.findByRole('button', { name: en.loginClaude }))
    await screen.findByText(en.failed)
    expect(screen.queryByText('secret-token')).toBeNull()
  })
})
