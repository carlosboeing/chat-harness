# CLI reference

Chat Harness has three commands:

```text
chat-harness setup [path]
chat-harness validate [path]
chat-harness doctor [path]
```

`[path]` is optional. When omitted, Chat Harness uses the current directory. It does not search parent directories, and the target must already exist as a directory.

All commands support `--json`, `--no-color`, and `--help`.

## setup

```bash
chat-harness setup
chat-harness setup --specialist travel
chat-harness setup /path/to/project --specialist tech
```

Creates or safely reconciles the Workspace scaffold.

| Option | Purpose |
|---|---|
| `--dry-run` | Show the exact reconciliation plan without writing. |
| `--specialist <id>` | Seed `WORKSPACE.md` with domain-specific starting guidance. |
| `--scaffold-domain` | Create the selected specialist's optional starter folders. |
| `--replace-agents` | Explicitly overwrite an unmanaged `AGENTS.md`. |
| `--replace-workspace` | Explicitly overwrite `WORKSPACE.md` with the selected specialist seed. |
| `--json` | Emit structured output and disable interactive prompts. |

Specialists: `general`, `research`, `tech`, `tax`, `finance`, `career`, `shopping`, and `travel`.

### Guided setup

In an interactive terminal, setup:

1. explains specialist choices in plain language;
2. shows optional specialist folders before asking whether to create them;
3. protects existing unmanaged files by default;
4. offers previews before replacement decisions;
5. shows the exact create/replace plan before writing;
6. asks for final confirmation;
7. prints the manual ChatGPT connection steps when the Workspace is ready.

Cancelling the final confirmation applies no changes.

### Non-interactive setup

Without interactive prompts:

- omitted `--specialist` uses `general`;
- optional folders require `--scaffold-domain`;
- unmanaged `AGENTS.md` requires `--replace-agents` to be overwritten;
- existing `WORKSPACE.md` requires `--replace-workspace` to be replaced.

### Safety

Setup does not reorganize existing domain content. Optional domain folders are additive only. Wrong-type collisions and symlinks at managed paths require user action. A recognized Chat Harness-managed `AGENTS.md` may be refreshed; unmanaged files are never silently adopted.

### Optional specialist folders

| Specialist | Folders |
|---|---|
| `general` | none |
| `research` | `Research/` |
| `tech` | `Projects/` |
| `tax` | `Tax/` |
| `finance` | `Finance/` |
| `career` | `Profile/`, `Opportunities/` |
| `shopping` | `Research/`, `Purchases/` |
| `travel` | `Trips/` |

## validate

```bash
chat-harness validate
chat-harness validate /path/to/project
chat-harness validate --json
```

Checks Chat Harness contracts without modifying files, including the required scaffold, managed `AGENTS.md`, Workstream structure and supersession references, and Source Policy validity.

Use `validate` to answer: **is this Workspace structurally valid?**

## doctor

```bash
chat-harness doctor
chat-harness doctor /path/to/project
chat-harness doctor --json
```

Checks local health without modifying files, including Workspace readability/writability, scaffold health, runtime compatibility, capability registry integrity when present, and Git when the GitHub extension development path is present.

Runtime requirements:

- standalone binaries embed their runtime;
- npm installs require Node.js 22.12.0 or newer;
- repository development requires Bun 1.4 or newer.

Doctor cannot inspect hosted-assistant entitlements or Project configuration.

Use `doctor` to answer: **is the local environment healthy?**

## Machine-readable output

Every command supports `--json`. The output is a versioned envelope containing the command, resolved Workspace path, success state, result, and findings.

For setup, `--json` also selects deterministic non-interactive behavior.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Success |
| `1` | A setup, validation, or health error requires attention |
| `2` | Invalid command-line usage |
| `3` | Unexpected internal or execution failure |

## Help

```bash
chat-harness --help
chat-harness setup --help
chat-harness validate --help
chat-harness doctor --help
```

## After setup

The CLI configures the local Workspace; it cannot configure hosted AI-assistant Projects directly.

For ChatGPT Projects, follow the [ChatGPT setup guide](hosts/chatgpt.md) to add the Workspace's Google Drive folder as a Project source and copy the complete `AGENTS.md` into Project Instructions.

See [Getting started](getting-started.md) for the complete beginner flow.
