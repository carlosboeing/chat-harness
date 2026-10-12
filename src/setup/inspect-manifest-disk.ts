import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";

import type { Finding } from "../cli/result.js";
import { inspectManagedDestination, ManagedPathSafetyError, type ManagedFileOwner } from "../workspace/managed-path-safety.js";
import { exactByteDigest, parseManifest, type ContentDigest, type WorkspaceManifest } from "./manifest.js";
import { AGENTS_MANAGED_MARKER } from "./templates.js";

const MANIFEST = ".chat-harness/manifest.yaml";
const RECONCILE_LOCK = ".chat-harness/temp/reconcile";
const MAX_INSPECTED_BYTES = 16 * 1024 * 1024;
const PROCEDURE_MARKER = "<!-- chat-harness-managed: procedure -->\n";

export type DiskKind = "missing" | "file" | "directory" | "other" | "unsafe";
export type ManagedDiskState = "clean" | "missing" | "diverged" | "wrong_type" | "unsafe" | "wrong_marker";

export interface RecordedFileInspection {
  path: string;
  owner: string;
  recordedDigest: ContentDigest;
  actualDigest?: ContentDigest;
  kind: DiskKind;
  state: ManagedDiskState;
}

export interface ManifestDiskInspection {
  workspace: string;
  transaction: "absent" | "pending" | "unsafe";
  manifestState: "not_inspected" | "missing" | "valid" | "invalid" | "unsafe";
  manifest: WorkspaceManifest | null;
  files: readonly RecordedFileInspection[];
  findings: readonly Finding[];
}

/**
 * Read-only observational preflight. This is NOT a mutation authorization:
 * a future reconciler must recheck ownership and path identity under its
 * transaction lock before each native no-replace operation.
 *
 * Inspect the transaction lock before the manifest and historical paths.
 * A pending or suspicious lock blocks all further ownership interpretation.
 */
interface DiskEntry {
  kind: DiskKind;
  bytes?: Buffer;
}

const missing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT" ||
  (error as NodeJS.ErrnoException)?.code === "ENOTDIR";

function finding(code: string, location: string, message: string): Finding {
  return {
    code, severity: "error", location, message,
    remediation: "Preserve existing files and resolve the reported state before reconciliation.",
  };
}

function stableIdentity(a: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number },
                        b: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function observe(workspace: string, relative: string, owner: ManagedFileOwner): Promise<DiskEntry> {
  // Validates the namespace, each existing ancestor, case/Unicode aliases,
  // symlink leaves and changing ancestor identity before any content reads.
  const absolute = await inspectManagedDestination(workspace, relative, owner);
  let initial;
  try {
    initial = await lstat(absolute);
  } catch (error) {
    if (missing(error)) return { kind: "missing" };
    throw error;
  }
  if (initial.isSymbolicLink()) return { kind: "unsafe" };
  if (initial.isDirectory()) return { kind: "directory" };
  if (!initial.isFile()) return { kind: "other" };
  if (initial.size > MAX_INSPECTED_BYTES) throw new Error("File exceeds bounded read-only inspection limit");

  // Open without following a symlink introduced after lstat. Compare pathname
  // identity before and after reading; never open an uninspected ancestor.
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || !stableIdentity(initial, before)) throw new Error("File changed before read");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const leaf = await lstat(absolute);
    if (bytes.length > MAX_INSPECTED_BYTES || !leaf.isFile() ||
        !stableIdentity(before, after) || !stableIdentity(after, leaf)) {
      throw new Error("File changed during inspection");
    }
    // Re-evaluate ancestor aliases; the snapshot is informative, never an
    // exclusive lock or a substitute for native descriptor-anchored mutation.
    await inspectManagedDestination(workspace, relative, owner);
    return { kind: "file", bytes };
  } finally {
    await handle.close();
  }
}

function marked(buffer: Buffer, marker: string): boolean {
  return buffer.subarray(0, Buffer.byteLength(marker)).equals(Buffer.from(marker));
}

