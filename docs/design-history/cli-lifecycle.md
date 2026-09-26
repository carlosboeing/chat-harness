# CLI lifecycle design

Status: implemented on `feat/cli-lifecycle` for review.

This record captures the design decisions behind first-class `chat-harness update` and `chat-harness uninstall`.

## Goals

- hide installation-channel-specific update/uninstall commands behind one CLI UX;
- keep standalone checksum verification at least as strong as the installers;
- refuse ambiguous/custom ownership instead of guessing;
- make Windows executable replacement/removal safe despite the running `.exe` lock;
- keep software lifecycle authority completely separate from Workspace mutation;
- add the smallest maintainable mechanism rather than a package-manager framework.

## Decisions

### 1. Does update ask for confirmation?

No. Running `chat-harness update` is explicit authority to update the CLI.

A second confirmation adds friction without creating a meaningful safety boundary: the operation is narrowly scoped to the already-detected Chat Harness installation and is reversible/reinstallable software state. This also keeps interactive and automation behavior consistent.

`chat-harness update --check` is the read-only preview path.

### 2. Does `update --check` exist?

Yes.

It detects the installation, resolves the authoritative current version for managed release/npm channels, reports whether an update is available, and performs no mutation.

### 3. Is CLI version pinning supported?

No.

The installers already support `CHAT_HARNESS_VERSION` for explicit release installation. Adding `update --version` now would expand downgrade/prerelease/version-selection semantics without a demonstrated lifecycle need.

### 4. How is installation provenance detected?

Detection is conservative:

1. compiled standalone executables first inspect a narrow sidecar adjacent to the running executable;
2. local compiled development builds remain recognizable from their injected `<package-version>-<sha>[-dirty]` version;
3. existing stable standalone installs without metadata are accepted only at the documented default `~/.local/bin/chat-harness[.exe]` path;
4. Node/npm execution walks from the actual entrypoint to the `chat-harness` package root and verifies it matches `npm root -g`;
5. source/runtime executions are development, not installed software;
6. anything else is unknown and mutation is refused.

For standalone/development binaries, lifecycle mutation is also refused if a different `chat-harness` wins on `PATH`.

### 5. Do future standalone installs write metadata?

Yes.

The official shell/PowerShell installers and `install:local` write:

```json
{"schema":1,"channel":"standalone"}
```

or `development` beside the executable as `.chat-harness-install.json`.

The sidecar intentionally contains no arbitrary path, Workspace identity, release URL, credentials, or user data. Its location binds it to the executable it describes.

### 6. How does Windows replacement/self-removal work?

The running executable never attempts to overwrite/delete itself.

For update, Chat Harness:

1. downloads and SHA-256-verifies the release;
2. writes the candidate beside the installed executable;
3. executes the candidate's `--version` before scheduling anything;
4. copies the current Chat Harness executable to a uniquely named temporary helper;
5. writes a narrowly scoped temporary lifecycle job;
6. starts the helper detached;
7. exits;
8. the helper waits for the parent PID to stop, then moves the old executable to a unique backup, moves the staged candidate into place, verifies the resulting version, and removes the backup; failed verification rolls back.

Uninstall uses the same copied helper after parent exit to delete only `chat-harness.exe` and its adjacent install metadata.

The helper validates that target/staged/backup/metadata/job/helper paths stay inside the intended Chat Harness boundaries. It is not a generic deferred file-operation facility.

### 7. How are npm installs updated/uninstalled?

Chat Harness invokes npm directly:

```text
npm install -g chat-harness@latest
npm uninstall -g chat-harness
```

npm remains the package owner and handles prefixes, permissions, shims, and platform-specific installation behavior. Human-mode npm output is inherited; JSON mode captures stdout/stderr into the lifecycle result on failure. Chat Harness verifies the resulting package version/removal.

Reimplementing npm's mutation semantics would be both larger and less reliable.

### 8. What happens for local development builds?

`update` refuses to replace them with a release and points back to the source checkout + `bun run install:local`.

An installed development binary may be uninstalled. A source/runtime invocation may not: this explicitly prevents `uninstall` from deleting repository source files.

### 9. What user-level state does uninstall remove?

Only the installed Chat Harness executable/package and the adjacent Chat-Harness-owned install sidecar.

There is no `--remove-config` because there is no additional user-level configuration to purge.

Workspace/project data is outside uninstall authority. There is deliberately no `--purge-workspaces` option.

### 10. Is Workspace migration implemented now?

No.

The v0.3.0 persistence change demonstrates that a future `chat-harness migrate` can be valuable, but migration needs its own versioned Workspace-schema/ownership design. In particular, v0.2 → v0.3 Workbench ownership cannot always be inferred safely.

Until that contract exists:

- `update` changes software only;
- `setup` reconciles only managed scaffold state under its existing rules;
- `validate` reports Workspace-contract problems;
- release notes describe manual migration steps for breaking Workspace changes.

Migration should be a separately reviewed feature, not hidden inside update.

## Failure model

Expected safe failures include:

- GitHub/npm/network unavailable: no standalone replacement occurs; npm error is surfaced;
- missing release asset/unsupported platform: update stops before mutation;
- checksum mismatch: candidate is rejected before execution/replacement;
- install directory not writable: staging/metadata write fails before replacement;
- PATH ambiguity: standalone/development mutation is refused;
- npm unavailable or unverifiable: npm ownership cannot be safely acted on;
- interrupted POSIX download/staging: installed executable is unchanged;
- failed POSIX post-replacement version check: previous executable is restored;
- Windows running executable lock: mutation occurs only after parent exit through the helper;
- unknown/custom provenance: no automatic mutation;
- source checkout uninstall: refused;
- uninstall: no Workspace path is ever accepted or traversed.

## Testing strategy

Filesystem, process, release lookup/download, platform, executable resolution, npm invocation, replacement, and Windows scheduling all have deterministic seams.

Tests use temporary files or fakes only. They do not contact GitHub/npm for mutation and never touch the developer's real installation.

CI adds a Windows lifecycle job so helper rename/rollback behavior and the compiled Windows command surface are exercised on Windows in addition to the normal Linux qualification suite.
