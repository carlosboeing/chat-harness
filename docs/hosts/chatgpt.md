# ChatGPT host binding

`AGENTS.md` is the portable generic instruction source. ChatGPT Project Instructions are a **binding**, not a second canon.

ChatGPT cannot be configured by the local Chat Harness CLI, so this binding includes one explicit manual step: copy the complete current `AGENTS.md` into Project Instructions.

## Current documented host primitives

As checked against OpenAI documentation on 2026-09-26:

- Project Instructions apply inside the Project and override global custom instructions.
- Supported Google Drive files and folders can be added as Project sources.
- Connected apps can be used from Project chats.
- A personal/individual Google Drive connection provides live, on-demand access rather than a personal synced index.
- Availability and actions vary by plan, workspace configuration, region, connected-account permissions, and surface.

See [Compatibility](../compatibility.md) for evidence status and authoritative vendor links.

## Setup

1. Run `chat-harness setup` for the Workspace.
2. Make the Workspace and its relevant sources retrievable from the ChatGPT Project.
3. Open the generated root `AGENTS.md`.
4. Copy the **entire current file** into ChatGPT Project Instructions.
5. Keep Workspace/domain-specific behavior in `.chat-harness/WORKSPACE.md`.
6. Do not maintain a second hand-written minimal binding or merge specialist text into Project Instructions.

A future `chat-harness setup` may refresh a recognizably Chat Harness-managed `AGENTS.md`. When that happens, recopy the complete current file into Project Instructions.

## Runtime retrieval

For substantial work, the Project Instructions direct the host to:

1. retrieve `WORKSPACE.md` and the Workspace Map;
2. inspect relevant active or parked Workstreams before reconstructing state from chat history or model memory;
3. resume matching state from its Next action or create a qualifying Workstream;
4. load only relevant Procedures and authoritative sources;
5. checkpoint material changes and reconcile durable state before closeout.

Google Drive Project sources are not assumed to be a complete synchronized corpus. Relevant files may need to be searched or accessed on demand.

## Source Policy caveat

ChatGPT-native file/app retrieval is a host-native path. Chat Harness instructions require Source Policy-aware behavior, but Chat Harness cannot claim hard pre-read enforcement where it does not intercept the retrieval operation.

For non-obvious cross-context use, the applicable privacy classification and approval/transparency rules still govern assistant behavior.

## Authority

Normal research and retrieval may proceed when safe and authorized. Before meaningful external mutations, apply Action Transparency. Consequential actions require explicit user approval at the action boundary unless already explicitly authorized.

## Verification status

The binding remains **documented but unverified** until a real host scenario demonstrates that the complete `AGENTS.md` binding materially affects behavior, Workspace Map/Workstream recovery works, a fresh-session continuation resumes from Next action, Source Policy/transparency behavior matches the documented contract, and durable closeout state is persisted.

Do not promote the binding to `verified` based only on vendor documentation.
