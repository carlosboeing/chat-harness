import { expect, test } from "bun:test";
import { exactByteDigest } from "../../src/setup/manifest.js";
import { journalSibling, type ManagedTransactionJournal } from "../../src/setup/multifile-journal-contract.js";
import { expectedCompletionMarker, matchesCompletionMarker } from "../../src/setup/equal-digest-marker.js";

const id = "abcdef0123456789";
const manifest = exactByteDigest("same manifest");
const file = ".chat-harness/WORKSPACE.md";
const record: ManagedTransactionJournal = {
  schema: 1, transactionId: id, startingManifest: manifest, targetManifest: manifest,
  operations: [{
    path: file, owner: "workspace", action: "replace",
    before: exactByteDigest("old"), after: exactByteDigest("new"),
    stage: journalSibling(file, "stage", id), backup: journalSibling(file, "backup", id),
  }],
};
test("only an exact journal-bound completion marker is valid", () => {
  const marker = Buffer.from(expectedCompletionMarker(record));
  expect(matchesCompletionMarker(marker, record)).toBe(true);
  expect(matchesCompletionMarker(Buffer.from(marker.toString() + "\n"), record)).toBe(false);
  expect(matchesCompletionMarker(marker, {...record, transactionId: "1234567890abcdef"})).toBe(false);
  expect(() => expectedCompletionMarker({...record, targetManifest: exactByteDigest("different")})).toThrow();
  expect(() => expectedCompletionMarker({...record, operations: []})).toThrow();
});
