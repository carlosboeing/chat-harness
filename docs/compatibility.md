# Compatibility

Chat Harness tracks host compatibility by capability and evidence rather than assuming similar products behave identically.

Status meanings:
- **documented** — vendor documentation supports the required primitive;
- **verified** — the exact Chat Harness path has been exercised;
- **unverified** — architectural mapping exists without an end-to-end support claim.

## ChatGPT Projects

ChatGPT is the reference hosted binding for v0.2.

The binding contract is intentionally simple: copy the **entire current `AGENTS.md`** into ChatGPT Project Instructions, and make the Workspace retrievable by the Project. Do not maintain a second hand-written “minimal binding” or merge specialist text into Project Instructions; Workspace-specific behavior remains in `.chat-harness/WORKSPACE.md`.

The host must be able to retrieve WORKSPACE, Workspace Map, relevant Workstreams/Procedures, and authoritative sources for the runtime contract to work. Availability of connected sources/actions still depends on the user's plan, workspace configuration, permissions, region, and host surface.

Source Policy is mechanically enforceable only on Chat Harness-controlled access paths. On host-native retrieval paths without an enforcement hook it is an instruction-level behavior, not IAM.

## Other assistants

The architecture is portable, but support remains evidence-based. A host that can consume `AGENTS.md` directly may not need the ChatGPT copy step. Similar primitives alone do not establish verified compatibility.

## Reverification

Reverify after material host behavior changes, before making a stronger support claim, or when a host smoke reports regression. Chat Harness semver versions its own software/contracts, not vendor releases.
