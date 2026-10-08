---
type: workstream
title: Chat Harness implementation planning
status: active
created: 2026-10-01
updated: 2026-10-08
---

# Chat Harness implementation planning

## Objective
Turn the explicitly approved Chat Harness architecture/design into an executable implementation plan against the live `carlosboeing/chat-harness` repository, using current `main` (v0.3.7 at migration) as the implementation starting point without re-opening settled architecture.

## Current direction
Architecture review and approval are complete. The canonical Design is `.chat-harness/workbench/2-design/2026-09-30-chat-harness-architecture-design.md`.

That Design explicitly supersedes the prior architecture candidate and the fully absorbed focused architecture decisions. Their files may remain physically present as historical evidence; they are no longer current authority for overlapping scope.

The earlier architecture-phase Workstream remains in the historical Tech & AI Drive Workspace and is not copied into this repository. Do not resume broad architecture exploration from that historical record.

## Durable state
- Design approved on 2026-10-01 and explicitly re-approved on 2026-10-08 after narrow cross-Workstream mutation and reconciliation/recovery safety amendments.
- Final readiness blockers resolved in the approved Design: cross-Workstream mutation authority, same-manifest-digest commit proof, and read-only recovery boundaries. Consolidated Design supersession and single-owner managed files remain explicit.
- Pre-1.0 compatibility was deliberately simplified: only the new Workbench/current CLI contract is supported; the present development Workspace will use a one-time human/assistant-guided reorganization rather than permanent migration machinery.
- Brownfield safety remains part of the approved architecture.
- Cross-Workstream mutation safety is an implementation requirement: read/discovery may span authorized Workstreams, but a session may mutate only the current Workstream and its owned artifacts by default. Mutating a related Workstream requires naming the affected Workstream/files, explaining why the mutation is needed, and obtaining explicit user authorization first. Unrelated Workstreams are out of bounds for incidental edits, moves, cleanup, or deletion. Ambiguous ownership must stop for clarification. Temp/staging files inherit the ownership of the Workstream that created them; placement in `temp/` does not make them ownerless or disposable.
- Implementation planning should preserve the host/runtime boundary and avoid adding platform abstractions not required by the approved Design.

## Relevant artifacts / sources
- Canonical approved Design: `.chat-harness/workbench/2-design/2026-09-30-chat-harness-architecture-design.md`
- Final architecture review: Tech & AI Drive Workspace (historical evidence; not imported)
- Historical architecture Workstream: Tech & AI Drive Workspace (not imported; non-canonical for implementation)
- Implementation baseline: `carlosboeing/chat-harness` current `main` (v0.3.7 at this migration); v0.3.6 is the historical architectural starting point.

## Open questions / blockers
None at the architecture-approval boundary. Implementation sequencing, commit/PR slicing, repository module boundaries and the one-time local Workspace taxonomy reorganization belong in the implementation plan.

## Next action
Create the consolidated implementation Plan in `.chat-harness/workbench/3-plans/`, mapping the approved Design to concrete repository changes, sequencing, tests, rollout/migration steps and acceptance criteria. Include the cross-Workstream mutation boundary as an explicit Core behavior/validation requirement. Do not redesign approved architecture unless implementation evidence exposes a genuine contradiction or infeasibility.
