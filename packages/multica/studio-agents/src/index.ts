/** Professional Agent execution over frozen project workspaces and ordinary durable Session messages. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProjectSessions } from './project-sessions.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-studio-core'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig, MessageId } from '@deepseek-ai/dsh-llm'
import { createScope, scopeOf, type Scope } from '@deepseek-ai/dsh-scope'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { attachStructuredRuntime, STRUCTURED_OUTPUT_TOOL, STRUCTURED_OUTPUT_INSTRUCTION } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type { StructuredAttachment } from '@deepseek-ai/dsh-subagent-in-process-driver'
import { RUN_CODE_NAME, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  StudioAssistantBackend,
  StudioAssistantCatalog,
  StudioAssistantResult,
  StudioRoleRevision,
  StudioResolvedRole,
  StudioTask,
  StudioTaskId,
} from '@deepseek-ai/dsh-studio-core/types'

function modelCall(selection: Pick<StudioResolvedRole, 'provider' | 'model' | 'reasoningEffort'>, maxTokens: number): LlmCallConfig {
  return {
    provider: selection.provider,
    model: selection.model,
    maxTokens,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
  }
}

/** Deployment storage for local Session working directories. */
export interface Config {
  /** Harness home containing the professional Session directories. */
  dshHome?: string
}

/** A trusted host integration may contribute a specific read-only tool, including an audited MCP read operation. */
export interface StudioContextTool {
  name: string
  description: string
  source: 'builtin' | 'mcp'
  parameters: ObjectJsonSchema
  /** Read only within the captured task scope; mutations and paid operations require separate production services.
   * @param task - host-frozen project and role context.
   * @param args - schema-validated model input.
   * @param signal - task/tool cancellation.
   * @returns JSON data committed by the normal tool-result pipeline.
   */
  execute(task: Readonly<StudioTask>, args: unknown, signal: AbortSignal): Promise<JsonValue>
}

interface ActiveTask {
  task: StudioTask
  controller: AbortController
  messageId: MessageId
  agent?: Agent
  turn?: number
  steps: number
  failure?: Error
  done: Promise<void>
  finish(): void
}

const STUDIO_PRESET = 'multica'
const ENABLED_ROLES = ['planner', 'writer'] as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Controlled professional Sessions and host-approved context-tool contributions. */
    studioAgents: StudioAgents
  }
}

/** Scoped professional execution; no project mutation or approval tool is installed on an Agent. */
export class StudioAgents extends Service implements StudioAssistantBackend {
  static inject = [
    'studioProjects',
    'agents',
    'agentPresets',
    'agentDefaultModel',
    'sessionPersistence',
    'systemPrompt',
    'tools',
    'llm',
    'skills',
  ]
  static Config: Schema<Config> = Schema.object({ dshHome: Schema.string() })

