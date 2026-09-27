# Agent Note: Portable actor libraries

Status: implemented

English | [中文](2026-09-23-portable-actor-libraries.zh.md)

## Problem

Actors and visual references need a durable home outside any one comic project. A library must travel with its own media, and importing another library must not erase local versions of an actor.

## Decision

Each actor library is an independent directory under the device Multica database's sibling `actor/` directory. It contains a versioned manifest, a SQLite database, and content-addressed reference images under `assets/`. Library and actor UUIDs survive copying. Project revisions and Session storage do not own actor records.

The global Multica workspace switches between “All projects” and “Actor library” tabs at the same browser location. The actor tab uses the same locale and semantic black-and-white theme tokens as the project catalog. It supports multiple library folders, actor search and filters, manual actor editing, two reference images, and a bounded ZIP export or import.

The import operation validates archive entries, uncompressed size, SQLite identity and image hashes before writing a destination library. Merging compares actor identities and image/content fingerprints. Identical content is skipped; a divergent version with the same ID is copied under a new actor ID while the destination version stays intact. Provenance rows make repeated imports idempotent. Name equality alone does not merge actors.

## Alternatives considered

**Store actors in the project database.** That prevents one actor library from being copied or reused independently of a project.

**Merge by display name or overwrite the destination UUID.** Names are not stable identities, and overwriting loses the creator's local version.

## Consequences

The current ZIP Remote transfer has explicit compressed, expanded, item-count and per-image limits. An archive over the limit fails before installation; this path does not claim support for very large media libraries. Project-side use of a library actor requires a later explicit binding and version policy.
