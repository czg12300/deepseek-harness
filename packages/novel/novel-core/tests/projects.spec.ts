import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { DatabaseSync } from 'node:sqlite'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it } from 'vitest'
import NovelProjects from '../src/index.ts'
import type { NovelAssistantResult, NovelDocumentId, NovelRequestId, NovelTask } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const request = () => randomUUID() as NovelRequestId
async function setup(home?: string) {
  const root = home ?? (await mkdtemp(join(tmpdir(), 'dsh-novel-')))
  if (!roots.includes(root)) roots.push(root)
  const books = join(root, 'books')
  await mkdir(books, { recursive: true })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(name: string) {
      if (name === '@deepseek-ai/dsh-novel-core') return { default: NovelProjects }
      throw new Error(name)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  const file = join(root, `novel-${randomUUID()}.yml`)
  await writeFile(file, `- name: '@deepseek-ai/dsh-novel-core'\n  config:\n    dshHome: ${JSON.stringify(root)}\n`)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return { ctx, projects: ctx.novelProjects, root, books }
}
async function book() {
  const setupResult = await setup()
  const input = {
    title: '城南夜渡',
    synopsis: 'A missing letter.',
    parentDirectory: setupResult.books,
    requestId: request(),
  }
  const project = setupResult.projects.create(input)
  const document = setupResult.projects.createDocument(project.id, 'chapter', 'The quay', request())
  return { ...setupResult, input, project, document }
}

describe('directory-backed novels through Loader', () => {
  it('backs up schema 1 before adding metadata indexes and preserves its text history', async () => {
    const { ctx, projects, root, project, document } = await book()
    projects.saveDocument(project.id, document.id, 1, document.title, 'A saved chapter.', request())
    await ctx.fiber.dispose()
    const legacy = new DatabaseSync(join(project.directory, '.novel/project.sqlite'))
    try {
      legacy.exec(
        'DROP INDEX document_metadata; DROP INDEX document_kind; ALTER TABLE documents DROP COLUMN metadata; ALTER TABLE documents DROP COLUMN position; ALTER TABLE documents DROP COLUMN kind; PRAGMA user_version=1;',
      )
    } finally {
      legacy.close()
    }
    const reopened = await setup(root)
    expect(reopened.projects.readDocument(project.id, document.id).content).toBe('A saved chapter.')
    expect(reopened.projects.history(project.id, document.id)).toHaveLength(2)
    const backups = await readdir(join(project.directory, '.novel/backups'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(project.directory, '.novel/backups', backups[0]!), { readOnly: true })
    try {
      expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1)
    } finally {
      backup.close()
    }
  })

  it('validates stored retry receipts and indexes metadata separately from manuscript text', async () => {
    const { projects, project, document } = await book()
    const operation = request()
    projects.saveDocument(project.id, document.id, 1, document.title, 'Saved text', operation)
    const db = new DatabaseSync(join(project.directory, '.novel/project.sqlite'))
    try {
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT metadata FROM documents INDEXED BY document_metadata ORDER BY position,id')
        .all()
      expect(JSON.stringify(plan)).toContain('document_metadata')
      expect(String(db.prepare('SELECT metadata FROM documents').get()?.metadata)).not.toContain('Saved text')
      db.prepare('UPDATE operations SET result=? WHERE id=?').run('{}', operation)
      expect(() => projects.saveDocument(project.id, document.id, 1, document.title, 'Saved text', operation)).toThrow()
      expect(projects.history(project.id, document.id)).toHaveLength(2)
    } finally {
      db.close()
    }
  })

  it('creates an independent directory, retries the same creation, and imports after registration removal', async () => {
    const { projects, input, project, document } = await book()
    expect(project.directory).toBe(await realpath(join(input.parentDirectory, input.title)))
    expect(JSON.parse(await readFile(join(project.directory, 'novel.json'), 'utf8'))).toMatchObject({
      format: 'dsh-novel',
      id: project.id,
    })
    expect(projects.create(input).id).toBe(project.id)
    expect(() => projects.create({ ...input, requestId: request() })).toThrow('already exists')
    expect(() => projects.create({ ...input, synopsis: 'Changed retry' })).toThrow('reused')
    projects.removeRegistration(project.id)
    expect(projects.list()).toEqual([])
    expect(projects.importProject(project.directory).id).toBe(project.id)
    expect(projects.documents(project.id).map(d => d.id)).toEqual([document.id])
    expect(projects.documents(project.id)[0]).not.toHaveProperty('content')
  })

  it('preserves every document version and rejects stale writes across Host instances', async () => {
    const { projects, root, project, document } = await book()
    const second = await setup(root)
    const firstSave = request()
    const saved = projects.saveDocument(project.id, document.id, 1, document.title, 'Original ending.', firstSave)
    expect(saved.status).toBe('saved')
    expect(projects.saveDocument(project.id, document.id, 1, document.title, 'Original ending.', firstSave)).toEqual(
      saved,
    )
    const stale = second.projects.saveDocument(project.id, document.id, 1, 'Stale title', 'Stale body', request())
    expect(stale.status).toBe('conflict')
    expect(stale.document.content).toBe('Original ending.')
    expect(projects.restore(project.id, document.id, 2, 1, request()).document).toMatchObject({
      content: '',
      revision: 3,
    })
    expect(projects.history(project.id, document.id).map(r => r.revision)).toEqual([3, 2, 1])
    expect(projects.history(project.id, document.id)[1]?.content).toBe('Original ending.')
  })

  it('renames metadata without moving the project and rejects cross-project document access', async () => {
    const { projects, project, document, books } = await book()
    const renamed = projects.updateInfo(project.id, 1, { title: 'A new title', synopsis: 'New synopsis' })
    expect(renamed.directory).toBe(project.directory)
    expect(() => projects.updateInfo(project.id, 1, { title: 'Stale', synopsis: '' })).toThrow('changed')
    const other = projects.create({
      title: 'Other',
      synopsis: 'Another novel',
      parentDirectory: books,
      requestId: request(),
    })
    expect(() => projects.readDocument(other.id, document.id)).toThrow('Unknown')
    const outline = projects.createDocument(project.id, 'outline', 'Outline', request())
    expect(projects.reorder(project.id, [outline.id, document.id]).map(d => d.id)).toEqual([outline.id, document.id])
    expect(() => projects.reorder(project.id, [document.id, document.id])).toThrow('exactly once')
    expect(() => projects.readDocument(project.id, randomUUID() as NovelDocumentId)).toThrow('Unknown')
  })

  it('persists proposals without changing text, applies once, and retains original versions after reopen', async () => {
    const { ctx, projects, root, project, document } = await book()
    projects.saveDocument(project.id, document.id, 1, document.title, 'The lamp went out.\n\nHe waited.', request())
    let captured: NovelTask | undefined
    const dispose = projects.registerAssistant({
      execute: async (task) => {
        captured = task
        return {
          reply: 'A stronger ending.',
          replacements: [{ spanId: task.spans[1]!.id, replacement: 'Someone behind him whispered his name.' }],
        }
      },
      cancel: async () => {},
    })
    const send = {
      novelId: project.id,
      documentId: document.id,
      requestId: request(),
      expectedRevision: 2,
      prompt: 'Improve the ending.',
      selection: null,
    }
    const task = projects.send(send)
    expect((await projects.waitTask(project.id, task.id)).status).toBe('completed')
    expect(projects.send(send).id).toBe(task.id)
    expect(captured?.content).toContain('He waited.')
    expect(projects.readDocument(project.id, document.id).content).toContain('He waited.')
    const proposal = projects.conversation(project.id, document.id).proposals[0]!
    const applyId = request()
    const result = projects.applyProposal(project.id, proposal.id, 2, applyId)
    expect(result.document.content).toContain('whispered his name')
    expect(projects.applyProposal(project.id, proposal.id, 2, applyId)).toEqual(result)
    expect(projects.history(project.id, document.id)).toHaveLength(3)
    await dispose()
    await ctx.fiber.dispose()
    const reopened = await setup(root)
    expect(reopened.projects.readDocument(project.id, document.id)).toEqual(result.document)
    expect(reopened.projects.conversation(project.id, document.id).proposals[0]?.status).toBe('applied')
  })

  it('keeps newer manual changes when a suggestion targets an old revision', async () => {
    const { projects, project, document } = await book()
    const dispose = projects.registerAssistant({
      execute: async task => ({
        reply: 'Suggestion',
        replacements: [{ spanId: task.spans[0]!.id, replacement: 'Suggested chapter' }],
      }),
      cancel: async () => {},
    })
    const task = projects.send({
      novelId: project.id,
      documentId: document.id,
      requestId: request(),
      expectedRevision: 1,
      prompt: 'Write.',
      selection: null,
    })
    await projects.waitTask(project.id, task.id)
    projects.saveDocument(project.id, document.id, 1, document.title, 'Human revision', request())
    const proposal = projects.conversation(project.id, document.id).proposals[0]!
    expect(projects.applyProposal(project.id, proposal.id, 2, request())).toMatchObject({
      status: 'conflict',
      document: { content: 'Human revision' },
    })
    expect(projects.discardProposal(project.id, proposal.id).status).toBe('discarded')
    await dispose()
  })

  it('rejects model-invented ranges and never publishes a partial proposal', async () => {
    const { projects, project, document } = await book()
    const dispose = projects.registerAssistant({
      execute: async () => ({
        reply: 'Invalid output',
        replacements: [{ spanId: '../another-book', replacement: 'Wrong target' }],
      }),
      cancel: async () => {},
    })
    const task = projects.send({
      novelId: project.id,
      documentId: document.id,
      requestId: request(),
      expectedRevision: 1,
      prompt: 'Write.',
      selection: null,
    })
    expect((await projects.waitTask(project.id, task.id)).status).toBe('failed')
    expect(projects.conversation(project.id, document.id).proposals).toEqual([])
    expect(projects.readDocument(project.id, document.id).content).toBe('')
    await dispose()
  })

  it('cancels an owned in-flight task before accepting a model result', async () => {
    const { projects, project, document } = await book()
    let finish!: (result: NovelAssistantResult) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const dispose = projects.registerAssistant({
      execute: async () => {
        entered()
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      cancel: async () => {
        finish({ reply: 'Late reply', replacements: [] })
      },
    })
    const task = projects.send({
      novelId: project.id,
      documentId: document.id,
      requestId: request(),
      expectedRevision: 1,
      prompt: 'Write.',
      selection: null,
    })
    await started
    expect((await projects.cancelTask(project.id, task.id)).status).toBe('cancelled')
    expect(projects.conversation(project.id, document.id).proposals).toEqual([])
    await dispose()
  })
})
