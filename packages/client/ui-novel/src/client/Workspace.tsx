/** Novel management and authoring presentation; all durable actions arrive as injected callbacks. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type {
  NovelId,
  NovelDocumentId,
  NovelDocumentKind,
  NovelProject,
  NovelProposal,
  NovelSelection,
} from '@deepseek-ai/dsh-novel-core/types'
import type { NovelProps } from './contract.ts'
import css from './Workspace.module.css'

const kinds: NovelDocumentKind[] = ['chapter', 'outline', 'character', 'setting']

/** @param props - framework-provided snapshots, draft actions, and Remote callbacks. @returns the registered novel panel. */
export function Workspace(props: NovelProps) {
  const view = props.useStore(s => s)
  const data = props.useNovelData(s => s)
  const [picker, setPicker] = useState<'create' | 'import' | null>(null)
  const [newDocument, setNewDocument] = useState(false)
  const project = data.projects.find(p => p.id === view.novelId)
  useEffect(() => {
    void props.refresh()
  }, [props.refresh])
  useEffect(() => {
    props.reportUnsaved(Object.values(view.drafts).some(draft => draft.dirty))
  }, [view.drafts, props.reportUnsaved])
  const errors = Object.values(data.errors).filter(Boolean)
  const title =
    view.page === 'create'
      ? props.t('create')
      : view.page === 'info'
        ? props.t('editInfo')
        : (project?.title ?? props.t('all'))
  return (
    <section className={css.workspace} aria-label={props.t('nav')}>
      <header className={css.header}>
        <div className={css.breadcrumb}>
          <Button
            onClick={() => {
              props.actions.list()
            }}
          >
            {props.t('nav')}
          </Button>
          <span aria-hidden="true">/</span>
          <span>{title}</span>
        </div>
        {view.page === 'list' && (
          <div className={css.row}>
            <Button
              variant="outline"
              onClick={() => {
                setPicker('import')
              }}
            >
              {props.t('import')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                props.actions.create()
              }}
            >
              {props.t('create')}
            </Button>
          </div>
        )}
        {view.page === 'writing' && project && (
          <Button
            onClick={() => {
              props.actions.info(project.id)
            }}
          >
            {props.t('editInfo')}
          </Button>
        )}
      </header>
      {errors.map((error, index) => (
        <div className={css.error} role="alert" key={`${index}:${error}`}>
          {props.t('error', { message: error })}
          <Button size="sm" onClick={() => void props.refresh()}>
            {props.t('refresh')}
          </Button>
        </div>
      ))}
      {view.page === 'list' && (
        <div className={css.home}>
          <h1>{props.t('all')}</h1>
          {data.busy.catalog && <p role="status">{props.t('loading')}</p>}
          {!data.busy.catalog && !data.projects.length && <p>{props.t('empty')}</p>}
          <div className={css.cards}>
            {data.projects.map(p => (
              <article className={css.card} key={p.id}>
                <Button onClick={() => void props.open(p.id)}>
                  <h2>{p.title}</h2>
                </Button>
                <p className={css.synopsis}>{p.synopsis}</p>
                <p className={css.path}>{p.directory}</p>
                <footer className={css.cardFoot}>
                  <span>{props.t('chapterCount', { count: p.chapterCount })}</span>
                  <div className={css.row}>
                    <Button
                      size="sm"
                      onClick={() => {
                        props.actions.info(p.id)
                      }}
                    >
                      {props.t('editInfo')}
                    </Button>
                    <Button size="sm" onClick={() => void props.open(p.id)}>
                      {props.t('open')}
                    </Button>
                  </div>
                </footer>
              </article>
            ))}
          </div>
        </div>
      )}
      {view.page === 'create' && (
        <div className={css.form}>
          <h1>{props.t('create')}</h1>
          <p>{props.t('createHint')}</p>
          <label className={css.field}>
            {props.t('title')}
            <Input
              value={view.creation.title}
              maxLength={200}
              placeholder={props.t('titlePlaceholder')}
              onChange={(e) => {
                props.actions.creationField('title', e.target.value)
              }}
            />
          </label>
          <label className={css.field}>
            {props.t('synopsis')}
            <textarea
              rows={5}
              value={view.creation.synopsis}
              maxLength={20000}
              placeholder={props.t('synopsisPlaceholder')}
              onChange={(e) => {
                props.actions.creationField('synopsis', e.target.value)
              }}
            />
          </label>
          <div className={css.field}>
            <span>{props.t('folder')}</span>
            <div className={css.folderPicker}>
              <span>{view.creation.parentDirectory || props.t('chooseFolder')}</span>
              <Button
                variant="outline"
                onClick={() => {
                  setPicker('create')
                }}
              >
                {props.t('chooseFolder')}
              </Button>
            </div>
            <small>{props.t('folderHint')}</small>
          </div>
          <div className={css.actions}>
            <Button
              onClick={() => {
                props.actions.list()
              }}
            >
              {props.t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={
                data.busy.create ||
                !view.creation.title.trim() ||
                !view.creation.synopsis.trim() ||
                !view.creation.parentDirectory
              }
              onClick={() => void props.create(view.creation)}
            >
              {props.t(data.busy.create ? 'saving' : 'create')}
            </Button>
          </div>
        </div>
      )}
      {view.page === 'info' && project && <ProjectInfo key={project.id} project={project} {...props} />}
      {view.page === 'writing' && project && (
        <div className={css.authoring}>
          <nav className={css.documents} aria-label={props.t('newConversation')}>
            <h2>{project.title}</h2>
            <Button
              variant="outline"
              onClick={() => {
                setNewDocument(true)
              }}
            >
              {props.t('addDocument')}
            </Button>
            {kinds.map(kind => (
              <section key={kind}>
                <h3>{props.t(kind)}</h3>
                {(data.documents[project.id] ?? [])
                  .filter(d => d.kind === kind)
                  .map(document => (
                    <Button
                      key={document.id}
                      variant={view.documentId === document.id ? 'outline' : 'ghost'}
                      onClick={() => void props.read(project.id, document.id)}
                    >
                      {document.title}
                    </Button>
                  ))}
              </section>
            ))}
          </nav>
          {view.documentId ? (
            <Editor key={view.documentId} {...props} novelId={project.id} documentId={view.documentId} />
          ) : (
            <>
              <div className={css.empty}>
                <h2>{props.t('selectFirst')}</h2>
                <p>{props.t('emptyDocuments')}</p>
                <Button
                  variant="primary"
                  onClick={() => {
                    setNewDocument(true)
                  }}
                >
                  {props.t('addDocument')}
                </Button>
              </div>
              <aside className={css.agent}>
                <h2>{props.t('agent')}</h2>
                <p>{props.t('selectDocument')}</p>
              </aside>
            </>
          )}
        </div>
      )}
      {picker && (
        <DirectoryPicker
          {...props}
          onClose={() => {
            setPicker(null)
          }}
          onChoose={(path) => {
            if (picker === 'create') props.actions.creationField('parentDirectory', path)
            else void props.importProject(path)
            setPicker(null)
          }}
        />
      )}
      {newDocument && project && (
        <NewDocument
          {...props}
          novelId={project.id}
          onClose={() => {
            setNewDocument(false)
          }}
        />
      )}
    </section>
  )
}

