import { exactByteDigest } from "./manifest.js";
import { validateManagedJournal, type ManagedTransactionJournal } from "./multifile-journal-contract.js";

/** Canonical representation of an already validated recovery journal. */
export function serializeRecoveryRecord(value: ManagedTransactionJournal): string {
  return JSON.stringify(validateManagedJournal(value)) + "\n";
}

/** Marker bytes for a transaction whose manifest digest cannot prove completion. */
export function expectedCompletionMarker(value: ManagedTransactionJournal): string {
  const record = validateManagedJournal(value);
  if (!record.startingManifest || record.startingManifest !== record.targetManifest ||
      record.operations.length === 0) {
    throw new Error("Completion marker is only valid for changed files with an unchanged manifest.");
  }
  return ["chat-harness-complete-v1", record.transactionId,
    exactByteDigest(serializeRecoveryRecord(record)), record.targetManifest].join(" ") + "\n";
}

export function matchesCompletionMarker(bytes: Uint8Array, record: ManagedTransactionJournal): boolean {
  const expected = Buffer.from(expectedCompletionMarker(record));
  const received = Buffer.from(bytes);
  return received.length === expected.length && received.equals(expected);
}
