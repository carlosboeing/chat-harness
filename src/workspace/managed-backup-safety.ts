import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  inspectManagedDestination,
  type ManagedFileOwner,
} from "./managed-path-safety.js";

export class ManagedBackupConflictError extends Error {
  readonly code = "setup.backup_conflict";

  constructor(message: string) {
    super(message);
    this.name = "ManagedBackupConflictError";
  }
}

export type ManagedBackupRequest = {
  workspace: string;
  relativePath: string;
  owner: ManagedFileOwner;
  transactionId: string;
  expectedSha256: string;
};

/** Narrow test-only fault seam. Neither operation is wired into reconciliation yet. */
export type BackupFaultHooks = {
  afterBackupWritten?: () => Promise<void> | void;
  beforeRestoreCreate?: () => Promise<void> | void;
};

function conflict(message: string): never {
  throw new ManagedBackupConflictError(message);
}

function assertExpectedDigest(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) conflict("Expected SHA-256 must be lowercase hex");
}

function assertTransactionId(value: string): void {
  if (!/^[a-f0-9]{16,64}$/.test(value)) conflict("Invalid transaction ID");
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function managedBackupPath(canonical: string, transactionId: string): string {
  assertTransactionId(transactionId);
  return path.join(
    path.dirname(canonical),
    "." + path.basename(canonical) + ".chat-harness-backup-" + transactionId,
  );
}

async function readPinnedRegularFile(
  filename: string,
  expectedSha256: string,
): Promise<Uint8Array> {
  assertExpectedDigest(expectedSha256);

  // Open a file descriptor before reading: avoid following a swapped leaf path.
  // O_NOFOLLOW is required; unsupported platforms must fail rather than drop it.
  if (!constants.O_NOFOLLOW) conflict("O_NOFOLLOW is not available on this runtime");
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) conflict("Backup source is not a regular file");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const leaf = await lstat(filename);
    if (
      !after.isFile() ||
      leaf.isSymbolicLink() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      leaf.dev !== after.dev ||
      leaf.ino !== after.ino ||
      before.size !== after.size
    ) {
      conflict("File identity changed during verification");
    }
    if (digest(bytes) !== expectedSha256) conflict("File content differs from expected digest");
    return bytes;
  } finally {
    await handle.close();
  }
}

/**
 * Prepare an independent, verified backup using O_EXCL creation; NEVER removes
 * the canonical file. Unlike hardlinks, the backup is unaffected by subsequent
 * in-place edits to the canonical inode. Keep failed/incomplete backup evidence.
 *
 * NOT an atomic move or transaction. The caller must still solve conditional
 * canonical removal and parent-directory race safety before destructive use.
 */
export async function createVerifiedBackupSnapshot(
  request: ManagedBackupRequest,
  hooks: BackupFaultHooks = {},
): Promise<string> {
  const canonical = await inspectManagedDestination(
    request.workspace, request.relativePath, request.owner,
  );
  const backup = managedBackupPath(canonical, request.transactionId);
  const bytes = await readPinnedRegularFile(canonical, request.expectedSha256);
  await inspectManagedDestination(request.workspace, request.relativePath, request.owner);

  // wx = O_CREAT|O_EXCL: an existing backup is never overwritten.
  await writeFile(backup, bytes, { flag: "wx", mode: 0o600 });
  await hooks.afterBackupWritten?.();
  const saved = await readPinnedRegularFile(backup, request.expectedSha256);
  if (digest(saved) !== request.expectedSha256) conflict("Backup readback mismatch");
  return backup;
}

/**
 * Restore only proven backup bytes to an ABSENT canonical path using O_EXCL.
 * Never overwrites an intervening canonical file and never consumes the backup.
 * The journal owner must verify/clean up only after full transaction recovery.
 *
 * A portable Node path-based API does NOT close concurrent ancestor-replacement
 * races. This is a tested feasibility primitive, not a production recovery API.
 */
export async function restoreVerifiedBackupNoReplace(
  request: ManagedBackupRequest,
  hooks: BackupFaultHooks = {},
): Promise<void> {
  const canonical = await inspectManagedDestination(
    request.workspace, request.relativePath, request.owner,
  );
  const backup = managedBackupPath(canonical, request.transactionId);
  const bytes = await readPinnedRegularFile(backup, request.expectedSha256);
  await hooks.beforeRestoreCreate?.();
  await inspectManagedDestination(request.workspace, request.relativePath, request.owner);
  // Exclusive creation prevents clobber if the leaf appears after inspection.
  await writeFile(canonical, bytes, { flag: "wx", mode: 0o600 });
  await readPinnedRegularFile(canonical, request.expectedSha256);
}