export async function inspectManifestDisk(workspace: string): Promise<ManifestDiskInspection> {
  const root = path.resolve(workspace);
  const findings: Finding[] = [];
  const files: RecordedFileInspection[] = [];
  let transaction: ManifestDiskInspection["transaction"] = "absent";
  let manifestState: ManifestDiskInspection["manifestState"] = "not_inspected";
  let manifest: WorkspaceManifest | null = null;

  const result = (): ManifestDiskInspection => ({
    workspace: root, transaction, manifestState, manifest,
    files: Object.freeze([...files]), findings: Object.freeze([...findings]),
  });

  try {
    const lock = await observe(root, RECONCILE_LOCK, "transaction");
    if (lock.kind === "directory") {
      transaction = "pending";
      findings.push(finding("setup.recovery_required", RECONCILE_LOCK,
        "A reconciliation transaction exists; read-only inspection will not interpret or recover managed files."));
      return result();
    }
    if (lock.kind !== "missing") {
      transaction = "unsafe";
      findings.push(finding("setup.recovery_conflict", RECONCILE_LOCK,
        "Reconciliation lock is not a normal directory; inspection stopped without following it."));
      return result();
    }
  } catch (error) {
    transaction = "unsafe";
    findings.push(finding("setup.recovery_conflict", RECONCILE_LOCK,
      "Cannot safely inspect transaction path: " + String(error)));
    return result();
  }

  let manifestEntry: DiskEntry;
  try {
    manifestEntry = await observe(root, MANIFEST, "workspace");
  } catch (error) {
    manifestState = "unsafe";
    findings.push(finding(error instanceof ManagedPathSafetyError ? error.code : "setup.manifest_unreadable",
      MANIFEST, "Cannot safely read manifest: " + String(error)));
    return result();
  }
  if (manifestEntry.kind === "missing") {
    manifestState = "missing";
    return result(); // Legacy/brownfield classification belongs to later planning.
  }
  if (manifestEntry.kind !== "file" || !manifestEntry.bytes) {
    manifestState = "unsafe";
    findings.push(finding("setup.manifest_type", MANIFEST, "Manifest is not a regular non-symlink file."));
    return result();
  }
  try {
    manifest = parseManifest(manifestEntry.bytes.toString("utf8"));
    manifestState = "valid";
  } catch (error) {
    manifestState = "invalid";
    findings.push(finding("setup.manifest_invalid", MANIFEST, String(error)));
    return result(); // Never traverse unvalidated manifest paths.
  }

  const owned: Array<{ path: string; owner: string; digest: ContentDigest }> = [
    { path: "AGENTS.md", owner: "core", digest: manifest.core.files["AGENTS.md"].digest },
  ];
  for (const [id, component] of Object.entries(manifest.specialists)) {
    for (const [relative, record] of Object.entries(component.files ?? {})) {
      owned.push({ path: relative, owner: id, digest: record.digest });
    }
  }

  for (const item of owned.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    let kind: DiskKind = "unsafe";
    let state: ManagedDiskState = "unsafe";
    let actualDigest: ContentDigest | undefined;
    try {
      const entry = await observe(root, item.path, item.owner === "core" ? "core" : "specialist");
      kind = entry.kind;
      if (kind === "missing") state = "missing";
      else if (kind !== "file" || !entry.bytes) state = kind === "unsafe" ? "unsafe" : "wrong_type";
      else {
        actualDigest = exactByteDigest(entry.bytes);
        state = actualDigest === item.digest ? "clean" : "diverged";
        const marker = item.owner === "core" ? AGENTS_MANAGED_MARKER + "\n" : PROCEDURE_MARKER;
        if (!marked(entry.bytes, marker)) state = "wrong_marker";
      }
    } catch (error) {
      findings.push(finding("setup.managed_path_unsafe", item.path, String(error)));
    }
    files.push({
      path: item.path, owner: item.owner, recordedDigest: item.digest,
      kind, state, ...(actualDigest ? { actualDigest } : {}),
    });
    if (state !== "clean") {
      const code = {
        missing: "setup.managed_file_missing",
        diverged: "setup.managed_file_diverged",
        wrong_type: "setup.managed_file_type",
        unsafe: "setup.managed_path_unsafe",
        wrong_marker: "setup.managed_marker_invalid",
      }[state];
      findings.push(finding(code, item.path,
        `Recorded managed file is ${state}; the manifest marker or digest cannot authorize changing it.`));
    }
  }
  return result();
}
