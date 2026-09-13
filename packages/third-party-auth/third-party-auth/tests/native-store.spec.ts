import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { NativeStore } from '../src/native-store.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })

describe('native transcript storage', () => {
  it('round-trips native records and deduplicates only entries with stable UUIDs', async () => {
    const store = new NativeStore(':memory:')
    cleanups.push(() => store.close())
    const session = store.create('/workspace', 'native-model')
    const key = { projectKey: 'project', sessionId: session.id }
    const entry = { type: 'assistant', uuid: 'native-uuid', message: { content: [{ type: 'text', text: 'Answer' }] } }
    const marker = { type: 'mode', mode: 'default' }
    await store.append(key, [entry, marker])
    await store.append(key, [entry, marker])
    expect(await store.load(key)).toEqual([entry, marker, marker])
    expect(store.records(session.id)).toEqual([entry, marker, marker])
    expect(await store.load({ ...key, subpath: 'unknown' })).toBeNull()
  })

  it('preserves separate native subagent streams for official resume', async () => {
    const store = new NativeStore(':memory:')
    cleanups.push(() => store.close())
    const session = store.create('/workspace', 'native-model')
    const key = { projectKey: '../../opaque-project', sessionId: session.id }
    await store.append({ ...key, subpath: 'subagents/child' }, [{ type: 'assistant', uuid: 'child', nested: { value: 1 } }])
    expect(await store.listSubkeys(key)).toEqual(['subagents/child'])
    expect(store.records(session.id)).toEqual([])
  })

  it('rolls back the complete native batch when one record is invalid', async () => {
    const store = new NativeStore(':memory:')
    cleanups.push(() => store.close())
    const key = { projectKey: 'project', sessionId: store.create('/workspace', 'native-model').id }
    await expect(store.append(key, [{ type: 'user' }, JSON.parse('{"type":4}')])).rejects.toThrow()
    expect(await store.load(key)).toBeNull()
  })

  it('reopens metadata and exact transcript content after the database closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-native-store-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const path = join(dir, 'native.db')
    const first = new NativeStore(path)
    let id
    try {
      const session = first.create(dir, 'model-a')
      id = session.id
      first.touch(id, 'model-b', 'User task')
      await first.append({ projectKey: 'project', sessionId: id }, [{ type: 'user', uuid: 'u', message: { content: 'User task' } }])
    } finally { first.close() }
    const reopened = new NativeStore(path)
    cleanups.push(() => reopened.close())
    expect(reopened.get(id)).toMatchObject({ id, cwd: dir, model: 'model-b', title: 'User task' })
    expect(reopened.records(id)).toEqual([{ type: 'user', uuid: 'u', message: { content: 'User task' } }])
  })

  it('refuses a future schema without modifying its version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-native-future-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const path = join(dir, 'native.db')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version=2'); db.close()
    expect(() => new NativeStore(path)).toThrow('unsupported')
    const after = new DatabaseSync(path)
    try { expect(after.prepare('PRAGMA user_version').get()?.user_version).toBe(2) }
    finally { after.close() }
  })
})
