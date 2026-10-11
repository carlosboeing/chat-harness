# vNext manifest contract — read-only PR C slice

The current branch adds pure `src/setup/manifest.ts` data functions: parse and validate schema-1 YAML, calculate `sha256:<lowercase hex>` exact-byte digests, build deterministic desired manifests from Core and the 12 approved versioned Specialists, serialize canonical key order, and preview recorded-versus-desired file differences.

## Ownership boundary

The manifest stores `schema: 1`, `harness.version`, independent `core.version`, `core.files.AGENTS.md.digest`, and `specialists.<id>.version` with optional owned `files.<path>.digest`. Empty selection renders as `specialists: {}`. `WORKSPACE.md`, Source Policy, Workstreams/Workbench, Inbox, scaffold directories, capability availability and arbitrary user corpus are deliberately **excluded**.

Historical Specialist paths are allowed only within the authorised `.chat-harness/procedures/` namespace, even if a particular Procedure was removed from the new bundle. Unknown IDs, newer installed versions, invalid digest/path, duplicate/aliased ownership, YAML key duplication, unsupported schema, and extra manifest fields are rejected. The standalone parser has **no disk mutation**.

## Important: a proposed change is NOT safe to execute

`previewManifestChanges` describes `create`, `replace`, `remove`, and `unchanged` solely by comparing manifest records. It cannot establish whether a file really exists, whether its bytes still match the recorded digest, whether an unrelated user file occupies the path, whether an ancestor is a symlink, or whether a concurrent process changes the filesystem during mutation. Those checks and safe cross-platform conditional moves are reserved for the manifest-aware reconciler after Gate 0 is fully proven.

Do not build a setup `--apply` path or destructive command from this preview. There is no journal, durable commit marker, rollback, or recovery engine in this slice. The existing v0.3.7-style CLI remains unchanged; no existing Workspaces are touched.

Tests cover deterministic formatting, digest exactness, 12-ID source compatibility, no empty-set phantom Specialist, historical file records, malformed schema/digests/aliases, and the read-only action preview.
