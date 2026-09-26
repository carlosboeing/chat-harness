# Alternatives and fit

Chat Harness deliberately occupies a different layer from coding harnesses and self-hosted agent runtimes.

## Plain assistant Projects

Use plain ChatGPT/assistant Projects when work is short-lived or conversation history plus normal files are enough. Chat Harness earns its overhead when work spans sessions and needs explicit recovery, canonical-source discipline, repeatable procedures, deterministic validation, authority boundaries, or bounded extension.

## Coding harnesses

Codex, Claude Code, and similar coding harnesses are a natural fit when the primary object is a software repository and shell/edit/test execution is central.

Chat Harness does not compete with them as coding runtimes. For general research, travel, career, family administration, or other knowledge work, it keeps the familiar general-purpose assistant as the host. A bounded capability may delegate specialized repository work to a coding harness without turning Chat Harness into a multi-agent platform.

## Self-hosted agent runtimes

Systems such as OpenClaw and Hermes own substantially more of the runtime stack.

OpenClaw's current documentation describes an embedded agent runtime with model/tool loop ownership, workspaces, sessions, channels, and built-in tools. Hermes exposes a broader agent environment including external MCP tool integration. Those architectures can be a better fit when requirements center on self-hosting, local/open models, custom channels, continuous automation, deeper runtime control, or greater data sovereignty.

Chat Harness instead assumes an existing general-purpose assistant is already useful and adds the missing project-level engineering around it.

| Priority | Chat Harness approach | Self-hosted runtime approach |
|---|---|---|
| Existing polished assistant UI/mobile/web | reuse host | operate/integrate own runtime surfaces |
| Runtime/model sovereignty | lower | higher |
| Operational burden | lower | higher |
| Native host evolution | inherited | operator integrates changes |
| Arbitrary local authority | intentionally limited | often broader/configurable |
| Project-level durable state discipline | core focus | runtime-specific |
| Model/provider independence | not a goal | often a primary feature |

Neither approach is universally superior. They optimize different boundaries.

Current reference docs:

- https://docs.openclaw.ai/concepts/agent
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
