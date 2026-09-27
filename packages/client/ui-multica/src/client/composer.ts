/** Controlled professional prompt entry rendered by the conversation UI plugin. */
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Replaces the professional input; receives the target draft, selection and task actions. No entry hides the composer. */
    'multica.assistant.composer': {
      kind: 'single'
      scope: 'root'
      owner: {
        value: string
        label: string
        placeholder: string
        disabled: boolean
        sendDisabled: boolean
        modelLocked: boolean
        selection: ModelSelection | null
        onChange: (value: string) => void
        onSelect: (selection: ModelSelection) => void
        onSend: () => void
        onStop?: () => void
      }
    }
  }
}
