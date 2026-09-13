import { randomUUID } from 'node:crypto'
import { existsSync, globSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Persona from '@deepseek-ai/dsh-persona'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import StudioProjects from '@deepseek-ai/dsh-studio-core'
import type { ProjectInput, StudioRequestId, StudioTaskId, StudioTask } from '@deepseek-ai/dsh-studio-core/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import StudioAgents from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
const links: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const link of links.splice(0)) await unlink(link)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function input(patch: Partial<ProjectInput> = {}): ProjectInput {
  return {
    name: 'Project Alpha',
    concept: '',
    sourceText: '',
    aspectRatio: '16:9',
    targetEpisodes: null,
    episodeDuration: null,
    outline: 'Original outline',
    episodes: [],
    ...patch,
  }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0], home?: string) {
  home ??= await mkdtemp(join(tmpdir(), 'dsh-studio-agents-'))
  if (!roots.includes(home)) roots.push(home)
  const personaLink = join(home, 'node_modules/@deepseek-ai/dsh-persona')
  if (!existsSync(personaLink)) {
    await mkdir(dirname(personaLink), { recursive: true })
    await symlink(fileURLToPath(new URL('../../../preset/persona', import.meta.url)), personaLink, 'junction')
    links.push(personaLink)
  }
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = `${pathToFileURL(home).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'logs'), compression: 'none' })
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'creative' })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(AgentPresets, { default: 'multica', roots: [], includeShippedRoot: true, includeUserRoot: false })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  // Product rows go through real Loader configuration; only the expensive model response is scripted.
  const config = join(home, 'studio.cordis.yml')
  await writeFile(
    config,
    `- name: '@deepseek-ai/dsh-studio-core'\n  config:\n    dshHome: ${JSON.stringify(home)}\n- name: '@deepseek-ai/dsh-studio-agents'\n  config:\n    dshHome: ${JSON.stringify(home)}\n`,
  )
  ctx.loader.internal = {
    version: 'v2',
    async import(name: string) {
      if (name === '@deepseek-ai/dsh-studio-core') return { default: StudioProjects }
      if (name === '@deepseek-ai/dsh-studio-agents') return { default: StudioAgents }
      if (name === '@deepseek-ai/dsh-persona') return Persona
      throw new Error(`Unexpected test plugin: ${name}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  return { ctx, adapter, home, projects: ctx.studioProjects }
}

function proposed(text = 'A focused new outline') {
  return toolCallResponse('proposal', 'structured_output', {
    reply: 'A suggested change, awaiting your decision.',
    changes: [{ field: 'outline', value: text }],
  })
}

