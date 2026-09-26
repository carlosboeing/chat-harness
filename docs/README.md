# Chat Harness documentation

The root [README](../README.md) explains what Chat Harness is, why it exists, and how to get started. This page is the map for the deeper documentation.

## Start here

1. [Architecture](architecture.md) — system boundaries, Workspace structure, ownership, recovery, and capability model.
2. [Concepts](concepts.md) — canonical terminology.
3. [Specialists](specialists.md) — built-in Workspace specialist seeds and how to use them.
4. [ChatGPT host binding](hosts/chatgpt.md) — connect a Workspace to a ChatGPT Project.

For most users, those four documents plus the root README cover the operating model.

## Reference

- [Security and trust boundaries](security.md) — Source Policy, authority, approvals, prompt injection, and extension security.
- [Compatibility](compatibility.md) — evidence-based host support.
- [Alternatives and fit](alternatives.md) — when plain assistant Projects, coding harnesses, or self-hosted runtimes may fit better.
- [Capability lifecycle](capability-lifecycle.md) — how bounded external capabilities are promoted and maintained.

## See it in practice

The repository includes four synthetic [example Workspaces](../examples/) covering family administration, a job opportunity, scientific research, and travel planning. They show the scaffold, Workspace-specific instructions, source routing, and Workstreams in realistic layouts.

[Behavioural evals](../evals/README.md) encode required and forbidden behaviors separately from the examples.

## Maintainers and project history

- [Contributing](../CONTRIBUTING.md) — development gates, design rules, PR expectations, and releases.
- [Security policy](../SECURITY.md) — vulnerability reporting.
- [Design history](design-history/capability-bridge-origin.md) — origin of the bounded capability bridge.
- [Release records](releases/) — version-specific release notes and qualification history.

Historical documents intentionally retain version-specific terminology. Current product documentation describes the current architecture directly.
