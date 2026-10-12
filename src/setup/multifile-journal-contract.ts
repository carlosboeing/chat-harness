/**
 * Bounded, pure multi-file reconciliation journal contract and recovery
 * classification. It does not read or change the filesystem. A future native
 * recovery executor must independently verify every observed path and digest
 * through root-anchored, no-replace primitives immediately before each move.
 *
 * Never infer commitment from equal manifest digests: those transactions need
 * an independently verified atomic commit token.
 */
import { assertCanonicalManagedPath, type ManagedFileOwner } from "../workspace/managed-path-safety.js";
import type { ContentDigest } from "./manifest.js";

export type JournalOwner = "core" | "workspace" | "specialist";
export type JournalAction = "create" | "replace" | "remove";
export type JournalObservedDigest = ContentDigest | null | "unsafe";

export interface JournalMutation {
  path: string;
  owner: JournalOwner;
  action: JournalAction;
  before: ContentDigest | null;
  after: ContentDigest | null;
  /** Fixed sibling names, never paths supplied by external callers. */
  stage: string | null;
  backup: string | null;
}

export interface ManagedTransactionJournal {
  schema: 1;
  transactionId: string;
  startingManifest: ContentDigest | null;
  targetManifest: ContentDigest;
  operations: readonly JournalMutation[];
}

export interface JournalMutationObservation {
  path: string;
  canonical: JournalObservedDigest;
  stage: JournalObservedDigest;
  backup: JournalObservedDigest;
}

export interface RecoveryObservation {
  canonicalManifest: JournalObservedDigest;
  manifestBackup: JournalObservedDigest;
  /** Exact independently verified commit token, only for equal-manifest cases. */
  equalManifestCommit: "absent" | "verified" | "unsafe";
  operations: readonly JournalMutationObservation[];
}

/** Inspection decision only. A decision is never an authorization to act. */
export type RecoveryDecision = "committed" | "rollback" | "conflict";
export interface RecoveryAssessment {
  decision: RecoveryDecision;
  /** Observed before/after state for each affected logical path. */
  files: readonly { path: string; state: "before" | "backed_up" | "after" }[];
  conflicts: readonly string[];
  executable: false;
}

const SHA = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{16,32}$/;

function validDigest(d: unknown): d is ContentDigest {
  return typeof d === "string" && SHA.test(d);
}

function assertDigest(d: unknown, place: string, optional = false): asserts d is ContentDigest | null {
  if (optional && d === null) return;
  if (!validDigest(d)) throw new Error("Invalid journal digest: " + place);
}

function leaf(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
function parent(path: string): string { return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""; }

/** Generated sibling leaf names are deterministic, never caller-selected. */
export function journalSibling(path: string, kind: "stage" | "backup", transactionId: string): string {
  if (!TOKEN.test(transactionId)) throw new Error("Invalid transaction ID");
  const name = `.${leaf(path)}.chat-harness-${kind}-${transactionId}`;
  return parent(path) ? parent(path) + "/" + name : name;
}

/**
 * Reject poisoned journals before reading any path named inside them.
 * The journal never owns user files outside Core/Workspace/Procedure paths.
 */
export function validateManagedJournal(value: unknown): ManagedTransactionJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Journal must be an object");
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).sort().join(",") !==
      ["operations", "schema", "startingManifest", "targetManifest", "transactionId"].sort().join(",")) {
    throw new Error("Unknown/missing journal fields");
  }
  if (obj.schema !== 1 || typeof obj.transactionId !== "string" || !TOKEN.test(obj.transactionId)) {
    throw new Error("Unsupported journal schema or transaction ID");
  }
  assertDigest(obj.startingManifest, "startingManifest", true);
  assertDigest(obj.targetManifest, "targetManifest");
  if (!Array.isArray(obj.operations) || obj.operations.length > 128) throw new Error("Invalid journal operation count");
  const seen = new Set<string>();
  const sidecars = new Set<string>();
  const mutations: JournalMutation[] = [];
  for (const [i, raw] of obj.operations.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid journal operation " + i);
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !==
        ["action", "after", "backup", "before", "owner", "path", "stage"].sort().join(",")) {
      throw new Error("Unexpected journal mutation fields");
    }
    if (typeof item.path !== "string" ||
        !["core", "workspace", "specialist"].includes(String(item.owner)) ||
        !["create", "replace", "remove"].includes(String(item.action))) {
      throw new Error("Invalid journal mutation owner/path/action");
    }
    if (item.path === ".chat-harness/manifest.yaml" || item.path === ".chat-harness/source-policy.yaml") {
      throw new Error("Manifest and Source Policy may not be ordinary journal mutations");
    }
    const owner = item.owner as JournalOwner;
    assertCanonicalManagedPath(item.path, owner as ManagedFileOwner);
    const key = item.path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error("Aliased or duplicate transaction destination");
    seen.add(key);
    assertDigest(item.before, "before", true);
    assertDigest(item.after, "after", true);
    const action = item.action as JournalAction;
    if ((action === "create" && (item.before !== null || item.after === null || item.backup !== null)) ||
        (action === "replace" && (item.before === null || item.after === null || item.before === item.after)) ||
        (action === "remove" && (item.before === null || item.after !== null || item.stage !== null))) {
      throw new Error("Inconsistent journal action/digests");
    }
    const expectedStage = item.after === null ? null : journalSibling(item.path, "stage", obj.transactionId);
    const expectedBackup = item.before === null ? null : journalSibling(item.path, "backup", obj.transactionId);
    if (item.stage !== expectedStage || item.backup !== expectedBackup) {
      throw new Error("Unexpected transaction sidecar name");
    }
    for (const name of [expectedStage, expectedBackup]) {
      if (!name) continue;
      const alias = name.normalize("NFC").toLowerCase();
      if (sidecars.has(alias) || seen.has(alias)) throw new Error("Sidecar name collision");
      sidecars.add(alias);
    }
    mutations.push({
      path: item.path, owner, action,
      before: item.before as ContentDigest | null, after: item.after as ContentDigest | null,
      stage: expectedStage, backup: expectedBackup,
    });
  }
  const sorted = [...mutations].sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (JSON.stringify(mutations.map(m=>m.path)) !== JSON.stringify(sorted.map(m=>m.path))) {
    throw new Error("Journal operations must be ordered lexically");
  }
  return {
    schema: 1, transactionId: obj.transactionId, startingManifest: obj.startingManifest as ContentDigest | null,
    targetManifest: obj.targetManifest as ContentDigest, operations: Object.freeze(mutations),
  };
}

