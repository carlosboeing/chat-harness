# Chat Harness

**Harness engineering for AI assistants.**

Chat Harness adds durable context, recovery, source ownership, validation, guardrails, and bounded capability extension around general-purpose AI assistants. It is **not another agent runtime**: the host still owns models, conversations, native tools, connectors, and execution.

## Workspace model

v0.2 uses a small generic harness scaffold while leaving the user's/domain's corpus domain-defined:

```text
<Project>/
├── AGENTS.md
├── _inbox/
└── .chat-harness/
    ├── WORKSPACE.md
    ├── README.md
    ├── source-policy.yaml
    ├── workstreams/
    ├── workbench/
    │   ├── 0-ideas/
    │   ├── 1-research/
    │   ├── 2-analysis/
    │   ├── 3-plans/
    │   └── 4-reviews/
    ├── procedures/
    └── temp/
```

`AGENTS.md` is wholly Chat Harness-owned generic behavior. `.chat-harness/WORKSPACE.md` is the single Workspace-specific instruction extension and becomes user-owned after setup. `.chat-harness/README.md` is the user-owned Workspace Map, not another instruction file.

The retrieval chain for substantial work is:

```text
AGENTS / Project Instructions
        ↓
WORKSPACE.md
        ↓
Workspace Map
        ↓
matching Workstream / Procedure / authoritative sources
```

A Workspace is an ownership/resume boundary, not an information silo. Relevant authorized context may live in repositories, connected apps, other Workspaces, assistant context systems, or current public sources; canon stays with its owning source.

## Installation

Standalone release binaries are the primary distribution. The secondary npm channel is:

```bash
npm install -g chat-harness
```

Development requires Bun 1.4+.

## Quick start

```bash
chat-harness setup /path/to/project --specialist tech
chat-harness validate /path/to/project
chat-harness doctor /path/to/project
```

Specialist seeds:

```text
general  research  tech  tax  finance  career  shopping  travel
```

If `--specialist` is omitted, interactive setup asks and defaults to `general`; non-interactive setup deterministically uses `general`.

Optional specialist domain folders are not core architecture. Interactive setup defaults to **no**; non-interactive setup requires `--scaffold-domain`.

Setup is brownfield-safe:
- missing core paths are created;
- recognized Chat Harness-managed `AGENTS.md` may be replaced wholesale with the current canonical version;
- unknown/unmanaged `AGENTS.md` is a collision and is never silently adopted;
- existing `WORKSPACE.md`, Workspace Map, Source Policy, and domain content are preserved unless an explicit replacement choice applies;
- no v0.1 migration/upgrade layer exists.

After setup, ChatGPT users must copy the **entire current `AGENTS.md`** into Project Instructions. The CLI cannot update hosted Project Instructions directly.

## Workstreams and Workbench

Create a Workstream when:

> independent objective + independent next action + likely future continuation

A Workstream is compact current resume state: objective, current direction, material durable rationale/state, blockers/open questions, relevant artifacts/sources, and Next action. It is continuously maintained/compacted, not a transcript.

Workbench contains substantial durable working artifacts. Its taxonomy is organizational, not a state machine:
- `0-ideas`
- `1-research`
- `2-analysis`
- `3-plans`
- `4-reviews`

Workstreams and Workbench artifacts are parallel outputs from work.

## Source Policy

`.chat-harness/source-policy.yaml` is part of the normal scaffold and remains narrowly machine-readable privacy/source-handling policy. It is not a generic configuration system. Chat Harness can mechanically enforce policy only on access paths it controls; host-native retrieval may be instruction-governed where no enforcement hook exists.

## CLI

| Command | Purpose |
|---|---|
| `setup` | Reconcile the v0.2 scaffold and optional setup-time specialist/domain seed. |
| `validate` | Validate deterministic Workspace, Workstream, Source Policy, and capability invariants. |
| `doctor` | Diagnose local prerequisites without mutating the Workspace. |

There is no `migrate`, `upgrade`, workflow engine, template inheritance system, specialist runtime, or Workspace version database.

## Bounded capability extension

Native assistant capabilities come first. When a deterministic material gap remains, Chat Harness can expose a specific typed external capability instead of generic arbitrary execution. Existing capability/security boundaries remain independent of the Workspace v0.2 redesign.

See [Architecture](docs/architecture.md), [Concepts](docs/concepts.md), [Security](docs/security.md), [Compatibility](docs/compatibility.md), and [ChatGPT host binding](docs/hosts/chatgpt.md).

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run validate
bun run validate:docs
bun run validate:evals
bun run test
```
