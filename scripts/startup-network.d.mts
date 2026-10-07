/** Dependency-free proxy preparation performed before the source launcher installs packages. */
export interface StartupProxyOptions {
  environment?: Record<string, string | undefined>
  dataHome?: string
  userHome?: string
  platform?: string
  probe?: (url: URL, timeoutMs: number) => Promise<void>
  systemProxy?: () => Promise<string>
}

/** Normalized proxy environment; diagnostics never include proxy credentials. */
export interface StartupProxyResult {
  source: string
  env: Record<string, string>
  messages: string[]
}

/**
 * Resolve explicit proxy settings or discover a reachable fallback for this startup only.
 * @param options - environment, directories and operating-system probe overrides.
 * @returns normalized child environment and redacted diagnostics; rejects invalid or unreachable explicit proxies.
 */
export function prepareStartupProxy(options?: StartupProxyOptions): Promise<StartupProxyResult>
