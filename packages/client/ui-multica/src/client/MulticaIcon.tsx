/** Decorative film-frame icon; the sidebar owns its label and click behavior. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** @param props - sidebar-owned icon geometry. @returns a decorative film-frame glyph. */
export function MulticaIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4M10 9l5 3-5 3z" />
    </svg>
  )
}
