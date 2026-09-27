# Agent Note: Default Web account and Comics plugins

Status: implemented

English | [中文](2026-09-15-default-web-account-and-comics-plugins.zh.md)

## Problem

A normal Web launch must expose account sign-in and Comics without requiring a user to remember an additional patch file. Installed packages alone do not register navigation entries.

## Decision

The [Web bundle](../../../../packages/bundle/web-app/README.md) mounts authorization, the account service and its settings UI alongside the existing Multica project service, professional agents and Comics UI. Its manifest declares each mounted package as a runtime dependency. Account sign-in remains an explicit user action.

The standalone account bundle serves custom profiles that omit those rows; adding it to the default Web profile duplicates service registration. The [isolated-account decision](2026-09-09-isolated-third-party-accounts.md) still owns provider and native-session isolation. The [Multica revision decision](2026-09-10-multica-project-revisions.md) still owns project persistence and default Comics composition. Both records remain active because their independent decisions continue to apply.

## Alternatives considered

- Require a launch-time patch: a normal restart omits the navigation entry.
- Insert account providers into the shared base: loads a Web account feature into headless and SDK compositions that do not need its UI.
- Force login at startup: confuses feature availability with the user's choice to connect an account.

## Consequences

Default Web startup loads the account runtime and opens its local transcript store even before login. Settings and sidebar entries use their existing localized slots. The settings browser scenario checks both account login controls and the Comics entry with the shipped composition; its Chinese and English expected output records the settings navigation. The Multica browser scenario covers project persistence. Live subscription authorization and inference remain outside this configuration change.
