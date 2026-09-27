# Agent Note: Account login settlement and activation recovery

Status: implemented

English | [中文](2026-09-15-account-login-settlement.zh.md)

## Problem

The OAuth callback page acknowledges the authorization code before the host exchanges it and saves credentials. A cancelled-looking timeout or a generic failure does not tell a user why the account remains disconnected. A saved grant can also outlive a failed activation.

## Decision

Account settlement distinguishes authorization or storage failure, activation failure, and the login deadline with fixed public reason codes. Provider exception text stays private. The default interactive deadline is 15 minutes, matching the installed ChatGPT device-code window, and remains configurable. User cancellation is a separate outcome.

ChatGPT retries use a stored grant to finish activation. The settings page offers that action for an authenticated but disabled account and keeps terminal feedback above the cards. A committed connection updates its card immediately and invalidates older list reads, so another provider status probe cannot postpone the visible connection. The [isolated-account decision](../architecture/2026-09-09-isolated-third-party-accounts.md) retains ownership of provider isolation, native conversations, and credential storage; it is not superseded.

## Alternatives considered

- Disable the machine proxy: a successful probe through that proxy does not establish it as the failed login's cause, and direct access may be rejected.
- Expose upstream exception text: token responses and native errors may contain credentials.
- Repeat browser login after every activation failure: discards a usable committed grant and repeats user interaction.

## Consequences

The larger login window keeps an abandoned attempt alive longer, with explicit cancellation and a bounded deadline. Reason codes identify the failed stage without diagnosing every remote rejection. Keyless Web tests exercise the real authorization, credential, settings and browser paths with only external OAuth responses replaced. Live account authorization still requires the user's browser interaction; these tests do not prove a particular VPN route or account will be accepted.
