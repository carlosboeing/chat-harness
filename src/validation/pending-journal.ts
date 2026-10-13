/**
 * Inspect, never recover, a pending multi-file reconciliation journal.
 * A valid journal is still a pending transaction: it does not grant permission
 * to remove the lock, restore backups or trust a commit token.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { observeReadonlyManagedPath } from "../setup/inspect-manifest-disk.js";
import { validateManagedJournal } from "../setup/multifile-journal-contract.js";
import { matchesCompletionMarker } from "../setup/equal-digest-marker.js";

const JOURNAL = ".chat-harness/temp/reconcile/journal.json";
const TOKEN = ".chat-harness/temp/reconcile/commit.token";
const MAX_JOURNAL_BYTES = 64 * 1024;

function issue(code: string, location: string, reason: string): Finding {
  return { code, location, severity: "error", message: reason,
    remediation: "Preserve all transaction artifacts. Resolve the journal and recovery state with an authorized recovery procedure; never delete a suspicious lock automatically." };
}

/** Call only after the parent transaction reservation is a real directory. */
export async function inspectPendingJournalHealth(workspace: string, directory: ".chat-harness/temp/reconcile" | ".chat-harness/temp/reconcile-cleanup" = ".chat-harness/temp/reconcile"): Promise<Finding[]> {
  const JOURNAL=directory+"/journal.json", TOKEN=directory+"/commit.token";
  if(directory.endsWith("reconcile-cleanup") && (await readdir(path.join(workspace,directory))).length===0)return [];
  let parsed;
  try {
    const entry = await observeReadonlyManagedPath(workspace, JOURNAL, "transaction");
    if (entry.kind !== "file" || !entry.bytes) {
      return [issue("setup.recovery_conflict", JOURNAL,
        "The pending transaction has no safe regular journal file.")];
    }
    if (entry.bytes.length > MAX_JOURNAL_BYTES) {
      return [issue("setup.recovery_conflict", JOURNAL, "Transaction journal is oversized.")];
    }
    const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(entry.bytes);
    parsed = validateManagedJournal(JSON.parse(raw) as unknown);
  } catch (error) {
    return [issue("setup.recovery_conflict", JOURNAL,
      "Unrecognized, unreadable or poisoned transaction journal: " + String(error))];
  }

  // A token is not commit proof until it has a specified exact-byte format,
  // was created atomically AFTER verified output and is checked by recovery.
  try {
    const token = await observeReadonlyManagedPath(workspace, TOKEN, "transaction");
    if (token.kind !== "missing" && token.kind !== "file") {
      return [issue("setup.recovery_conflict", TOKEN, "Unsafe transaction commit-token type.")];
    }
    if (token.kind === "file") {
      if (!token.bytes || token.bytes.length > 1024) {
        return [issue("setup.recovery_conflict", TOKEN, "Unreadable or oversized commit token.")];
      }
      if (parsed.startingManifest !== parsed.targetManifest || parsed.operations.length === 0) {
        return [issue("setup.recovery_conflict", TOKEN,
          "Commit token is not valid for this journal's transaction type.")];
      }
      if (!matchesCompletionMarker(token.bytes, parsed)) {
        return [issue("setup.recovery_conflict", TOKEN,
          "Commit token does not match the validated journal and target manifest.")];
      }
    }
  } catch (error) {
    return [issue("setup.recovery_conflict", TOKEN,
      "Cannot safely inspect transaction commit-token path: " + String(error))];
  }
  // The caller retains setup.recovery_required; no implicit cleanup/commit.
  return [];
}
