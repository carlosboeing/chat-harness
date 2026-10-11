import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createVerifiedBackupSnapshot,
  managedBackupPath,
  restoreVerifiedBackupNoReplace,
  type ManagedBackupRequest,
} from "../../src/workspace/managed-backup-safety.js";

const roots: string[] = [];
const tx = "abcdef0123456789abcdef0123456789";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const supportedTest = constants.O_NOFOLLOW ? test : test.skip;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(relativePath = "AGENTS.md") {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-backup-"));
  roots.push(root);
  const canonical = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(canonical), { recursive: true });
  await writeFile(canonical, "original bytes");
  const request: ManagedBackupRequest = {
    workspace: root,
    relativePath,
    owner: relativePath === "AGENTS.md" ? "core" : "specialist",
    transactionId: tx,
    expectedSha256: hash("original bytes"),
  };
  return { root, canonical, request, backup: managedBackupPath(canonical, tx) };
}

supportedTest("backup snapshot preserves exact independent bytes and original path", async () => {
  const { canonical, request, backup } = await fixture();
  expect(await createVerifiedBackupSnapshot(request)).toBe(backup);
  expect(await readFile(canonical, "utf8")).toBe("original bytes");
  expect(await readFile(backup, "utf8")).toBe("original bytes");
  await writeFile(canonical, "later user edit");
  expect(await readFile(backup, "utf8")).toBe("original bytes");
});

supportedTest("digest mismatch fails closed without creating backup", async () => {
  const { canonical, request, backup } = await fixture();
  await writeFile(canonical, "modified");
  await expect(createVerifiedBackupSnapshot(request)).rejects.toMatchObject({
    code: "setup.backup_conflict",
  });
  await expect(lstat(backup)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(canonical, "utf8")).toBe("modified");
});

supportedTest("existing backup cannot be overwritten", async () => {
  const { canonical, request, backup } = await fixture();
  await writeFile(backup, "another transaction's data");
  await expect(createVerifiedBackupSnapshot(request)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(backup, "utf8")).toBe("another transaction's data");
  expect(await readFile(canonical, "utf8")).toBe("original bytes");
});

supportedTest("restore recovers only verified bytes, never consumes backup", async () => {
  const { canonical, request, backup } = await fixture();
  await createVerifiedBackupSnapshot(request);
  // Simulate a separately authorized removal. The snapshot API never removes canonical.
  await rm(canonical);
  await restoreVerifiedBackupNoReplace(request);
  expect(await readFile(canonical, "utf8")).toBe("original bytes");
  expect(await readFile(backup, "utf8")).toBe("original bytes");
});

supportedTest("concurrent leaf creation blocks restore without overwriting either copy", async () => {
  const { canonical, request, backup } = await fixture();
  await createVerifiedBackupSnapshot(request);
  await rm(canonical);
  await expect(restoreVerifiedBackupNoReplace(request, {
    beforeRestoreCreate: async () => {
      await writeFile(canonical, "intervening user data");
    },
  })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(canonical, "utf8")).toBe("intervening user data");
  expect(await readFile(backup, "utf8")).toBe("original bytes");
});

supportedTest("corrupt backup blocks restore and preserves evidence", async () => {
  const { canonical, request, backup } = await fixture();
  await createVerifiedBackupSnapshot(request);
  await rm(canonical);
  await writeFile(backup, "corrupted bytes");
  await expect(restoreVerifiedBackupNoReplace(request)).rejects.toMatchObject({
    code: "setup.backup_conflict",
  });
  await expect(lstat(canonical)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(backup, "utf8")).toBe("corrupted bytes");
});

supportedTest("interrupted backup creation keeps evidence, retry does not overwrite", async () => {
  const { canonical, request, backup } = await fixture();
  await expect(createVerifiedBackupSnapshot(request, {
    afterBackupWritten: () => { throw new Error("injected process interruption"); },
  })).rejects.toThrow("injected process interruption");
  expect(await readFile(backup, "utf8")).toBe("original bytes");
  await expect(createVerifiedBackupSnapshot(request)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(canonical, "utf8")).toBe("original bytes");
});

supportedTest("symlinked ancestor introduced before restore is rejected", async () => {
  const relative = ".chat-harness/procedures/example.md";
  const { root, canonical, request, backup } = await fixture(relative);
  const outside = await mkdtemp(path.join(os.tmpdir(), "chat-harness-backup-outside-"));
  roots.push(outside);
  await createVerifiedBackupSnapshot(request);
  await rm(canonical);
  const parent = path.dirname(canonical);
  const parked = path.join(root, ".chat-harness", "procedures-parked");

  await expect(restoreVerifiedBackupNoReplace(request, {
    beforeRestoreCreate: async () => {
      const { rename } = await import("node:fs/promises");
      await rename(parent, parked);
      await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
    },
  })).rejects.toMatchObject({ code: "setup.managed_path_unsafe" });
  expect(await readdir(outside)).toEqual([]);
  expect(await readFile(path.join(parked, path.basename(backup)), "utf8")).toBe("original bytes");
});

test("wrong backup transaction identifiers are rejected", async () => {
  const { canonical, request } = await fixture();
  expect(() => managedBackupPath(canonical, "../outside")).toThrow();
  await expect(createVerifiedBackupSnapshot({ ...request, transactionId: ".." })).rejects.toMatchObject({
    code: "setup.backup_conflict",
  });
});

test("runtime without O_NOFOLLOW refuses backup without modifying files", async () => {
  if (constants.O_NOFOLLOW) return;
  const { canonical, backup, request } = await fixture();
  await expect(createVerifiedBackupSnapshot(request)).rejects.toMatchObject({
    code: "setup.backup_conflict",
  });
  expect(await readFile(canonical, "utf8")).toBe("original bytes");
  await expect(lstat(backup)).rejects.toMatchObject({ code: "ENOENT" });
});
