# Gate 0 — macOS single-file journal experiment

**Scope:** CI-only experiment in disposable temporary Workspaces. This is not an active CLI feature or a production journal/recovery implementation. No existing Workspace is touched.

## Why this experiment

A verified individual `renameatx_np(RENAME_EXCL)` move isn't a complete update. A real reconciliation must remember exactly which bytes were intended, retain backups through interruption, and decide whether to roll back or finish forward using the manifest as the last commit marker.

## Bounded scenario

`tests/native/macos-journal-spike.test.ts` creates a temporary Workspace, one mock Shopping Procedure and a valid schema-1 manifest. It stages a new version of that Procedure and a new manifest, creates an exclusive `.chat-harness/temp/reconcile/` lock and exact-byte JSON journal, then invokes the **already merged** macOS helper for every move, promotion and restoration.

The sequence is: verify journal and starting file/digests; move Procedure into a reserved backup; promote its staged replacement; verify; move the old manifest into its reserved backup; promote new manifest **last**; verify target manifest and canonical content. No rename may overwrite an occupied destination.

Recovery verifies journal identity plus all observed digests before mutation. If the canonical manifest proves the target commit, it checks the Procedure's after-state and reports **committed**. Otherwise it accepts only an explicitly identified pre-commit before/after state, preserves promoted after bytes in another reserved name, and restores old bytes with the native no-replace helper. Unknown contents or an intervening user file produce a conflict and preserve existing files.

## What CI tests

- Successful one-file commit and repeat read-only recovery.
- Interrupted after Procedure backup, after replacement promotion, and after old manifest backup, followed by idempotent rollback.
- Interrupted after manifest commit, followed by committed/forward result (no rollback).
- User changes appearing at the vacated canonical path trigger a conflict; backup and user file survive.
- A tampered journal or managed-file drift fails before mutation.

The existing native smoke also tests real `SIGKILL` immediately after a move. The TypeScript orchestration tests intentionally **simulate process interruption at specific boundaries**, rather than claiming they execute a multi-file process-kill stress suite.

## Deliberate exclusions

- **No shipped CLI integration**, installed workspace operations, automatic clean-up or user-visible recovery commands.
- No multiple-Procedure transaction, concurrent cross-process journal recovery, same-digest manifest commit indicator, complete source-policy/ownership preflight, power-failure durability or Windows/Linux parity.
- This is not a general file-transaction framework and intentionally retains stage, backup and journal artifacts after tests to inspect consistency.
- A manifest digest match is commit proof **only because this fixture guarantees distinct starting/target manifests**; the general same-digest case remains unresolved in this experiment.
- Native-sidecar packaging in both npm and standalone binary distribution is a separate next milestone.

**Gate 0 remains open** and destructive production reconciliation disabled. The goal is a small verified macOS path, not broad speculative infrastructure.
