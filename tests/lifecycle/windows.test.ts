import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseWindowsLifecycleJob,
  runWindowsLifecycleJob,
  type WindowsHelperDependencies,
  type WindowsLifecycleJob,
} from "../../src/lifecycle/windows.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "chat-harness-windows-lifecycle-"));
  roots.push(root);
  return root;
}

function job(root: string): WindowsLifecycleJob {
  return {
    schema: 1,
    action: "replace",
    parentPid: 1234,
    target: path.join(root, "chat-harness.exe"),
    metadataPath: path.join(root, ".chat-harness-install.json"),
    staged: path.join(root, ".chat-harness-update.test.exe"),
    expectedVersion: "0.3.1",
    backupPath: path.join(root, ".chat-harness-backup.test.exe"),
    helperPath: path.join(os.tmpdir(), "chat-harness-lifecycle-test.exe"),
    jobPath: path.join(os.tmpdir(), "chat-harness-lifecycle-test.json"),
  };
}

function dependencies(overrides: Partial<WindowsHelperDependencies> = {}): WindowsHelperDependencies {
  return {
    exists: existsSync,
    rename: renameSync,
    remove: (target) => rmSync(target, { force: true }),
    verifyVersion: () => {},
    isProcessRunning: () => false,
    sleep: async () => {},
    scheduleCleanup: () => {},
    ...overrides,
  };
}

describe("Windows lifecycle helper", () => {
  test("native Windows update replaces all three software files and restores them on verification failure", async () => {
    for(const fail of [false,true]) {
      const root=tempRoot(),fixture=job(root);
      const suffix=".windows-safe-move.exe";
      fixture.nativeHelper={staged:fixture.staged!+suffix,backupPath:fixture.backupPath!+suffix,digest:"0".repeat(64)};
      const originals=new Map([[fixture.target,"old binary"],[fixture.target+suffix,"old native"],[fixture.target+suffix+".sha256","old checksum"]]);
      for(const [p,b] of originals)writeFileSync(p,b);
      writeFileSync(fixture.staged!,"new binary");writeFileSync(fixture.nativeHelper.staged,"new native");writeFileSync(fixture.nativeHelper.staged+".sha256","new checksum");
      const action=runWindowsLifecycleJob(fixture,dependencies({verifyNativeHelper:()=>{if(fail)throw new Error("helper mismatch");}}));
      if(fail)await expect(action).rejects.toThrow("helper mismatch");else await action;
      for(const [p,b] of originals)expect(readFileSync(p,"utf8")).toBe(fail?b:b.replace("old","new"));
    }
  });

  test("Windows uninstall removes its native companion pair and preserves Workspace files",async()=>{
    const root=tempRoot(),fixture=job(root);fixture.action="remove";
    const suffix=".windows-safe-move.exe";
    for(const p of [fixture.target,fixture.target+suffix,fixture.target+suffix+".sha256",path.join(root,"AGENTS.md")])writeFileSync(p,"preserve or remove");
    await runWindowsLifecycleJob(fixture,dependencies());
    expect(existsSync(fixture.target+suffix)).toBe(false);
    expect(existsSync(fixture.target+suffix+".sha256")).toBe(false);
    expect(readFileSync(path.join(root,"AGENTS.md"),"utf8")).toBe("preserve or remove");
  });
  test("rejects malformed jobs", () => {
    expect(() => parseWindowsLifecycleJob("{}")).toThrow(/Invalid Windows lifecycle job/);
    expect(() => parseWindowsLifecycleJob("not-json")).toThrow(/Invalid Windows lifecycle job/);
  });

  test("waits for the parent to exit before replacing the executable", async () => {
    const root = tempRoot();
    const fixture = job(root);
    writeFileSync(fixture.target, "old");
    writeFileSync(fixture.staged!, "new");
    const running = [true, false];
    let sleeps = 0;

    await runWindowsLifecycleJob(fixture, dependencies({
      isProcessRunning: () => running.shift() ?? false,
      sleep: async () => { sleeps += 1; },
      verifyVersion: (binary, expected) => {
        expect(expected).toBe("0.3.1");
        expect(readFileSync(binary, "utf8")).toBe("new");
      },
    }));

    expect(sleeps).toBe(1);
    expect(readFileSync(fixture.target, "utf8")).toBe("new");
    expect(existsSync(fixture.backupPath!)).toBe(false);
  });

  test("restores the previous executable when verification fails", async () => {
    const root = tempRoot();
    const fixture = job(root);
    writeFileSync(fixture.target, "old");
    writeFileSync(fixture.staged!, "new");

    await expect(runWindowsLifecycleJob(fixture, dependencies({
      verifyVersion: () => { throw new Error("wrong version"); },
    }))).rejects.toThrow(/wrong version/);

    expect(readFileSync(fixture.target, "utf8")).toBe("old");
    expect(existsSync(fixture.staged!)).toBe(false);
  });

  test("remove job deletes only executable and install metadata", async () => {
    const root = tempRoot();
    const fixture = job(root);
    fixture.action = "remove";
    delete fixture.staged;
    delete fixture.expectedVersion;
    delete fixture.backupPath;

    const workspace = path.join(root, "AGENTS.md");
    writeFileSync(fixture.target, "binary");
    writeFileSync(fixture.metadataPath!, "metadata");
    writeFileSync(workspace, "user data");

    await runWindowsLifecycleJob(fixture, dependencies());

    expect(existsSync(fixture.target)).toBe(false);
    expect(existsSync(fixture.metadataPath!)).toBe(false);
    expect(readFileSync(workspace, "utf8")).toBe("user data");
  });
});