describe('professional Sessions through Loader and the real loop', () => {
  it('logs the frozen context and real structured result while leaving content for human application and approval', async () => {
    const { ctx, adapter, home, projects } = await setup([proposed()])
    const forbidden = vi.fn(async () => ({}))
    ctx.tools.register({
      name: 'dangerous_write',
      description: 'Must not be exposed to the professional.',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: forbidden,
    })
    const project = projects.create(input())
    const workspace = projects.openWorkspace({ kind: 'outline', projectId: project.id })
    expect(adapter.requests).toHaveLength(0)
    expect(ctx.agents.list()).toHaveLength(0)
    const task = await projects.startAssistant({
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Improve the outline, preserving the setting.',
    })
    const settled = await projects.waitTask(task.id)
    expect(settled.status, settled.error ?? '').toBe('completed')
    expect(adapter.requests).toHaveLength(1)
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).toEqual(['structured_output'])
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Original outline')
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain(task.id)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('Develop comic-series concepts')
    expect(forbidden).not.toHaveBeenCalled()
    expect(projects.get(project.id)).toEqual(project)
    const proposal = projects.workspace(workspace.workspace.id).proposals[0]!
    expect(proposal.target).toEqual({ kind: 'outline', projectId: project.id })
    expect(projects.reviews(project.id)).toEqual([])
    const applied = projects.applyProposal({ proposalId: proposal.id, expectedRevision: 1, input: input(), fields: ['outline'] })
    expect(applied.status).toBe('applied')
    const review = projects.submitReview({ kind: 'outline', projectId: project.id }, 2)
    expect(projects.decideReview(review.id, 'approved', 'Approved by the creator').status).toBe('approved')
    await ctx.sessionPersistence.flush()
    const files = globSync('**/*.jsonl', { cwd: join(home, 'logs') })
    expect(files).toHaveLength(1)
    const log = await readFile(join(home, 'logs', files[0]!), 'utf8')
    expect(log).toContain(task.id)
    expect(log).toContain('Original outline')
    expect(log).toContain('A focused new outline')
    expect(log).toContain('structured_output')
  })

  it('rejects unscoped chat input on a bound professional Session and blocks inherited tools even when requested', async () => {
    const { ctx, adapter, projects } = await setup([toolCallResponse('attempt', 'dangerous_write', {}), proposed()])
    const forbidden = vi.fn(async () => ({}))
    ctx.tools.register({
      name: 'dangerous_write',
      description: 'Inherited capability',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      execute: forbidden,
    })
    const project = projects.create(input())
    const workspace = projects.openWorkspace({ kind: 'outline', projectId: project.id })
    const task = await projects.startAssistant({
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Suggest an outline.',
    })
    expect((await projects.waitTask(task.id)).status).toBe('completed')
    expect(forbidden).not.toHaveBeenCalled()
    expect(adapter.requests).toHaveLength(2)
    const agent = ctx.agents.get(task.sessionId)!
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Write directly outside the workspace' }], source: { kind: 'user' } }),
    )
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(projects.get(project.id)).toEqual(project)
  })

  it('keeps a running task on its original object while another workspace is opened and cancellation drains its model stream', async () => {
    const { adapter, projects } = await setup(['hang'])
    const first = projects.create(input())
    const second = projects.create(input({ name: 'Project Beta' }))
    const workspace = projects.openWorkspace({ kind: 'outline', projectId: first.id })
    const task = await projects.startAssistant({
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Think about the first outline.',
    })
    await expect.poll(() => adapter.requests.length).toBe(1)
    projects.openWorkspace({ kind: 'outline', projectId: second.id })
    expect((await projects.cancelAssistant(task.id)).status).toBe('cancelled')
    expect(projects.workspace(workspace.workspace.id).proposals).toEqual([])
    expect(projects.get(first.id)).toEqual(first)
    expect(projects.get(second.id)).toEqual(second)
  })

  it('resumes the same workspace Session after restart and uses a new Session after publishing role changes', async () => {
    const first = await setup([proposed()])
    const project = first.projects.create(input())
    const target = { kind: 'outline' as const, projectId: project.id }
    const workspace = first.projects.openWorkspace(target)
    const task = await first.projects.startAssistant({
      workspaceId: workspace.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'First request',
    })
    expect((await first.projects.waitTask(task.id)).status).toBe('completed')
    await first.ctx.fiber.dispose()
    const second = await setup([proposed('Second suggestion')], first.home)
    const reopened = second.projects.openWorkspace(target)
    expect(reopened.workspace.sessionId).toBe(task.sessionId)
    expect(reopened.tasks).toHaveLength(1)
    const next = await second.projects.startAssistant({
      workspaceId: reopened.workspace.id,
      requestId: randomUUID() as StudioRequestId,
      expectedRevision: 1,
      input: input(),
      prompt: 'Second request',
    })
    expect((await second.projects.waitTask(next.id)).status).toBe('completed')
    const resumed = JSON.stringify(second.adapter.requests[0]?.messages)
    expect(resumed).toContain('First request')
    expect(resumed).toContain('Second request')
    expect(resumed).toContain('A focused new outline')
    await second.projects.publishRole('planner', 1, { ...reopened.workspace.role.config, persona: 'Plan a restrained mystery.' })
    expect(second.projects.openWorkspace(target).workspace.sessionId).not.toBe(task.sessionId)
  })

  it('refuses a forged task that has no owned durable dispatch', async () => {
    const { ctx, adapter, projects } = await setup([])
    const project = projects.create(input())
    const { workspace } = projects.openWorkspace({ kind: 'outline', projectId: project.id })
    const task: StudioTask = {
      id: randomUUID() as StudioTaskId,
      requestId: randomUUID() as StudioRequestId,
      workspaceId: workspace.id,
      sessionId: workspace.sessionId,
      target: workspace.target,
      role: workspace.role,
      resolved: { provider: 'mock', model: 'creative', skills: [], tools: [] },
      expectedRevision: 1,
      input: input(),
      prompt: 'Unowned dispatch',
      reviews: [],
      status: 'running',
      reply: '',
      error: null,
      createdAt: workspace.createdAt,
      finishedAt: null,
    }
    await expect(ctx.studioAgents.execute(task)).rejects.toThrow('owned frozen task')
    expect(adapter.requests).toHaveLength(0)
  })
  it('exposes only selected context tools and reads the exact approved version captured by the task', async () => {
    const script: ConstructorParameters<typeof MockAdapter>[0] = []
    const { ctx, adapter, projects } = await setup(script)
    const project = projects.create(input())
    const target = { kind: 'outline' as const, projectId: project.id }
    const review = projects.decideReview(projects.submitReview(target, 1).id, 'approved', 'Ready')
    projects.save(project.id, 1, input({ outline: 'Later unapproved draft' }))
    const role = projects.roles().find(role => role.role === 'planner')!
    await projects.publishRole('planner', role.revision, { ...role.config, tools: ['studio_read_approved'] })
    script.push(toolCallResponse('read', 'studio_read_approved', { reviewId: review.id }), proposed())
    const workspace = projects.openWorkspace(target)
    const task = await projects.startAssistant({ workspaceId: workspace.workspace.id, requestId: randomUUID() as StudioRequestId, expectedRevision: 2, input: input({ outline: 'Later unapproved draft' }), prompt: 'Compare with the approved outline.' })
    expect((await projects.waitTask(task.id)).status).toBe('completed')
    const messages = JSON.stringify(adapter.requests[1]?.messages)
    expect(messages).toContain('Original outline')
    expect(messages).toContain('Later unapproved draft')
    expect(messages).toContain(review.id)
    expect(adapter.requests[0]?.tools?.map(tool => tool.name).sort()).toEqual(['structured_output', 'studio_read_approved'].sort())
    expect(projects.get(project.id)?.revision).toBe(2)
    await ctx.sessionPersistence.flush()
  })

  it('ends a task at its configured step limit without exposing a write or approval capability', async () => {
    const { adapter, projects } = await setup([toolCallResponse('attempt', 'unavailable_tool', {}), proposed()])
    const project = projects.create(input())
    const role = projects.roles().find(role => role.role === 'planner')!
    await projects.publishRole('planner', role.revision, { ...role.config, maxSteps: 1 })
    const workspace = projects.openWorkspace({ kind: 'outline', projectId: project.id })
    const task = await projects.startAssistant({ workspaceId: workspace.workspace.id, requestId: randomUUID() as StudioRequestId, expectedRevision: 1, input: input(), prompt: 'Draft an outline.' })
    const settled = await projects.waitTask(task.id)
    expect(settled.status).toBe('failed')
    expect(settled.error).toContain('step limit')
    expect(adapter.requests).toHaveLength(1)
    expect(projects.workspace(workspace.workspace.id).proposals).toEqual([])
    expect(projects.reviews(project.id)).toEqual([])
  })

})
