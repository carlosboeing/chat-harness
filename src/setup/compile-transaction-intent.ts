/**
 * Pure bridge from a reviewed semantic preview to a bounded journal and the
 * exact bytes to stage. This does not write, acquire a lock or authorize apply.
 * Native transaction execution must re-inspect all preconditions and paths.
 */
import { isSpecialistId } from "../specialists/definitions.js";
import { exactByteDigest, type ContentDigest } from "./manifest.js";
import { journalSibling, validateManagedJournal, type JournalMutation,
  type ManagedTransactionJournal } from "./multifile-journal-contract.js";
import type { CombinedReadonlyPlan, CombinedOperation } from "./readonly-reconcile-plan.js";

const MANIFEST = ".chat-harness/manifest.yaml";
export interface ProposedStage {
  /** Hidden sibling stage relative to the Workspace root. */
  path: string;
  content: string;
  digest: ContentDigest;
}
export interface CompiledTransactionIntent {
  journal: ManagedTransactionJournal;
  /** Includes the target manifest stage only when its bytes change. */
  stages: readonly ProposedStage[];
  /** Same-manifest-digest writes need atomic post-verification commit proof. */
  commitTokenRequired: boolean;
  executable: false;
}

function before(op: CombinedOperation): ContentDigest | null {
  if (op.expected.kind === "absent") return null;
  if (op.expected.kind === "exact_file") return op.expected.digest;
  throw new Error("Managed transaction lacks exact digest/absence precondition: " + op.path);
}

function contentFor(op: CombinedOperation): string {
  if (op.content === undefined || !op.afterDigest ||
      exactByteDigest(op.content) !== op.afterDigest) {
    throw new Error("Unverified rendered stage content: " + op.path);
  }
  return op.content;
}

export function compileReadonlyTransactionIntent(
  plan: CombinedReadonlyPlan,
  transactionId: string,
): CompiledTransactionIntent {
  if (!plan.safeToPresent || plan.findings.some(f => f.severity === "error") || plan.request === null ||
      plan.executable !== false || plan.operations.length === 0) {
    throw new Error("Cannot compile an incomplete/conflicted semantic preview");
  }

  const manifest = plan.operations.at(-1);
  if (!manifest || manifest.path !== MANIFEST || manifest.owner !== "manifest" ||
      !manifest.afterDigest || !["create_file", "replace_file", "unchanged"].includes(manifest.action)) {
    throw new Error("Manifest must be the final verified semantic operation");
  }
  const starting = before(manifest);
  const target = manifest.afterDigest;
  if (manifest.action === "create_file" && starting !== null ||
      manifest.action === "replace_file" && starting === null ||
      manifest.action === "unchanged" && starting !== target) {
    throw new Error("Manifest action contradicts its exact digest preconditions");
  }

  const stages: ProposedStage[] = [];
  const entries: JournalMutation[] = [];
  for (const op of plan.operations.slice(0,-1)) {
    if (op.action === "unchanged" || op.action === "create_directory") continue;
    if (op.owner === "scaffold") {
      // Create-once Source Policy and additive directories have no managed
      // rollback ownership; they may never become an overwrite/delete.
      if (op.action !== "create_file" || op.path !== ".chat-harness/source-policy.yaml" ||
          op.expected.kind !== "absent") {
        throw new Error("Unsafe attempt to include user-owned scaffold in managed transaction");
      }
      continue;
    }
    const owner = op.owner === "core" ? "core" :
      op.owner === "workspace" ? "workspace" :
      isSpecialistId(op.owner) ? "specialist" : null;
    if (!owner || !["create_file","replace_file","remove_file"].includes(op.action)) {
      throw new Error("Unexpected managed owner/action: " + op.path);
    }
    const previous = before(op);
    const next = op.action === "remove_file" ? null : op.afterDigest ?? null;
    const action = op.action === "create_file" ? "create" :
      op.action === "replace_file" ? "replace" : "remove";
    if (next) {
      stages.push({
        path: journalSibling(op.path,"stage",transactionId),
        content: contentFor(op), digest: next,
      });
    }
    entries.push({
      path:op.path, owner, action, before:previous, after:next,
      stage:next ? journalSibling(op.path,"stage",transactionId) : null,
      backup:previous ? journalSibling(op.path,"backup",transactionId) : null,
    });
  }
  entries.sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const compiled = validateManagedJournal({
    schema:1,transactionId,startingManifest:starting,targetManifest:target,operations:entries,
  });
  if (manifest.action !== "unchanged") {
    stages.push({
      path:journalSibling(MANIFEST,"stage",transactionId),
      content:contentFor(manifest),digest:target,
    });
  }
  const equalDigestNeedsProof = starting === target && entries.length > 0;
  if (plan.sameDigestTransactionRequired !== equalDigestNeedsProof) {
    throw new Error("Same-digest commit indication disagrees with the semantic plan");
  }
  return {
    journal:compiled,
    stages:Object.freeze(stages.sort((a,b)=>a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    commitTokenRequired:equalDigestNeedsProof,
    executable:false,
  };
}
