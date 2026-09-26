# Chat Harness documentation

This directory contains the current architecture, operating model, host bindings, security model, and maintainer references for Chat Harness.

If you are new to the project, start with the root [README](../README.md) for the product story and quick start. Use this page as the map for everything deeper.

## Start here

1. **[README](../README.md)** — what Chat Harness is, why it exists, installation, quick start, and the mental model.
2. **[Architecture](architecture.md)** — how the host, instructions, Workspace state, domain sources, and bounded capabilities fit together.
3. **[Concepts](concepts.md)** — the vocabulary: Workspace, Workstream, Workbench, Procedure, Source Policy, and related terms.
4. **[Specialists](specialists.md)** — choose and customize a setup-time specialist seed.
5. **[ChatGPT host binding](hosts/chatgpt.md)** — make a Chat Harness Workspace effective inside a ChatGPT Project.

A typical first setup is:

```bash
chat-harness setup /path/to/project --specialist tech
chat-harness validate /path/to/project
chat-harness doctor /path/to/project
```

For ChatGPT, then copy the **entire generated `AGENTS.md`** into Project Instructions. The Workspace-specific specialist guidance stays in `.chat-harness/WORKSPACE.md`.

## Understand the model

| Document | Use it when you want to understand… |
|---|---|
| [Architecture](architecture.md) | system boundaries, instruction ownership, runtime recovery, brownfield behavior, and capability boundaries |
| [Concepts](concepts.md) | the canonical meaning of Chat Harness terms |
| [Specialists](specialists.md) | what each built-in specialist optimizes for and what setup does with it |
| [Security](security.md) | Source Policy, authority, approvals, prompt-injection boundaries, and extension security |
| [Compatibility](compatibility.md) | what support is documented, verified, or not yet verified |
| [Alternatives and fit](alternatives.md) | when plain assistant Projects, coding harnesses, or self-hosted runtimes may fit better |
| [Capability lifecycle](capability-lifecycle.md) | how a bounded external capability is designed, promoted, and maintained |

## Host bindings

Host bindings explain the small amount of host-specific setup needed to make the portable Workspace model effective.

- [ChatGPT Projects](hosts/chatgpt.md) — current reference hosted binding.

Chat Harness keeps host-specific glue narrow. The host still owns its model, native conversation/tool loop, UI, and built-in capabilities.

## Maintainers and contributors

- [Contributing](../CONTRIBUTING.md) — development gates, design rules, PR expectations, and releases.
- [Security policy](../SECURITY.md) — how to report a vulnerability.
- [Design history](design-history/capability-bridge-origin.md) — historical rationale for the original capability bridge.
- [Historical capability-bridge design](design.md) — pointer from the superseded standalone design to the current architecture.
- [Release records](releases/) — version-specific release notes and qualification history.

Historical documents may contain version-specific terminology by design. They are records of what shipped or how the architecture evolved; they are not the current user-facing contract.

## Documentation conventions

Current product documentation should describe **the current architecture directly**, rather than narrating old-versus-new versions. Version-specific language belongs in release notes and historical design/qualification records.

Keep concepts in one canonical place and link to them rather than creating competing definitions. The root README should stay approachable and explanatory; detailed contracts belong in the focused documents above.