  private readonly directory: string
  private readonly handles = new Map<string, AgentHandle>()
  private readonly policies = new Map<Agent, Scope>()
  private readonly draining = new Set<Promise<void>>()
  private readonly active = new Map<StudioTaskId, ActiveTask>()
  private readonly bySession = new Map<string, ActiveTask>()
  private readonly contextTools = new Map<string, StudioContextTool>()
  private closing = false
  private readonly projectStores = new Map<string, { store: ProjectSessions; remove: () => Promise<void> }>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'studioAgents')
    this.directory = resolve(resolveDshHome(config.dshHome), 'multica', 'sessions')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    ctx.on('agent/created', ({ agent }) => {
      this.bindPolicy(agent)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      const active = this.bySession.get(agent.id)
      if (active) active.controller.abort(new DOMException('The professional Session was disposed', 'AbortError'))
      void this.disposePolicy(agent).catch((error: unknown) => {
        ctx.logger.error('Professional Session policy disposal failed', error)
      })
    })
    this.registerContextTool({
      name: 'studio_read_approved',
      source: 'builtin',
      description: 'Read the exact content of an approved review listed in this task. New approvals and other projects are not accessible.',
      parameters: { type: 'object', properties: { reviewId: { type: 'string' } }, required: ['reviewId'], additionalProperties: false },
      execute: (task, args) => {
        const requested = args as { reviewId: string }
        const review = task.reviews.find(review => review.id === requested.reviewId && review.status === 'approved')
        if (!review) throw new Error('The requested review is not an approved input of this task')
        // Project storage validates every DTO field as JSON on read.
        return Promise.resolve(this.ctx.studioProjects.approvedContext(review.id) as unknown as JsonValue)
      },
    })
    ctx.effect(() =>
      ctx.studioProjects.registerAssistantBackend({
        catalog: () => this.catalog(),
        resolve: (role, selection) => this.resolve(role, selection),
        execute: task => this.execute(task),
        cancel: id => this.cancel(id),
        closeProject: root => this.closeProject(root),
        openProject: (root, check) =>{  this.openProject(root, check) },
        copySessions: (ids, root, check) => this.copySessions(ids, root, check),
      }),
    )
    ctx.effect(() => async () => {
      this.closing = true
      await Promise.allSettled([...this.active.keys()].map(id => this.cancel(id)))
      await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
      await Promise.allSettled([...this.policies.keys()].map(agent => this.disposePolicy(agent)))
      await Promise.allSettled([...this.draining])
      for (const mounted of this.projectStores.values()) { await mounted.store.close(); await mounted.remove() }
      this.projectStores.clear()
    })
  }

  /** Register a host-reviewed, read-only integration; names cannot collide with structured proposal output.
   * @param tool - trusted implementation and actual source classification.
   * @returns its effect-owned disposer; removing a selected tool makes subsequent tasks fail explicitly.
   */
  registerContextTool(tool: StudioContextTool): () => Promise<void> {
    if (tool.name === STRUCTURED_OUTPUT_TOOL || tool.name === RUN_CODE_NAME || this.contextTools.has(tool.name))
      throw new Error(`Professional tool already registered: ${tool.name}`)
    return this.ctx.effect(() => {
      this.contextTools.set(tool.name, tool)
      return () => {
        this.contextTools.delete(tool.name)
      }
    })
  }

  /** Read available professional roles and actual skill/tool registrations.
   * @returns dependency choices without invoking a model.
   */
  async catalog(): Promise<StudioAssistantCatalog> {
    const selected = this.ctx.agentDefaultModel.currentSelection()
    const skills = await this.ctx.skills.list({ cwd: this.directory })
    return {
      backendAvailable: !this.closing,
      enabledRoles: [...ENABLED_ROLES],
      defaultModel: { ...selected },
      skills: skills
        .filter(skill => skill.invocation.userInvocable)
        .map(skill => ({ name: skill.name, description: skill.description })),
      tools: [...this.contextTools.values()].map(tool => ({ name: tool.name, description: tool.description, source: tool.source })),
    }
  }

  /** Resolve a task model and selected dependency content before admission.
   * @param role - immutable, validated role configuration.
   * @param selection - explicit task model selection, overriding the role default.
   * @returns the effective model and selected skill bodies/tool identities.
   */
  async resolve(role: StudioRoleRevision, selection?: Pick<StudioResolvedRole, 'provider' | 'model' | 'reasoningEffort'>): Promise<StudioResolvedRole> {
    if (this.closing) throw new Error('Professional execution is stopping')
    let selected: Pick<StudioResolvedRole, 'provider' | 'model' | 'reasoningEffort'>
    if (selection) selected = selection
    else if (role.config.provider === null) selected = this.ctx.agentDefaultModel.currentSelection()
    else {
      if (role.config.model === null) throw new Error('Select both provider and model in the professional configuration')
      selected = { provider: role.config.provider, model: role.config.model }
    }
    await this.ctx.llm.prepareCall(modelCall(selected, role.config.maxTokens))
    const skills = []
    for (const name of role.config.skills) {
      const skill = await this.ctx.skills.get(name, { cwd: this.directory })
      if (!skill || !skill.invocation.userInvocable) throw new Error(`Professional skill is unavailable: ${name}`)
      skills.push({ name, content: skill.content })
    }
    for (const name of role.config.tools)
      if (!this.contextTools.has(name)) throw new Error(`No controlled read-only tool is registered for ${name}`)
    return { ...selected, skills, tools: [...role.config.tools] }
  }

  /** Drive exactly one explicit task, retaining Session history while task-local tools are disposed.
   * @param task - fully frozen, persisted task supplied by the project service.
   * @returns only an authoritative, logged structured result.
   */
  async execute(task: StudioTask): Promise<StudioAssistantResult> {
    if (this.closing) throw new Error('Professional execution is stopping')
    this.ctx.studioProjects.assertAssistantTask(task)
    if (task.role.role !== 'planner' && task.role.role !== 'writer')
      throw new Error('This professional role is not enabled for text authoring')
    if (this.bySession.has(task.sessionId)) throw new Error('This professional workspace is already running')
    const message = createUserMessage({
      content: [
        { type: 'text', text: task.prompt },
        {
          type: 'text',
          text: JSON.stringify({
            taskId: task.id,
            target: task.target,
            baseRevision: task.expectedRevision,
            roleRevision: task.role.revision,
            input: task.input,
            selectedSkills: task.resolved.skills,
            reviewReferences: task.reviews,
          }),
        },
      ],
      source: { kind: 'user' },
    })
    let finish!: () => void
    const active: ActiveTask = {
      task,
      controller: new AbortController(),
      messageId: message.id,
      steps: 0,
      done: new Promise<void>((resolveDone) => {
        finish = resolveDone
      }),
      finish: () => {
        finish()
      },
    }
    this.active.set(task.id, active)
    this.bySession.set(task.sessionId, active)
    let scope: Scope | undefined
    const timer = setTimeout(() => {
      active.controller.abort(new Error('Professional task exceeded its configured time limit'))
      active.agent?.cancel({ kind: 'hook', reason: 'Professional task time limit' })
    }, task.role.config.timeoutMs)
    try {
      const agent = await this.ensureAgent(task, active.controller.signal)
      active.agent = agent
      active.controller.signal.throwIfAborted()
      if (agent.status !== 'idle') await agent.whenIdle()
      active.controller.signal.throwIfAborted()
      const key = scopeOf(agent.ctx)
      if (!key) throw new Error('Professional Agent has no registration scope')
      scope = createScope(this.ctx, key)
      const capture = attachStructuredRuntime(scope.ctx, this.outputSchema(task))
      for (const name of task.resolved.tools) {
        const tool = this.contextTools.get(name)
        if (!tool) throw new Error(`Selected professional tool was removed: ${name}`)
        scope.ctx.tools.register({
          name,
          description: tool.description,
          parameters: { ...tool.parameters },
          output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
          execute: (args, execution) => tool.execute(task, args, execution.signal),
        })
      }
      agent.followup(message)
      await agent.whenIdle()
      active.controller.signal.throwIfAborted()
      if (active.failure) throw active.failure
      return this.capturedResult(capture)
    } finally {
      clearTimeout(timer)
      try {
        if (scope) await scope.dispose()
      } finally {
        this.active.delete(task.id)
        this.bySession.delete(task.sessionId)
        active.finish()
      }
    }
  }

  /** Cancel task work and await its actual settlement.
   * @param id - host-owned task identity.
   * @returns after all task-local tools and pending model work have stopped.
   */
  async cancel(id: StudioTaskId): Promise<void> {
    const active = this.active.get(id)
    if (!active) return
    active.controller.abort(new DOMException('Professional task cancelled by the user', 'AbortError'))
    active.agent?.cancel({ kind: 'user' })
    await active.done
  }

  private bindPolicy(agent: Agent): void {
    if (this.policies.has(agent)) return
    const workspace = this.ctx.studioProjects.workspaceForSession(agent.id)
    if (!workspace) {
      const parent = agent.session.header.parentSession
      if (parent && this.ctx.studioProjects.workspaceForSession(parent))
        throw new Error('Professional Sessions must be continued through their bound Comics workspace')
      return
    }
    const key = scopeOf(agent.ctx)
    if (!key) throw new Error('Professional Session is missing its Agent scope')
    const scope = createScope(this.ctx, key)
    this.policies.set(agent, scope)
    scope.ctx.tools.restrict({ allow: [] })
    scope.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: scope.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      complete: true,
      text: `${workspace.role.config.persona}\n\n${workspace.target.kind === 'outline' ? OUTLINE_INSTRUCTION : ''}Work only on the frozen target in the supplied task. Never approve content, apply project edits, or authorize paid production.\n${STRUCTURED_OUTPUT_INSTRUCTION}`,
    })
    scope.ctx.systemPrompt.suppressRuntimeContext()
    scope.ctx.tools.guard((execution) => {
      const active = this.bySession.get(agent.id)
      return active &&
        (execution.name === STRUCTURED_OUTPUT_TOOL ||
          execution.name === RUN_CODE_NAME ||
          active.task.resolved.tools.includes(execution.name))
        ? undefined
        : 'Only the current Comics task may use its configured proposal and read-only tools'
    })
    scope.ctx.on('agent/pre-step', async (payload, next) => {
      const active = this.bySession.get(agent.id)
      if (!active || active.controller.signal.aborted) return { kind: 'reject' }
      if (active.turn === undefined) {
        if (payload.messages.length !== 1 || payload.messages[0]?.id !== active.messageId) return { kind: 'reject' }
        active.turn = payload.turn
      } else if (payload.turn !== active.turn || payload.messages.length !== 0) return { kind: 'reject' }
      if (active.steps >= active.task.role.config.maxSteps) {
        active.failure = new Error('Professional task exceeded its configured step limit')
        return { kind: 'reject' }
      }
      const decision = await next()
      if (decision.kind === 'enter' && decision.messages.some(message => message.id !== active.messageId)) return { kind: 'reject' }
      if (decision.kind === 'enter') active.steps++
      return decision
    })
    scope.ctx.on('agent/error', ({ turn, error }) => {
      const active = this.bySession.get(agent.id)
      if (active?.turn === turn) active.failure = error instanceof Error ? error : new Error('Professional model request failed')
    })
    scope.ctx.on('agent/request', async (_payload, next) => {
      await next()
      const active = this.bySession.get(agent.id)
      if (!active) throw new Error('Professional model request has no frozen task')
      return modelCall(active.task.resolved, active.task.role.config.maxTokens)
    })
  }

  private async ensureAgent(task: StudioTask, signal: AbortSignal): Promise<Agent> {
    const project = this.ctx.studioProjects.sessionProject(task.sessionId)
    if (project) this.openProject(project.root, project.check)
    const existing = this.ctx.agents.get(task.sessionId)
    if (existing) {
      if (existing.status !== 'idle' && !this.policies.has(existing))
        throw new Error('The professional Session is already active outside this runtime')
      this.bindPolicy(existing)
      this.ctx.studioProjects.markWorkspaceSession(task.workspaceId)
      return existing
    }
    const stored = await this.ctx.sessionPersistence.stat(task.sessionId, { signal })
    const workspace = this.ctx.studioProjects.workspaceForSession(task.sessionId)
    if (!workspace) throw new Error('Professional Session has no workspace binding')
    if (!stored && workspace.initialized)
      throw new Error('Professional Session history is missing; restore its log or publish a new role configuration')
    const setup = async (agentCtx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, STUDIO_PRESET)
    }
    const agentOptions = modelCall(task.resolved, task.role.config.maxTokens)
    const handle = stored
      ? await this.ctx.agents.resume({ resumeSessionId: task.sessionId, signal, agentOptions, setup })
      : await this.ctx.agents.create({
        sessionId: task.sessionId,
        signal,
        agentOptions,
        setup,
        meta: { ...project ? {} : { cwd: this.directory }, agentPreset: STUDIO_PRESET },
      })
    this.handles.set(task.sessionId, handle)
    this.ctx.studioProjects.markWorkspaceSession(task.workspaceId)
    return handle.agent
  }

  /**
   * Release the project runtime after its tasks settle.
   * @param root - current project directory.
   */
  async closeProject(root: string): Promise<void> {
    await this.projectStores.get(root)?.store.flush()
    for (const [id, handle] of [...this.handles]) {
      if (this.ctx.studioProjects.sessionProject(handle.agent.id)?.root !== root) continue
      await handle.dispose()
      this.handles.delete(id)
    }
    const mounted = this.projectStores.get(root)
    if (mounted) {
      await mounted.store.close()
      await mounted.remove()
      this.projectStores.delete(root)
    }
  }

  /**
   * Mount project history without a model request.
   * @param root - opened directory.
   * @param check - disk identity check.
   */
  openProject(root: string, check: () => void): void {
    if (this.projectStores.has(root)) return
    const store = new ProjectSessions(root, check)
    const remove = this.ctx.sessionPersistence.registerStore({
      backend: store,
      owns: id => this.ctx.studioProjects.sessionProject(id)?.root === root,
    })
    const stop = this.ctx.on('session/event', (session, event) => {
      if (this.ctx.studioProjects.sessionProject(session.id)?.root !== root) return
      void store.record(session.id, event).catch((error: unknown) => {
        const active = this.bySession.get(session.id)
        if (active) { active.failure = error instanceof Error ? error : new Error(String(error)); active.controller.abort(active.failure) }
        this.ctx.logger.error('Unable to persist project conversation', error)
      })
    })
    const stopFlush = this.ctx.on('session/flush', async (session) => {
      if (this.ctx.studioProjects.sessionProject(session.id)?.root === root) await store.flush()
    })
    this.projectStores.set(root, { store, remove: async () => { stop(); stopFlush(); await remove() } })
  }

  /**
   * Copy legacy dialogue before installing its project route.
   * @param ids - initialized identities.
   * @param root - destination folder.
   * @param check - disk identity check.
   */
  async copySessions(ids: SessionId[], root: string, check: () => void): Promise<void> {
    const destination = new ProjectSessions(root, check)
    try {
      for (const id of ids) {
        const live = this.handles.get(id)
        if (live) { await live.dispose(); this.handles.delete(id) }
        const source = await this.ctx.sessionPersistence.open(id, 'read')
        try {
          const target = await destination.create(source.header, { inheritedEventCount: source.inheritedEventCount })
          try {
            const content = await source.read()
            await target.append(content.events)
            await target.flush()
          } finally { await target.close() }
        } finally { await source.close() }
      }
    } finally { await destination.close() }
  }

  private outputSchema(task: StudioTask): ObjectJsonSchema {
    return {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Your explanation to the creator, in their language.' },
        changes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', enum: this.ctx.studioProjects.proposalFields(task.target) },
              value: {},
            },
            required: ['field', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['reply', 'changes'],
      additionalProperties: false,
    }
  }

  private capturedResult(capture: StructuredAttachment): StudioAssistantResult {
    const captured = capture.captured()
    if (!captured) throw new Error('The Agent did not produce a complete structured response; inspect its Session for the recorded failure')
    // The project service validates every field value and target before recording a proposal.
    return captured.value as StudioAssistantResult
  }

  private disposePolicy(agent: Agent): Promise<void> {
    const scope = this.policies.get(agent)
    if (!scope) return Promise.resolve()
    this.policies.delete(agent)
    const done = scope.dispose()
    this.draining.add(done)
    void done.then(
      () => {
        this.draining.delete(done)
      },
      () => {
        this.draining.delete(done)
      },
    )
    return done
  }
}

const OUTLINE_INSTRUCTION = 'Your primary task is to help the creator write and revise the current project story outline. '
  + 'Use the supplied project concept, sourceText, production specifications and current input.outline, including unsaved edits. '
  + 'For a drafting or revision request, return the complete usable outline in changes as {field: "outline", value: "full outline text"}; '
  + 'do not put the deliverable only in reply or return a fragment that would erase unchanged passages. '
  + 'Develop the premise, central conflict, character arcs, world rules, causal progression and ending as the request requires. '
  + 'Preserve established facts and material outside the requested revision. Mark creative assumptions and ask only for missing information essential to proceed. '
  + 'For analysis-only requests or greetings, answer in reply and leave changes empty. '
  + 'The creator can apply the proposal to the outline editor and save a draft version; do not claim it has already been applied.\n\n'

export default StudioAgents
