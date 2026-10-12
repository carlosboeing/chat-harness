import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { exactByteDigest } from "../../src/setup/manifest.js";
import { journalSibling, type ManagedTransactionJournal } from "../../src/setup/multifile-journal-contract.js";
import { serializeRecoveryRecord } from "../../src/setup/equal-digest-marker.js";
import { stageExclusiveMacosJournal } from "../../src/setup/stage-macos-journal.js";
import type { MacosHelperRuntime } from "../../src/workspace/macos-helper.js";

const id = "abcdef0123456789";
const target = "AGENTS.md";
const record: ManagedTransactionJournal = {
  schema: 1, transactionId: id,
  startingManifest: null, targetManifest: exactByteDigest("new manifest"),
  operations: [{
    path: target, owner: "core", action: "create",
    before: null, after: exactByteDigest("new AGENTS"),
    stage: journalSibling(target, "stage", id), backup: null,
  }],
};

const unavailable: MacosHelperRuntime = {
  platform: "linux", arch: "x64", standalone: false,
  entryPath: "/nonexistent/app.js", executablePath: "/nonexistent/bin",
};

describe("exclusive native macOS journal preparation", () => {
  test("poisoned journal and unsupported platform fail closed", () => {
    expect(() => stageExclusiveMacosJournal("/missing", {...record, transactionId:"../../bad"}, unavailable)).toThrow();
    expect(() => stageExclusiveMacosJournal("/missing", record, unavailable)).toThrow("unsupported");
  });

  test.skipIf(process.platform !== "darwin" || process.env.CHAT_HARNESS_TEST_PACKAGING !== "1")(
    "creates a verified journal in a newly reserved directory and never adopts the lock", () => {
      const scratch = mkdtempSync(path.join(os.tmpdir(),"harness-native-journal-"));
      try {
        const workspace = realpathSync(scratch);
        mkdirSync(path.join(workspace,".chat-harness/temp"),{recursive:true});
        const runtime: MacosHelperRuntime = {
          platform:"darwin",arch:process.arch==="x64"?"x64":"arm64",
          standalone:false,
          entryPath:path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js"),
          executablePath:"unused",
        };
        stageExclusiveMacosJournal(workspace,record,runtime);
        const journalFile = path.join(workspace,".chat-harness/temp/reconcile/journal.json");
        expect(readFileSync(journalFile,"utf8")).toBe(serializeRecoveryRecord(record));
        const before = readFileSync(journalFile);
        expect(() => stageExclusiveMacosJournal(workspace,record,runtime)).toThrow();
        expect(readFileSync(journalFile)).toEqual(before);
        expect(existsSync(path.join(workspace,target))).toBe(false);
      } finally {
        rmSync(scratch,{recursive:true,force:true});
      }
    },
  );
});
