# ChatGPT host binding

ChatGPT Projects cannot be updated by the local Chat Harness CLI. The binding is therefore an explicit manual action.

## Setup

1. Run `chat-harness setup` for the Workspace.
2. Make the Workspace and its relevant sources retrievable from the ChatGPT Project.
3. Open the generated root `AGENTS.md`.
4. Copy the **entire current file** into ChatGPT Project Instructions.
5. Do not extract a managed subsection, manually merge it with specialist instructions, or maintain a separate minimal binding.
6. Keep Workspace/domain-specific behavior in `.chat-harness/WORKSPACE.md`.

A future `chat-harness setup` may replace a recognizably Chat Harness-managed `AGENTS.md` wholesale. When that happens, recopy the complete current file into Project Instructions.

## Runtime retrieval

For substantial work, the Project Instructions direct the host to:
1. retrieve WORKSPACE + Workspace Map;
2. inspect relevant active/parked Workstreams before reconstructing from chat/memory;
3. resume matching state from Next action or create a qualifying Workstream;
4. load only relevant Procedures and canonical sources;
5. checkpoint material changes and reconcile durable state before closeout.

## Source Policy caveat

ChatGPT-native file/app retrieval is host-native. Chat Harness instructions require Source Policy-aware behavior, but hard pre-read enforcement cannot be claimed where Chat Harness does not intercept the access path.

## Verification

Host compatibility should be demonstrated with real continuation/recovery scenarios rather than inferred from documentation alone.
