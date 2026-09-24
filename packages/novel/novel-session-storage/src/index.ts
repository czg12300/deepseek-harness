/** Route novel Sessions into their project directory while retaining ordinary JSONL storage. */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { join, resolve } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-novel-core'

/** Ordinary Session storage keeps the same configured location and encoding. */
export interface Config {
  /** Existing default JSONL root for non-novel Sessions. */
  root: string
  /** Physical JSONL encoding, including novel Session files. */
  compression?: 'none' | 'zstd'
}

/** A persistence provider routes every operation by durable Session ownership. */
export class NovelSessionStorage extends SessionPersistence {
  static inject = ['novelProjects']
  static Config = Schema.object({
    root: Schema.string().required(),
    compression: Schema.union(['none', 'zstd']).default('zstd'),
  })
  private readonly providers = new Map<
    string,
    Promise<{ dispose: () => Promise<void>; persistence: SessionPersistence }>
  >()
  private closing = false
  private readonly root: string

  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx)
    this.root = resolve(config.root)
    ctx.effect(() => async () => {
      this.closing = true
      const results = await Promise.allSettled(
        [...this.providers.values()].map(async (pending) => {
          await (await pending).dispose()
        }),
      )
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failures.length)
        throw new AggregateError(
          failures.map(r => r.reason as unknown),
          'Novel Session storage disposal failed',
        )
    })
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    return (await this.forSession(header.id)).create(header, options)
  }
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    return (await this.forSession(id)).open(id, access, options)
  }
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    return (await this.forSession(id)).stat(id, options)
  }
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const roots = new Set([
      this.root,
      ...this.ctx.novelProjects.sessionRoutes().map(route => join(route.directory, '.novel', 'sessions')),
    ])
    const groups = await Promise.all([...roots].map(async root => (await this.provider(root)).list(options)))
    const result = groups.flat()
    if (new Set(result.map(entry => entry.header.id)).size !== result.length)
      throw new Error('Session identity exists in more than one novel storage root')
    return result
  }
  async flush(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.providers.values()].map(async pending => (await pending).persistence.flush()),
    )
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failures.length)
      throw new AggregateError(
        failures.map(r => r.reason as unknown),
        `Novel Session storage flush failed: ${failures.map(r => failureMessage(r.reason)).join('; ')}`,
      )
  }

  private forSession(id: SessionId): Promise<SessionPersistence> {
    const route = this.ctx.novelProjects.sessionRoute(id)
    return this.provider(route ? join(route.directory, '.novel', 'sessions') : this.root)
  }
  private async provider(root: string): Promise<SessionPersistence> {
    if (this.closing) throw new Error('Novel Session storage is stopping')
    let pending = this.providers.get(root)
    if (!pending) {
      pending = (async () => {
        const ctx = this.ctx.isolate('sessionPersistence')
        try {
          const fiber = ctx.plugin(JsonlSessionPersistence, {
            root,
            ...(this.config.compression === undefined ? {} : { compression: this.config.compression }),
          })
          await fiber
          const persistence = ctx.get('sessionPersistence')
          if (!persistence) throw new Error('JSONL provider is not ready')
          return { dispose: () => fiber.dispose(), persistence }
        } catch (error) {
          this.providers.delete(root)
          throw error
        }
      })()
      this.providers.set(root, pending)
    }
    return (await pending).persistence
  }
}

export default NovelSessionStorage

/** Preserve nested filesystem failure detail at the routing layer. */
function failureMessage(error: unknown): string {
  if (error instanceof AggregateError) return `${error.message}: ${error.errors.map(failureMessage).join('; ')}`
  return error instanceof Error ? error.message : String(error)
}
