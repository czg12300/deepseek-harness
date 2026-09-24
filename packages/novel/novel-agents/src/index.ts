/** Scoped novel authoring through the existing Agent loop and durable Session messages. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-novel-core'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, type Scope } from '@deepseek-ai/dsh-scope'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import {
  attachStructuredRuntime,
  STRUCTURED_OUTPUT_INSTRUCTION,
  STRUCTURED_OUTPUT_TOOL,
} from '@deepseek-ai/dsh-subagent-in-process-driver'
import { RUN_CODE_NAME, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {
  NovelAssistantBackend,
  NovelAssistantResult,
  NovelTask,
  NovelTaskId,
} from '@deepseek-ai/dsh-novel-core/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Execution budgets for each explicit authoring request. */
export interface Config {
  /** Maximum output tokens; defaults to 8192. */
  maxTokens?: number
  /** Maximum entered model steps; defaults to 8. */
  maxSteps?: number
  /** Task deadline in milliseconds; defaults to 180000. */
  timeoutMs?: number
}
interface Active {
  task: NovelTask
  controller: AbortController
  messageId: MessageId
  agent?: Agent
  turn?: number
  steps: number
  failure?: Error
  done: Promise<void>
  finish: () => void
}

/** One read-only execution backend with host-validated proposal output. */
export class NovelAgents extends Service implements NovelAssistantBackend {
  static inject = [
    'novelProjects',
    'agents',
    'agentDefaultModel',
    'agentPresets',
    'sessionPersistence',
    'systemPrompt',
    'tools',
    'llm',
  ]
  static Config = Schema.object({
    maxTokens: Schema.number().min(1).step(1).default(8192),
    maxSteps: Schema.number().min(1).step(1).default(8),
    timeoutMs: Schema.number().min(1).step(1).default(180000),
  })
  private readonly active = new Map<SessionId, Active>()
  private readonly policies = new Map<Agent, Scope>()
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly limits: Required<Config>
  private closing = false

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'novelAgents')
    this.limits = NovelAgents.Config(config)
    ctx.on('agent/created', ({ agent }) => {
      this.bind(agent)
    })
    ctx.effect(() => ctx.novelProjects.registerAssistant(this))
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled([...this.active.values()].map(active => this.cancel(active.task.id)))
      await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
      await Promise.allSettled([...this.policies.values()].map(scope => scope.dispose()))
      this.handles.clear()
      this.policies.clear()
    })
  }

  async execute(task: NovelTask): Promise<NovelAssistantResult> {
    if (this.closing) throw new Error('Novel assistant is stopping')
    this.ctx.novelProjects.assertTask(task)
    if (this.active.has(task.sessionId)) throw new Error('Novel conversation is already running')
    const message = createUserMessage({
      content: [
        { type: 'text', text: task.prompt },
        {
          type: 'text',
          text: JSON.stringify({
            project: task.project,
            baseRevision: task.baseRevision,
            title: task.title,
            content: task.content,
            editableSpans: task.spans,
            references: task.references.map(({ title, revision, content }) => ({ title, revision, content })),
          }),
        },
      ],
      source: { kind: 'user' },
    })
    let finish!: () => void
    const active: Active = {
      task,
      controller: new AbortController(),
      messageId: message.id,
      steps: 0,
      done: new Promise<void>((resolve) => {
        finish = resolve
      }),
      finish: () => {
        finish()
      },
    }
    this.active.set(task.sessionId, active)
    let scope: Scope | undefined
    const timer = setTimeout(() => {
      active.controller.abort(new Error('Novel assistant exceeded its time limit'))
      active.agent?.cancel({ kind: 'hook', reason: 'Novel task time limit' })
    }, this.limits.timeoutMs)
    try {
      const agent = await this.agent(task, active.controller.signal)
      active.agent = agent
      active.controller.signal.throwIfAborted()
      const key = scopeOf(agent.ctx)
      if (!key) throw new Error('Novel Agent has no registration scope')
      scope = createScope(this.ctx, key)
      const capture = attachStructuredRuntime(scope.ctx, this.schema(task))
      agent.followup(message)
      await agent.whenIdle()
      active.controller.signal.throwIfAborted()
      if (active.failure) throw active.failure
      const output = capture.captured()
      if (!output) throw new Error('Novel assistant did not return a complete structured response')
      await this.ctx.sessionPersistence.flush()
      // The novel task store validates model JSON before publishing any proposal.
      return output.value as NovelAssistantResult
    } finally {
      clearTimeout(timer)
      try {
        if (scope) await scope.dispose()
      } finally {
        this.active.delete(task.sessionId)
        active.finish()
      }
    }
  }

  async cancel(id: NovelTaskId): Promise<void> {
    const active = [...this.active.values()].find(item => item.task.id === id)
    if (!active) return
    active.controller.abort(new DOMException('Novel task cancelled', 'AbortError'))
    active.agent?.cancel({ kind: 'user' })
    await active.done
  }

  private bind(agent: Agent): void {
    if (this.policies.has(agent)) return
    const route = this.ctx.novelProjects.sessionRoute(agent.id)
    if (!route) {
      const parent = agent.session.header.parentSession
      if (parent && this.ctx.novelProjects.sessionRoute(parent))
        throw new Error('Novel Sessions cannot be forked outside their authoring workspace')
      return
    }
    const key = scopeOf(agent.ctx)
    if (!key) throw new Error('Novel Session has no Agent scope')
    const scope = createScope(this.ctx, key)
    this.policies.set(agent, scope)
    scope.ctx.tools.restrict({ allow: [] })
    scope.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: scope.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      complete: true,
      text: `You are a novel-writing assistant. Respond in the author's language. Work on the exact saved document and editable spans in the current request. References are read-only story context. Preserve established facts unless the author requests a change. Return an explanation and replacements for editable span IDs; use no replacements when answering a question. Never claim that a suggested edit has already been saved.\n\n${STRUCTURED_OUTPUT_INSTRUCTION}`,
    })
    scope.ctx.systemPrompt.suppressRuntimeContext()
    scope.ctx.tools.guard((execution) => {
      const active = this.active.get(agent.id)
      return active &&
        !active.controller.signal.aborted &&
        [STRUCTURED_OUTPUT_TOOL, RUN_CODE_NAME].includes(execution.name)
        ? undefined
        : 'Novel authoring permits only the active task structured response'
    })
    scope.ctx.on('agent/pre-step', async (payload, next) => {
      const active = this.active.get(agent.id)
      if (!active || active.controller.signal.aborted) return { kind: 'reject' }
      if (active.turn === undefined) {
        if (payload.messages.length !== 1 || payload.messages[0]?.id !== active.messageId) return { kind: 'reject' }
        active.turn = payload.turn
      } else if (payload.turn !== active.turn || payload.messages.length !== 0) return { kind: 'reject' }
      if (active.steps >= this.limits.maxSteps) {
        active.failure = new Error('Novel assistant exceeded its step limit')
        return { kind: 'reject' }
      }
      const decision = await next()
      if (decision.kind === 'enter' && decision.messages.some(message => message.id !== active.messageId))
        return { kind: 'reject' }
      if (decision.kind === 'enter') active.steps++
      return decision
    })
    scope.ctx.on('agent/error', ({ turn, error }) => {
      const active = this.active.get(agent.id)
      if (active?.turn === turn)
        active.failure = error instanceof Error ? error : new Error('Novel model request failed')
    })
  }

  private async agent(task: NovelTask, signal: AbortSignal): Promise<Agent> {
    const existing = this.ctx.agents.get(task.sessionId)
    if (existing) {
      if (existing.status !== 'idle') throw new Error('Novel Session is already active')
      this.bind(existing)
      return existing
    }
    const route = this.ctx.novelProjects.sessionRoute(task.sessionId)
    if (!route) throw new Error('Novel Session is not registered')
    const stored = await this.ctx.sessionPersistence.stat(task.sessionId, { signal })
    if (!stored && this.ctx.novelProjects.sessionInitialized(task.sessionId))
      throw new Error('Novel Session history is missing; restore the project backup')
    const selected = this.ctx.agentDefaultModel.currentSelection()
    const setup = async (ctx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(ctx, 'novel')
    }
    const agentOptions = { provider: selected.provider, model: selected.model, maxTokens: this.limits.maxTokens }
    const handle = stored
      ? await this.ctx.agents.resume({ resumeSessionId: task.sessionId, signal, agentOptions, setup })
      : await this.ctx.agents.create({
        sessionId: task.sessionId,
        signal,
        agentOptions,
        setup,
        meta: { cwd: route.directory, agentPreset: 'novel' },
      })
    this.handles.set(task.sessionId, handle)
    await this.ctx.sessionPersistence.flush()
    this.ctx.novelProjects.markSessionInitialized(task.sessionId)
    return handle.agent
  }

  private schema(task: NovelTask): ObjectJsonSchema {
    return {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'An explanation to the author, in their language.' },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              spanId: { type: 'string', enum: task.spans.map(span => span.id) },
              replacement: { type: 'string' },
            },
            required: ['spanId', 'replacement'],
            additionalProperties: false,
          },
        },
      },
      required: ['reply', 'replacements'],
      additionalProperties: false,
    }
  }
}

export default NovelAgents
