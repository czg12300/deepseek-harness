# Agent Note: Source startup resolves proxy settings before installation

Status: implemented

English | [中文](2026-09-30-source-startup-proxy-preflight.zh.md)

## Problem

The source launcher isolates application data under `.dsh-local`, while a developer's working proxy can live under `~/.dsh/.env` or macOS system settings. Browser authorization can reach its local callback while the backend cannot exchange the authorization code because the selected Harness home has no proxy settings.

## Decision

[`startup.sh`](../../../../startup.sh) resolves networking before installing dependencies and launching the normal `dsh --profile web` application. Explicit launch variables and the selected home's proxy settings take precedence and fail loudly when invalid or unreachable. Missing routes may use the shared home or macOS static HTTP proxy settings; an unreachable automatically discovered shared route may fall back to the current system proxy. Every invocation reads the current configuration rather than persisting a copied port.

The dependency-free Node helper uses the built-in dotenv parser, validates HTTP proxy URLs, probes each selected listener, and normalizes both environment-variable casings. Only proxy variables cross a private, temporary NUL-delimited file into the shell. Control characters are rejected, values are never evaluated as shell code, diagnostics redact proxy credentials, and the temporary file is removed before further commands run. Localhost bypass entries are always present. Explicit direct mode clears inherited proxy aliases for the child process.

This launcher supplies the environment consumed by the existing [outbound proxy policy](../architecture/2026-08-27-outbound-proxy-policy.md); the application still installs its normal dispatcher. No global application fallback or authentication protocol changes are introduced.

## Alternatives considered

Copying the shared `.env` into every data directory duplicates stale proxy settings and could copy unrelated credentials. Hardcoding a VPN port fails when its configuration changes. Silently replacing an explicit failed route can violate an operator's network choice. Mandatory requests to one model provider would prevent unrelated profiles from starting during that provider's outage.

## Consequences

The preflight catches missing proxy inheritance and closed listeners before installation or login. A reachable listener does not prove that upstream TLS, provider access or account authorization will succeed. PAC and SOCKS-only system settings require an explicit supported HTTP proxy. Already-running backends retain their launch environment and must be restarted to use a changed route. Focused tests cover source precedence, fallback, redaction, control-character rejection, explicit direct mode and the real shell preflight with an owned ephemeral TCP listener.
