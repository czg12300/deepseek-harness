---
description: "Optional account connections, private authorization UI, and native Claude conversations."
kind: "package-group"
---

# third-party-auth/ — Account connections

English | [中文](README.zh.md)

## Summary

This group contains the account feature included in the default Web profile. Its Host package manages connection state and native Claude conversations, its UI package adds settings and a separate native window, and its bundle composes both. Existing model adapters and the ordinary Agent loop remain independent.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The default Web profile loads the feature directly. Custom profiles can use the bundle; the other packages own its behavior.

| Package | Role |
|---|---|
| [third-party-auth](third-party-auth/README.md) | Account state, private Remote operations, native runtime |
| [client-ui-third-party-auth](client-ui-third-party-auth/README.md) | Settings page and native conversation window |
| [third-party-auth-bundle](third-party-auth-bundle/README.md) | Optional Profile layer |

<a id="related-documentation"></a>
## Related documentation

- [Account subsystem](../../docs/subsystems/third-party-auth.md) — state and ownership.

<a id="dev-note"></a>
## Dev Note

Real-account validation is tracked in the Host package README.