function ProjectInfo(props: NovelProps & { project: NovelProject }) {
  const [title, setTitle] = useState(props.project.title)
  const [synopsis, setSynopsis] = useState(props.project.synopsis)
  const [removing, setRemoving] = useState(false)
  const busy = props.useNovelData(s => s.busy[`info:${props.project.id}`])
  return (
    <div className={css.form}>
      <h1>{props.t('editInfo')}</h1>
      <label className={css.field}>
        {props.t('title')}
        <Input
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
          }}
        />
      </label>
      <label className={css.field}>
        {props.t('synopsis')}
        <textarea
          rows={5}
          value={synopsis}
          maxLength={20000}
          onChange={(e) => {
            setSynopsis(e.target.value)
          }}
        />
      </label>
      <div className={css.field}>
        <span>{props.t('metadataPath')}</span>
        <code className={css.path}>{props.project.directory}</code>
        <small>{props.t('nameDoesNotMove')}</small>
      </div>
      <div className={css.actions}>
        <Button
          onClick={() => {
            props.actions.list()
          }}
        >
          {props.t('cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={busy || !title.trim()}
          onClick={() => void props.updateInfo(props.project.id, props.project.revision, { title, synopsis })}
        >
          {props.t('save')}
        </Button>
      </div>
      <Button
        onClick={() => {
          setRemoving(true)
        }}
      >
        {props.t('remove')}
      </Button>
      <Modal
        open={removing}
        onClose={() => {
          setRemoving(false)
        }}
        title={props.t('remove')}
        closeLabel={props.t('cancel')}
        footer={
          <div className={css.row}>
            <Button
              onClick={() => {
                setRemoving(false)
              }}
            >
              {props.t('cancel')}
            </Button>
            <Button
              onClick={() => {
                void props.remove(props.project.id)
                props.actions.list()
              }}
            >
              {props.t('remove')}
            </Button>
          </div>
        }
      >
        <p>{props.t('removeHint')}</p>
      </Modal>
    </div>
  )
}

