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
