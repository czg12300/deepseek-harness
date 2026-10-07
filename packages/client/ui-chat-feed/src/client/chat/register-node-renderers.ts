import type { Context } from '@deepseek-ai/cordis'
import { NS } from '../locale.ts'
import { AssistantNodeView } from './AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from './CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
} from './MessageItem.tsx'
import { SystemPromptNodeView } from './SystemPromptRow.tsx'
import { TurnProcessNodeView } from './TurnProcessNodeView.tsx'
import { TurnTailNodeView } from './TurnTailNodeView.tsx'

/**
 * Register this package's business renderers behind the keyed Chat Node seat.
 * @param ctx - owning UI Conversation context.
 */
export function registerChatNodeRenderers(ctx: Context): void {
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'user', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'steering', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'context', locale: NS }, ContextMessageNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'system-prompt', locale: NS }, SystemPromptNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'assistant-step', locale: NS }, AssistantNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register({
    name: 'chat-feed.node',
    key: 'command',
    locale: NS,
    children: { 'chat-feed.commandview': { kind: 'keyed', scope: 'root' } },
  }, CommandNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'manual-compaction', locale: NS }, ManualCompactionNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'compaction', locale: NS }, CompactionNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'model-retry', locale: NS }, RetryNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'turn-error', locale: NS }, TurnErrorNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'turn-max-tokens', locale: NS }, TurnMaxTokensNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'turn-process', locale: NS }, TurnProcessNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register({
    name: 'chat-feed.node',
    key: 'turn-tail',
    locale: NS,
    children: {
      'chat-feed.turnTail': { kind: 'chain', scope: 'root' },
      'chat-feed.assistant-actions': { kind: 'list', scope: 'root' },
    },
  }, TurnTailNodeView))
  ctx.slots.inject('chat-feed.node', () => ctx.slots.register(
    { name: 'chat-feed.node', key: 'unknown', locale: NS }, UnknownNodeView))
}
