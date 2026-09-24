# Workspace Map

This file is user-owned after setup. It describes where authoritative information lives and how the assistant should orient and route retrieval. It is not a machine manifest and it does not make this Workspace an information silo.

## Harness state

- Portable project instructions: `AGENTS.md`
- Current resumable work: `.chat-harness/workstreams/`
- Optional Source Policy: `.chat-harness/source-policy.yaml`

## Domain sources

Describe the existing files, folders, repositories, connected apps, other Workspaces, and external authorities that own domain truth.

Example:

- customer agreements → `Contracts/`
- implementation and engineering docs → GitHub repository
- current vendor behaviour → authoritative live vendor documentation
- related household finances → Tax & Finance Workspace; retrieve only what the task needs and preserve ownership there

Do not reorganize the Workspace merely to fit Chat Harness. When information already has an authoritative home elsewhere, retrieve or reference it rather than creating competing canon.

## Operating notes

Add only stable routing, currentness, authority, or persistence rules that belong to this Workspace. Changing Workstream state belongs in `.chat-harness/workstreams/`, not here.
