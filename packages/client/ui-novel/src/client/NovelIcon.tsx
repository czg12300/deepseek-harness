/** Decorative book icon; the sidebar owns its localized label and navigation. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** @param props - shell-owned icon size. @returns a decorative open-book glyph. */
export function NovelIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M12 5C8 3 5 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-3-1-6-1-10 1Zm0 0v15" />
    </svg>
  )
}
