/**
 * Reserve the fixed reconciliation transaction directory and publish its exact
 * validated journal bytes, using only packaged root-anchored native primitives.
 *
 * This is a bounded preparation step, NOT an apply/recovery procedure. It
 * requires the existing .chat-harness/temp directory, never creates a missing
 * scaffold and never mutates managed canonical files. On any error, leave the
 * reservation and partial journal as evidence for read-only diagnostics.
 */
import { exactByteDigest } from "./manifest.js";
import { validateManagedJournal, type ManagedTransactionJournal } from "./multifile-journal-contract.js";
import { serializeRecoveryRecord } from "./equal-digest-marker.js";
import {
  invokeMacosSafeStage, reserveMacosReconciliationLock,
  type MacosHelperRuntime,
} from "../workspace/macos-helper.js";

const MAX_JOURNAL_BYTES = 64 * 1024;

export function stageExclusiveMacosJournal(
  workspace: string,
  value: ManagedTransactionJournal,
  runtime?: MacosHelperRuntime,
): void {
  // Nothing can touch the filesystem until the strict journal contract
  // and the bounded exact serialized payload have been verified.
  const journal = validateManagedJournal(value);
  const payload = Buffer.from(serializeRecoveryRecord(journal), "utf8");
  if (payload.length > MAX_JOURNAL_BYTES) {
    throw new Error("Transaction journal exceeds bounded read-only inspector limit");
  }
  const digest = exactByteDigest(payload).slice("sha256:".length);
  reserveMacosReconciliationLock(workspace, runtime);
  // O_EXCL: a preexisting journal is never adopted or overwritten.
  invokeMacosSafeStage({
    workspace, parent: ".chat-harness/temp/reconcile",
    destination: "journal.json", digest, content: payload,
  }, runtime);
}
