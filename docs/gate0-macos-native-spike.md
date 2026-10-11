# Gate 0 macOS native helper feasibility spike

**Experiment only.** This is not included in npm/standalone Chat Harness distributions, does not change CLI behavior, is not called from setup/reconciliation, and does not authorize deleting or overwriting anything.

## Approved direction and scope

User selected a **small native-helper approach** for practical single-user operation (2026-10-12). Prioritize preventing accidental file loss, handling normal concurrent editors, verified backups and interruptions. A hostile process running under the same account and deliberately swapping parent directories is **not** the initial threat model. This does not silently change the approved cross-platform or existing-file ownership contracts for final vNext.

## What this spike verifies on a macOS CI runner

`native/macos/gate0-safe-move.c` is a single C helper, using system APIs only:

- Opens one **trusted and already inspected** parent directory `O_DIRECTORY|O_NOFOLLOW` and keeps the directory handle pinned.
- Opens source through `openat` with `O_NOFOLLOW`, hashes exact bytes, and checks descriptor and directory-entry inode identity.
- Moves source to a reserved backup using `renameatx_np(..., RENAME_EXCL)` so an existing destination is never overwritten.
- **After the move**, hashes the moved backup. If it differs from the expected last-applied digest, tries to restore it with another no-replace rename, preserving evidence on a conflict.
- Uses the same no-replace move for staged promotion and backup restoration.
- Rejects wrong SHA-256, unsafe leaf names, symlinked leaf sources, occupied backup/promote destinations and a symlink as the supplied parent leaf.
- Test-only pause between source verification and rename makes concurrent in-place edits deterministic and verifies they return an error without dropping user bytes.

Run `bash tests/native/macos-gate0-spike.sh` on macOS. CI's macOS safety job compiles the helper with the system `cc`; no install script, dependency manager, FFI package or runtime hook is added.

## What this does NOT prove

- Complete parent-chain containment: this spike assumes its `PARENT_DIR` was previously inspected. An ancestor above that path may still be a symlink during `open`. A release adapter must anchor descent from an already verified Workspace root or reject the case; **not** simply reuse this experiment's parent path.
- Source *identity* under an adversarial same-user actor who deliberately swaps same-content files after preflight; or malicious directory movement while a pinned directory descriptor is open.
- Whole-Workspace manifest-last journaling, nested managed paths, multi-file failure recovery, durable power-loss claims, cancellation, Windows/NTFS or Linux behavior, or unsupported filesystem compatibility.
- A full solution to Gate 0. Nothing should consume this helper in the production reconciler yet.

## Next step / stop condition

If the macOS runner confirms actual compilation and race tests, decide whether a similarly tiny directory-traversing production adapter (or a single process-scoped helper invocation per transaction) can satisfy the remaining *accidental-concurrency* requirements. A production build requires an explicit supported-platform packaging and failure policy. Keep Windows/Linux scoped as subsequent proofs, not pretend macOS results transfer to them. If the narrower practical target needs a Design contract change, obtain explicit approval before destructive integration.

Sources: Apple macOS manual `openat`, `O_NOFOLLOW`: https://man.freebsd.org/cgi/man.cgi?manpath=macOS+26.6.1&query=open&sektion=2 ; `renameatx_np` / `RENAME_EXCL`: https://man.freebsd.org/cgi/man.cgi?manpath=macOS+26.6.1&query=rename&sektion=2 .
