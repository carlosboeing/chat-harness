# ChatGPT host binding

ChatGPT is the first-class v0.1 host, but `AGENTS.md` remains the portable instruction source. ChatGPT Project Instructions are a **binding**, not a second canon.

## Current documented host primitives

As checked against OpenAI documentation on 2026-09-24:

- Project Instructions apply inside the Project and override global custom instructions.
- Google Drive files and folders can be added as Project sources.
- Connected apps can be used from Project chats.
- A Google Drive connection in a Project can search/access relevant files, but content is not necessarily pre-synced; personal/individual Drive access is live/on-demand.
- Availability and actions vary by plan, workspace configuration, region, connected-account permissions, and surface.

See [Compatibility](../compatibility.md) for evidence status and authoritative vendor links.

## Reference binding

1. Create or choose the ChatGPT Project for the Workspace.
2. Make the Workspace retrievable from that Project. For a Google Drive-backed Workspace, add the relevant Drive folder/file as a Project source or connect Google Drive with permission to access it.
3. In Project settings, add the minimal binding below as Project Instructions.
4. Keep the actual operating protocol in the Workspace's `AGENTS.md`; update that file rather than maintaining two independent instruction sets.
5. Run the host smoke before calling the path verified.

Suggested binding:

```text
This Project uses Chat Harness. At the start of substantial work, retrieve and follow the canonical AGENTS.md from the Project's configured Workspace before acting. Use .chat-harness/README.md as the Workspace Map and resume the relevant .chat-harness/workstreams/ file when durable continuation exists.

AGENTS.md is the project-level instruction source of truth. These Project Instructions are only the ChatGPT host binding. If AGENTS.md cannot be retrieved or applied, say so rather than silently substituting a guessed instruction set.
```

## Context retrieval

After applying the binding, retrieve `AGENTS.md`, the Workspace Map, and the relevant active Workstream, then retrieve the minimum known authoritative context and progressively broaden to other authorized sources when material.

Google Drive project sources are not assumed to be a complete synchronized corpus. The assistant may need to search/access files on demand.

## Source Policy caveat

ChatGPT-native file/app retrieval is a host-native path. Portable instructions require the assistant to respect Source Policy, but Chat Harness cannot claim hard pre-read enforcement where it cannot intercept the host's retrieval operation.

For `restricted` non-obvious cross-context use, the binding expects explicit approval before use. For `confidential`, it expects a proportional notice. These are behavioural requirements to exercise in host evals.

## Authority

Normal research/retrieval may proceed when safe and authorized. Before meaningful external mutations, apply Action Transparency. Consequential actions require explicit user approval at the action boundary.

## Verification status

This binding is **documented but unverified** until release qualification records that `AGENTS.md` materially affected behaviour, Workspace Map/Workstream recovery worked, a new-session continuation resumed from `Next action`, cross-context retrieval respected policy/transparency, and durable closeout state was persisted.

Do not promote this entry to `verified` based only on vendor documentation.
