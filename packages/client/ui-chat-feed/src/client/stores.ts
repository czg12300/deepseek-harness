/** Per-Session Chat view store. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ChatStoreState, TurnProcessViewEntry } from './contract/store.ts'

type ChatActions = {
  setTurnProcessOpen: (
    draft: ChatStoreState,
    sessionId: string,
    turn: number,
    answerStep: number,
    open: boolean,
  ) => void
}

/**
 * Resolve the manually expanded answer for one Turn.
 * @param state - Chat store snapshot.
 * @param turn - owning Turn.
 * @param sessionId - independently selected Session.
 * @returns the Turn's stored entry, when present.
 */
export function storedTurnProcessEntry(
  state: Readonly<ChatStoreState>,
  turn: number,
  sessionId: string,
): Readonly<TurnProcessViewEntry> | undefined {
  return state.turnProcesses.find(entry => entry.turn === turn && entry.sessionId === sessionId)
}

/**
 * Create the Chat view store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    init: (): ChatStoreState => ({ turnProcesses: [] }),
    actions: {
      setTurnProcessOpen: (draft, sessionId, turn, answerStep, open) => {
        const index = draft.turnProcesses.findIndex(entry => entry.turn === turn && entry.sessionId === sessionId)
        if (!open) {
          if (index >= 0) draft.turnProcesses.splice(index, 1)
          return
        }
        const next = { sessionId, turn, answerStep } satisfies TurnProcessViewEntry
        if (index < 0) draft.turnProcesses.push(next)
        else draft.turnProcesses[index] = next
      },
    },
  })
}
