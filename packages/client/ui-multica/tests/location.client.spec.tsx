// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProjectId, StudioFolderId } from '@deepseek-ai/dsh-api-remotes/client'
import { ProjectLocation, type PortableProjectActions } from '../src/client/ProjectLocation.tsx'
import { createMulticaStore } from '../src/client/drafts.ts'
import { en, type MulticaKey } from '../src/client/locales.ts'

afterEach(cleanup)
const folderId = '00000000-0000-4000-8000-000000000001' as StudioFolderId
const projectId = '00000000-0000-4000-8000-000000000002' as ProjectId
function fixture(open = false) {
  const store = createMulticaStore().create()
  const portable: PortableProjectActions = {
    pick: vi.fn(async () => '/projects/story'), reveal: vi.fn(async () => {}), open: vi.fn(async () => {}), prepare: vi.fn(async () => {}),
    close: vi.fn(async () => {}), forget: vi.fn(async () => {}),
    backup: vi.fn(async () => {}), migrate: vi.fn(async () => {}),
    autosave: vi.fn(async () => {}), select: vi.fn(),
  }
  if (open) store.actions.select(projectId)
  const state = store.getSnapshot()
  const queries = { maxCoverBytes: null, covers: {}, list: [], loading: false, error: false, creating: false, createError: false, byId: {},
    folders: open ? [{ id: folderId, path: '/projects/story', projectId, creationId: null, name: 'Story', state: 'open' as const }] : [],
  }
  const t = (key: string): string => en[key as MulticaKey]
  return { store, portable, queries, state, t }
}

it('opens the exact entered directory and keeps host errors visible', async () => {
  const f = fixture()
  vi.mocked(f.portable.open).mockRejectedValueOnce(new Error('Project database is missing'))
  render(<ProjectLocation {...f} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Project folder' }), { target: { value: '/drive/moved-story' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open project folder' }))
  await screen.findByRole('alert')
  expect(f.portable.open).toHaveBeenCalledWith('/drive/moved-story')
  expect(screen.getByRole('alert').textContent).toContain('Project database is missing')
})

it('creates a folder-bound form before a formal project', async () => {
  const f = fixture()
  f.store.actions.startCreate()
  render(<ProjectLocation {...f} state={f.store.getSnapshot()} />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use this folder' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }))
  await waitFor(() =>{  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Project folder' }).value).toBe('/projects/story') })
  await waitFor(() =>{  expect(f.portable.prepare).toHaveBeenCalledWith('/projects/story', f.state.creationId, f.state.createInput) })
})

it('requires the explicit save-and-close action and never announces a failed close as safe to remove', async () => {
  const f = fixture(true)
  vi.mocked(f.portable.close).mockRejectedValueOnce(new Error('Drive disconnected'))
  render(<ProjectLocation {...f} />)
  fireEvent.click(screen.getByRole('button', { name: 'Close project' }))
  expect(f.portable.close).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save drafts and close' }))
  await screen.findByRole('alert')
  expect(f.portable.close).toHaveBeenCalledWith(folderId, f.state)
  expect(screen.queryByText(en.projectClosed)).toBeNull()
  expect(screen.getByRole('alert').textContent).toBe('Drive disconnected')
})

it('does not bind a folder when the picker is cancelled and allows manual entry after a picker failure', async () => {
  const f = fixture()
  f.store.actions.startCreate()
  vi.mocked(f.portable.pick).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Picker unavailable'))
  render(<ProjectLocation {...f} state={f.store.getSnapshot()} />)
  const choose = screen.getByRole<HTMLButtonElement>('button', { name: 'Choose folder' })
  fireEvent.click(choose)
  await waitFor(() => { expect(choose.disabled).toBe(false) })
  expect(f.portable.prepare).not.toHaveBeenCalled()
  fireEvent.click(choose)
  expect((await screen.findByRole('alert')).textContent).toBe('Picker unavailable')
  fireEvent.change(screen.getByRole('textbox', { name: 'Project folder' }), { target: { value: '/drive/story' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this folder' }))
  await waitFor(() => { expect(f.portable.prepare).toHaveBeenCalledWith('/drive/story', f.state.creationId, f.state.createInput) })
})

it('removes an open recent entry without closing it', async () => {
  const f = fixture(true)
  f.store.actions.home()
  render(<ProjectLocation {...f} state={f.store.getSnapshot()} />)
  fireEvent.click(screen.getByText(en.recentDirectories))
  const remove = screen.getByRole<HTMLButtonElement>('button', { name: en.forgetDirectory })
  expect(remove.disabled).toBe(false)
  fireEvent.click(remove)
  await waitFor(() => { expect(f.portable.forget).toHaveBeenCalledWith(folderId) })
  expect(f.portable.close).not.toHaveBeenCalled()
  expect(f.portable.autosave).not.toHaveBeenCalled()
})