function NewDocument(props: NovelProps & { novelId: NovelId; onClose: () => void }) {
  const id = props.novelId
  const [kind, setKind] = useState<NovelDocumentKind>('chapter')
  const [title, setTitle] = useState('')
  const busy = props.useNovelData(s => s.busy[`create-document:${id}`])
  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.t('addDocument')}
      closeLabel={props.t('cancel')}
      footer={
        <div className={css.row}>
          <Button onClick={props.onClose}>{props.t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || !title.trim()}
            onClick={() => {
              void props.createDocument(id, kind, title).then(props.onClose)
            }}
          >
            {props.t('save')}
          </Button>
        </div>
      }
    >
      <div className={css.modalFields}>
        <label className={css.field}>
          {props.t('kind')}
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as NovelDocumentKind)
            }}
          >
            {kinds.map(k => (
              <option value={k} key={k}>
                {props.t(k)}
              </option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          {props.t('documentTitle')}
          <Input
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value)
            }}
          />
        </label>
      </div>
    </Modal>
  )
}

function DirectoryPicker(props: NovelProps & { onChoose: (path: string) => void; onClose: () => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const mounted = useRef(true)
  const parent = listing?.crumbs.at(-2)
  const browse = async (at?: string) => {
    const current = ++generation.current
    setBusy(true)
    setError('')
    try {
      const result = await props.listDirectory(at)
      if (mounted.current && current === generation.current) {
        setListing(result)
        setPath(result.path)
      }
    } catch (e) {
      if (mounted.current && current === generation.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current && current === generation.current) setBusy(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void browse()
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [])
  return (
    <Modal
      open
      onClose={props.onClose}
      title={props.t('directoryTitle')}
      className={clsx(css.directoryDialog)}
      contentClassName={clsx(css.directoryScroll)}
      closeLabel={props.t('cancel')}
      description={props.t('directoryHint')}
      footer={
        <div className={css.row}>
          <Button onClick={props.onClose}>{props.t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={!path || busy}
            onClick={() => {
              props.onChoose(path)
            }}
          >
            {props.t('choose')}
          </Button>
        </div>
      }
    >
      <div className={css.modalFields}>
        <div className={css.row}>
          <Button
            onClick={() => {
              void props
                .pickDirectory()
                .then((value) => {
                  if (mounted.current && value) props.onChoose(value)
                })
                .catch((e: unknown) => {
                  if (mounted.current) setError(e instanceof Error ? e.message : String(e))
                })
            }}
          >
            {props.t('nativePicker')}
          </Button>
          {parent !== undefined && <Button onClick={() => void browse(parent.path)}>{props.t('parent')}</Button>}
        </div>
        <label className={css.field}>
          {props.t('path')}
          <Input
            value={path}
            onChange={(e) => {
              generation.current++
              setBusy(false)
              setListing(null)
              setPath(e.target.value)
            }}
          />
        </label>
        <Button disabled={busy} onClick={() => void browse(path)}>
          {props.t('refresh')}
        </Button>
        {error && (
          <p role="alert">
            {props.t('directoryError')} {error}
          </p>
        )}
        {busy ? (
          <p>{props.t('loading')}</p>
        ) : (
          listing?.entries.map(entry => (
            <Button key={entry.path} onClick={() => void browse(entry.path)}>
              {entry.name}
            </Button>
          ))
        )}
      </div>
    </Modal>
  )
}

function Editor(props: NovelProps & { novelId: NovelId; documentId: NovelDocumentId }) {
  const view = props.useStore(s => s)
  const data = props.useNovelData(s => s)
  const novelId = props.novelId
  const id = props.documentId
  const draft = view.drafts[id]
  const document = data.content[id]
  const conversation = data.conversations[id]
  const running = conversation?.tasks.some(task => task.status === 'running') === true
  const pending = conversation?.proposals.filter(p => p.status === 'pending') ?? []
  const proposal = pending[0]
  const [selection, setSelection] = useState<NovelSelection | null>(null)
  const composing = useRef(false)
  const autoSaveMs = props.useNovelAutoSave(value => value)
  const busy = data.busy[`save:${id}`] === true
  useEffect(() => {
    if (!draft?.dirty || draft.conflict || proposal || busy || autoSaveMs === null || autoSaveMs <= 0 || composing.current) return
    const timer = setTimeout(() => {
      if (!composing.current) void props.save(novelId, id, draft)
    }, autoSaveMs)
    return () => {
      clearTimeout(timer)
    }
  }, [draft?.edit, draft?.dirty, draft?.conflict, proposal?.id, busy, autoSaveMs, props.save, novelId, id])
  if (!draft || !document)
    return (
      <>
        <div className={css.empty}>{props.t('loading')}</div>
        <aside className={css.agent}>{props.t('agent')}</aside>
      </>
    )
  const disabled = busy || proposal !== undefined
  const stale = proposal && (proposal.baseRevision !== draft.revision || draft.dirty)
  const all = data.documents[novelId] ?? []
  const peers = all.filter(d => d.kind === document.kind)
  const index = peers.findIndex(d => d.id === id)
  const move = (direction: number) => {
    const ids = all.map(d => d.id)
    const next = index + direction
    const target = peers[next]
    if (!target) return
    const sourceIndex = ids.indexOf(id)
    const targetIndex = ids.indexOf(target.id)
    if (sourceIndex < 0 || targetIndex < 0) return
    ids[sourceIndex] = target.id
    ids[targetIndex] = id
    void props.reorder(novelId, ids)
  }
  return (
    <>
      <section className={css.editor} aria-label={props.t('currentText')}>
        <div className={css.editorToolbar}>
          <span>{props.t(document.kind)}</span>
          <div className={css.row}>
            <Button
              size="sm"
              disabled={index < 1}
              onClick={() => {
                move(-1)
              }}
            >
              {props.t('moveUp')}
            </Button>
            <Button
              size="sm"
              disabled={index < 0 || index === peers.length - 1}
              onClick={() => {
                move(1)
              }}
            >
              {props.t('moveDown')}
            </Button>
            <Button size="sm" onClick={() => void props.history(novelId, id)}>
              {props.t('history')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!draft.dirty || disabled || draft.conflict}
              onClick={() => void props.save(novelId, id, draft)}
            >
              {props.t(busy ? 'saving' : 'save')}
            </Button>
          </div>
        </div>
        {draft.conflict && (
          <div className={css.warning} role="alert">
            <p>{props.t('conflict')}</p>
            <Button
              onClick={() => {
                props.actions.received(document, true)
              }}
            >
              {props.t('loadSaved')}
            </Button>
            <Button
              onClick={() => {
                const blob = new Blob([draft.content], { type: 'text/plain;charset=utf-8' })
                const url = URL.createObjectURL(blob)
                const a = window.document.createElement('a')
                a.href = url
                a.download = `${draft.title}.txt`
                a.click()
                setTimeout(() => {
                  URL.revokeObjectURL(url)
                }, 0)
              }}
            >
              {props.t('exportDraft')}
            </Button>
            <details>
              <summary>{props.t('newerSaved')}</summary>
              <pre>{document.content}</pre>
            </details>
          </div>
        )}
        {proposal && (
          <div className={css.reviewbar}>
            <span>{props.t('pending', { count: proposal.changes.length })}</span>
            <div className={css.row}>
              <Button size="sm" onClick={() => void props.discard(novelId, id, proposal.id)}>
                {props.t('discard')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={Boolean(stale) || busy}
                onClick={() => { setSelection(null); void props.apply(novelId, id, proposal.id, draft.revision) }}
              >
                {props.t('apply')}
              </Button>
            </div>
            {stale && <p>{props.t('stale')}</p>}
          </div>
        )}
        <div className={css.editorPage}>
          <Input
            aria-label={props.t('documentTitle')}
            value={draft.title}
            disabled={disabled}
            onChange={(e) => {
              props.actions.change(id, 'title', e.target.value)
            }}
          />
          <p className={css.status}>{props.t(draft.dirty ? 'unsaved' : 'saved', { revision: draft.revision })}</p>
          {proposal ? (
            <ProposalPreview
              {...props}
              content={proposal.baseRevision === draft.revision ? draft.content : document.content}
              proposal={proposal}
              stale={Boolean(stale)}
            />
          ) : (
            <textarea
              className={css.manuscript}
              aria-label={props.t('currentText')}
              value={draft.content}
              disabled={busy}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={() => {
                composing.current = false
              }}
              onChange={(e) => {
                props.actions.change(id, 'content', e.target.value)
                setSelection(null)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                setSelection(
                  el.selectionEnd > el.selectionStart ? { start: el.selectionStart, end: el.selectionEnd } : null,
                )
              }}
            />
          )}
        </div>
        <footer className={css.docFooter}>
          {props.t('characters', { count: Array.from(draft.content.replace(/\s/g, '')).length })}
        </footer>
        <Modal
          open={view.history}
          onClose={() => {
            props.actions.history(false)
          }}
          title={props.t('history')}
          closeLabel={props.t('cancel')}
        >
          <div className={css.modalFields}>
            {data.busy[`history:${id}`] && <p>{props.t('loading')}</p>}
            {(data.histories[id] ?? []).map(revision => (
              <details key={revision.revision}>
                <summary>
                  {props.t('version', { revision: revision.revision })} · {revision.createdAt}
                </summary>
                <pre>{revision.content}</pre>
                <Button
                  disabled={draft.dirty || busy || revision.revision === draft.revision}
                  onClick={() => void props.restore(novelId, id, draft.revision, revision.revision)}
                >
                  {props.t('restore')}
                </Button>
              </details>
            ))}
          </div>
        </Modal>
      </section>
      <aside className={css.agent} aria-label={props.t('agent')}>
        <header className={css.agentHeader}>
          <h2>{props.t('agent')}</h2>
          <span>{props.t('newConversation')}</span>
        </header>
        <div className={css.agentContext}>{props.t('context', { title: draft.title })}</div>
        <div className={css.messages}>
          <p className={css.agentHint}>{props.t('agentHint')}</p>
          {!data.available && <p role="status">{props.t('unavailable')}</p>}
          {conversation?.tasks.map(task => (
            <section key={task.id}>
              <div className={css.userMessage}>{task.prompt}</div>
              <div className={css.assistantMessage}>
                {task.status === 'running' ? (
                  <p role="status">{props.t('running')}</p>
                ) : task.status === 'completed' ? (
                  task.reply
                ) : task.status === 'interrupted' ? (
                  props.t('interrupted')
                ) : task.status === 'cancelled' ? (
                  props.t('cancelledStatus')
                ) : (
                  props.t('failed', { message: task.error ?? '' })
                )}
              </div>
              {task.status === 'running' && (
                <Button size="sm" onClick={() => void props.cancel(novelId, task.id)}>
                  {props.t('stop')}
                </Button>
              )}
            </section>
          ))}
        </div>
        <div className={css.composer}>
          {selection && (
            <div className={css.row}>
              <span>{props.t('selected')}</span>
              <Button
                size="sm"
                onClick={() => {
                  setSelection(null)
                }}
              >
                {props.t('clearSelection')}
              </Button>
            </div>
          )}
          <textarea
            rows={4}
            aria-label={props.t('prompt')}
            placeholder={props.t('prompt')}
            value={view.prompts[id] ?? ''}
            disabled={Boolean(proposal) || running || data.busy[`send:${id}`]}
            onChange={(e) => {
              props.actions.prompt(id, e.target.value)
            }}
          />
          <div className={css.row}>
            <small>{props.t(draft.dirty ? 'pendingSave' : 'wholeDocument')}</small>
            <Button
              variant="primary"
              disabled={
                !data.available ||
                busy ||
                Boolean(proposal) ||
                draft.conflict ||
                running ||
                data.busy[`send:${id}`] ||
                !(view.prompts[id] ?? '').trim()
              }
              onClick={() => void props.send(novelId, id, draft, view.prompts[id] ?? '', selection)}
            >
              {props.t('send')}
            </Button>
          </div>
        </div>
      </aside>
    </>
  )
}

function ProposalPreview(props: NovelProps & { content: string; proposal: NovelProposal; stale: boolean }) {
  if (props.stale)
    return (
      <div className={css.preview}>
        {props.proposal.changes.map((change, index) => (
          <div className={css.diff} key={index}>
            <div className={css.old}>
              <small>{props.t('original')}</small>
              <pre>{change.before}</pre>
            </div>
            <div className={css.new}>
              <small>{props.t('replacement')}</small>
              <pre>{change.after}</pre>
            </div>
          </div>
        ))}
      </div>
    )
  let offset = 0
  const parts = props.proposal.changes.map((change, index) => {
    const preceding = props.content.slice(offset, change.start)
    offset = change.end
    return (
      <div key={index}>
        <pre>{preceding}</pre>
        <div className={css.diff}>
          <div className={css.old}>
            <small>{props.t('original')}</small>
            <pre>{change.before}</pre>
          </div>
          <div className={css.new}>
            <small>{props.t('replacement')}</small>
            <pre>{change.after}</pre>
          </div>
        </div>
      </div>
    )
  })
  return (
    <div className={css.preview}>
      {parts}
      <pre>{props.content.slice(offset)}</pre>
    </div>
  )
}
