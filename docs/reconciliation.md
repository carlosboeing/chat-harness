# Reconciliation and recovery

This describes the v1 implementation candidate. The software remains `0.3.7`; merge, version bump, tag and publication are separate approvals. Filesystem verification does not prove manual ChatGPT/other host activation.

## Supported execution boundary

| Platform | Native primitive | Mutation |
|---|---|---|
| macOS arm64/x64 | `renameatx_np(RENAME_EXCL)`, descriptor-relative no-follow traversal | Packaged native executor |
| Linux arm64/x64 | `renameat2(RENAME_NOREPLACE)`, descriptor-relative no-follow traversal | Packaged static native executor; kernel/filesystem must implement the primitive |
| Windows x64 | No proven destructive backend | Fail closed before any scaffold or managed write |

Windows software install/update/uninstall and read-only setup planning remain available. Green Windows lifecycle CI is not evidence of destructive reconciliation safety. Stable v1 publication needs a verified Windows implementation or explicit Design approval narrowing the mutation-platform contract.

Native helpers are compiled during builds/CI and shipped beside the CLI with checksums. Linux helpers statically include SHA-256 and libc. Runtime invocation verifies executable format, architecture, checksum and protocol at exact package-relative locations. There is no PATH helper lookup, compiler fallback, runtime source checkout or network fetch for embedded assets. Missing/tampered/unsupported helpers or filesystems fail closed.

## Transaction boundary

The physical Workspace root is pinned by a process-scoped native lease and its device/inode identity is checked on every native call. Existing aliases, traversal, symlinks and unsafe file types are refused. Participating setup/recovery processes serialize; editors are not globally locked. Active native mutations register against a pinned temp-directory lease. If the CLI parent terminates, root exclusion remains held until its already-running native child finishes; a child starting after parent/lease death fails closed.

After authorization, fresh `.chat-harness/` and `temp/` may be created additively. Exclusive reservation at `temp/reconcile/` is crash evidence. The bounded, strict journal records canonical paths, lexical operations, exact before/after digests and generated siblings. All semantic preconditions are revalidated after locking. Exclusive stages are digest/identity verified before canonical mutation.

Create, replace and remove use no-replace moves. Replacement/removal verifies the moved backup independently; a failed promotion attempts non-clobbering restoration. Unknown user edits preserve both copies and stop. The complete managed output set verifies before manifest-last commit and again before success. Equal starting/target manifest bytes require an atomic journal-bound completion token.

Committed transactions verify outputs and clean forward. Uncommitted proven states roll back deterministically. An atomic move into `temp/reconcile-cleanup/` retires a fully settled transaction before consuming its journal/token, allowing recovery through final cleanup interruption. Unknown third states, changed artifacts, unexpected evidence, poisoned/incomplete journals and ambiguous active/retired state remain intact and produce recovery conflicts. No recursive deletion is used in the production engine.

Additive scaffold has no rollback ownership. It may remain after an interrupted setup; existing user content is never consumed or removed to make the scaffold exact. Source Policy is create-once, exclusively staged and atomically promoted, and excluded from managed ownership. Partial or changed additive staging remains explicit recovery evidence.

## Operator recovery

1. Inspect with `setup --dry-run --json`, `validate --json` or `doctor --json`. These never recover or clean up.
2. Preserve copies of the Workspace and all transaction evidence before investigating a conflict.
3. Run an authorized ordinary `setup` to verify/recover a valid interrupted transaction and then re-plan. Interactive recovery consent precedes a fresh setup preview.
4. If recovery reports conflict, resolve the specific ownership, file-type, digest or third-state problem manually. Do not delete a suspicious reservation or overwrite a surviving backup to force setup through.

Unsupported pre-v1 markers/layouts without a supported manifest require separately authorized migration. Pending first-install journals are examined before historical-state classification.

## What verification establishes

Automated fixtures exercise fresh/repeated setup, all twelve bundles, exact removals, upgrades, brownfield consent, suffix/BOM/CRLF and unmanaged-byte preservation, staged/backed-up/promoted states, same-digest commit proof, poisoned journals, conflicts, native races and actual SIGKILL boundaries. Packaged Node and standalone entry points are exercised with an empty PATH.

These tests establish process-interruption recovery at the tested boundaries, assuming completed filesystem operations remain available. They do **not** establish OS-crash or power-loss durability. A partial journal or partial stage can be unprovable and intentionally requires manual conflict resolution. The initial threat model is accidental editors/other CLI processes, not isolation from an actively hostile process with identical OS permissions. Preflight/readback are conflict detection, not global serializability.