/**
 * One global go/no-go decision. Even if some paths are individually proven,
 * any poisoned/third-state path suppresses the complete recovery decision.
 */
export function assessManagedRecovery(
  input: ManagedTransactionJournal,
  observed: RecoveryObservation,
): RecoveryAssessment {
  const journal = validateManagedJournal(input);
  const conflicts: string[] = [];
  const files: Array<{path:string;state:"before"|"backed_up"|"after"}> = [];
  const finish = (decision: RecoveryDecision): RecoveryAssessment => ({
    decision: conflicts.length ? "conflict" : decision, executable: false,
    conflicts: Object.freeze([...conflicts]), files: Object.freeze([...files]),
  });
  const same = journal.startingManifest === journal.targetManifest;
  if (observed.equalManifestCommit === "unsafe") conflicts.push("Commit token state is unsafe");
  if (!same && observed.equalManifestCommit !== "absent") conflicts.push("Unexpected equal-digest commit token");
  if (same && journal.startingManifest === null) conflicts.push("Absent starting manifest cannot equal target");
  if (observed.canonicalManifest === "unsafe" || observed.manifestBackup === "unsafe") {
    conflicts.push("Manifest path or backup is unsafe");
  }
  const committed = same
    ? observed.equalManifestCommit === "verified"
    : observed.canonicalManifest === journal.targetManifest;

  if (committed) {
    if (observed.canonicalManifest !== journal.targetManifest) {
      conflicts.push("Committed state lacks target manifest");
    }
    if (observed.manifestBackup !== null && observed.manifestBackup !== journal.startingManifest) {
      conflicts.push("Committed manifest backup diverged");
    }
  } else {
    const allowed = observed.canonicalManifest === journal.startingManifest &&
          observed.manifestBackup === null ||
      observed.canonicalManifest === null && observed.manifestBackup === journal.startingManifest;
    if (!allowed) conflicts.push("Uncommitted manifest is not in a proven before/backup state");
  }

  const byPath = new Map<string, JournalMutationObservation>();
  for (const row of observed.operations) {
    if (byPath.has(row.path)) conflicts.push("Duplicate observed path: " + row.path);
    byPath.set(row.path, row);
  }
  if (byPath.size !== journal.operations.length) conflicts.push("Journal/observation count mismatch");

  for (const op of journal.operations) {
    const row = byPath.get(op.path);
    if (!row) { conflicts.push("Unobserved path: " + op.path); continue; }
    const { canonical, stage, backup } = row;
    if (canonical === "unsafe" || stage === "unsafe" || backup === "unsafe") {
      conflicts.push("Unsafe file or transaction artifact: " + op.path); continue;
    }
    if (stage !== null && stage !== op.after) conflicts.push("Staged bytes changed: " + op.path);
    if (backup !== null && backup !== op.before) conflicts.push("Backed-up bytes changed: " + op.path);
    if (op.stage === null && stage !== null) conflicts.push("Unexpected stage: " + op.path);
    if (op.backup === null && backup !== null) conflicts.push("Unexpected backup: " + op.path);

    if (committed) {
      if (canonical !== op.after) conflicts.push("Committed output is not target state: " + op.path);
      else files.push({path:op.path,state:"after"});
    } else if (canonical === op.before && backup === null) {
      files.push({path:op.path,state:"before"});
    } else if (canonical === null && backup === op.before && op.before !== null) {
      files.push({path:op.path,state:"backed_up"});
    } else if (canonical === op.after && backup === op.before &&
               (op.action === "replace" || op.action === "create")) {
      files.push({path:op.path,state:"after"});
    } else {
      conflicts.push("Unproven precommit state: " + op.path);
    }
  }
  for (const key of byPath.keys()) {
    if (!journal.operations.some(op=>op.path===key)) conflicts.push("Unexpected observation: " + key);
  }
  return finish(committed ? "committed" : "rollback");
}
