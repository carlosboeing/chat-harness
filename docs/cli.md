# CLI reference

Chat Harness has five user-facing commands:

```text
chat-harness setup [path]
chat-harness validate [path]
chat-harness doctor [path]
chat-harness update
chat-harness uninstall
```

`setup`, `validate`, and `doctor` are **Workspace commands**. Their optional `[path]` defaults to the current directory; they do not search parent directories.

`update` and `uninstall` are **software lifecycle commands**. They operate only on the detected Chat Harness installation and never take a Workspace path.

All user-facing commands support `--json`, `--no-color`, and `--help`.

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

1. explains what Chat Harness will add and what it will preserve;
2. asks what the Workspace is mainly for in plain language;
3. explains optional organizational folders and shows whether each is new or already present;
4. protects existing unmanaged files by default and offers previews before replacement decisions;
5. shows the complete resulting Chat Harness tree with human-readable status labels;
6. asks whether to set up the Workspace before writing;
7. replaces low-level operation receipts with a friendly completion tree;
8. prints the manual Google Drive + ChatGPT connection steps when the Workspace is ready.

Cancelling the final confirmation applies no changes.

### Non-interactive setup

Without interactive prompts:

- omitted `--specialist` uses `general`;
- optional folders require `--scaffold-domain`;
- unmanaged `AGENTS.md` requires `--replace-agents` to be overwritten;
- existing `WORKSPACE.md` requires `--replace-workspace` to be replaced.

### Safety

Setup does not reorganize existing domain content. Optional domain folders are additive only. Wrong-type collisions and symlinks at managed paths require user action. A recognized Chat Harness-managed `AGENTS.md` may be refreshed; unmanaged files are never silently adopted.

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

## update

```bash
chat-harness update --check
chat-harness update
chat-harness update --json
```

`update` detects the running installation before doing anything:

- **standalone release binary** — uses the latest stable GitHub Release for the current OS/architecture, downloads both the binary and its SHA-256 sidecar, verifies the checksum, verifies the candidate binary version, and replaces the installed executable;
- **global npm package** — queries the npm `latest` tag, then delegates mutation to `npm install -g chat-harness@latest` and verifies the installed package version;
- **local development build** — reports the development installation and refuses to replace it with a published release;
- **unknown/custom installation** — refuses mutation rather than guessing ownership.

`--check` performs detection/version lookup only and never updates the installation.

Invoking `chat-harness update` is the update authorization; there is no second confirmation prompt. This keeps scripted and interactive behavior identical.

### Standalone safety

Standalone updates preserve the installer security boundary:

1. select the exact released platform/architecture asset;
2. download the matching `.sha256` sidecar;
3. verify SHA-256 before any installed binary is replaced;
4. stage the candidate in the install directory;
5. verify the candidate reports the expected release version;
6. replace atomically on macOS/Linux where the filesystem permits;
7. verify the installed result and roll back if post-replacement verification fails.

On Windows, the running `.exe` schedules a narrowly scoped temporary copy of Chat Harness to perform replacement after the parent process exits. The helper can act only on `chat-harness.exe` and Chat-Harness-owned lifecycle files within the detected installation boundary.

### Provenance

New standalone installs write a small `.chat-harness-install.json` sidecar beside the executable. It records only the installation channel; it does not contain a Workspace path or user data.

Existing pre-metadata standalone installs remain supported at the documented default location:

```text
~/.local/bin/chat-harness
~/.local/bin/chat-harness.exe
```

A stable compiled binary in another custom location without provenance metadata is treated as unknown and is not self-modified. Re-running the official installer establishes provenance for future lifecycle operations.

If the running standalone/development executable differs from the `chat-harness` executable that currently wins on `PATH`, lifecycle mutation is refused until the ambiguity is fixed.

### Workspace migration is separate

`update` changes **software only**. It never runs `setup`, rewrites Workspace state, or performs schema migration.

The authority boundaries are intentionally separate:

```text
update      = update Chat Harness software
migrate     = transform an existing Workspace contract/schema (future, when justified)
setup       = create/reconcile managed Workspace scaffold
uninstall   = remove installed Chat Harness software
```

For a release with a Workspace-contract change, follow its release notes and use `setup` / `validate` as instructed. A future `migrate` command should be designed separately rather than hidden inside update.

## uninstall

```bash
chat-harness uninstall
chat-harness uninstall --yes
chat-harness uninstall --yes --json
```

Interactive uninstall shows the detected version, channel, and executable path, then asks for confirmation. Non-interactive and `--json` use require `--yes`.

For global npm installs, Chat Harness delegates to:

```bash
npm uninstall -g chat-harness
```

For standalone or `install:local` binaries, it removes only the detected executable and its adjacent Chat-Harness-owned installation metadata.

On Windows, self-removal is scheduled through the same post-exit helper strategy used for replacement.

### Data-safety boundary

Uninstall **never deletes or modifies Workspace/project data**. In particular, it does not remove:

```text
AGENTS.md
.chat-harness/
_inbox/
Workstreams
Workbench artifacts
domain/project files
Google Drive Workspace content
```

There is deliberately no `--purge-workspaces` option. Workspace deletion is a separate user-data operation and is not coupled to package uninstall.

There is currently no `--remove-config` option because Chat Harness does not maintain additional user-level configuration that needs purging.

Running uninstall directly from a source checkout is refused; Chat Harness will not delete its own source files.

## Machine-readable output

Every command supports `--json`.

Workspace commands keep the versioned envelope's resolved `workspace` field. Lifecycle commands omit `workspace` and instead report lifecycle fields in `result`, including `current`, `channel`, `path`, and `latest` when a release/version lookup applies.

For setup, `--json` also selects deterministic non-interactive behavior. For uninstall, `--json` never prompts; pass `--yes` to authorize removal.

## Exit codes

| Code | Meaning |
|---:|---|
| `0` | Success, including already-current and read-only update checks. |
| `1` | A command finding requires attention or a safe refusal occurred. |
| `2` | Invalid command-line usage. |
| `3` | Unexpected internal or execution failure. |

## Help

```bash
chat-harness --help
chat-harness setup --help
chat-harness validate --help
chat-harness doctor --help
chat-harness update --help
chat-harness uninstall --help
```

## After setup

The CLI configures the local Workspace; it cannot configure hosted AI-assistant Projects directly.

For ChatGPT Projects, follow the [ChatGPT setup guide](hosts/chatgpt.md) to add the Workspace's Google Drive folder as a Project source and copy the complete `AGENTS.md` into Project Instructions.

See [Getting started](getting-started.md) for the complete beginner flow.
