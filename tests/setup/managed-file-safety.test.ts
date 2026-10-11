import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertCanonicalManagedPath,
  inspectManagedDestination,
  promoteStageNoReplace,
} from "../../src/workspace/managed-path-safety.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-gate0-"));
  roots.push(root);
  return root;
}

test("rejects traversal, noncanonical and wrong-owner paths", () => {
  const invalid = [
    "../AGENTS.md", "/etc/passwd", "C:/Temp/evil", "//server/share",
    ".chat-harness/procedures/../../AGENTS.md", ".chat-harness//procedures/a.md",
    ".chat-harness/procedures/a\\b.md", ".chat-harness/procedures/CON.md",
    ".chat-harness/procedures/name.", ".chat-harness/procedures/e\u0301.md",
    ".chat-harness/procedures/nul.md", ".chat-harness/manifest.yaml",
  ];
  for (const value of invalid) {
    expect(() => assertCanonicalManagedPath(value, "specialist")).toThrow();
  }
  expect(() => assertCanonicalManagedPath(".chat-harness/procedures/handbook.md", "specialist")).not.toThrow();
  expect(() => assertCanonicalManagedPath("AGENTS.md", "core")).not.toThrow();
  expect(() => assertCanonicalManagedPath(".chat-harness/manifest.yaml", "workspace")).not.toThrow();
  expect(() => assertCanonicalManagedPath("AGENTS.md", "specialist")).toThrow();
});

test("rejects intermediate/leaf symlinks and case aliases", async () => {
  const root = await tempRoot();
  const outside = await tempRoot();
  await mkdir(path.join(root, ".chat-harness"));
  const procedures = path.join(root, ".chat-harness", "procedures");
  await symlink(outside, procedures, process.platform === "win32" ? "junction" : "dir");
  await expect(inspectManagedDestination(root, ".chat-harness/procedures/a.md", "specialist")).rejects.toThrow();
  await rm(procedures);
  await mkdir(procedures);
  const leaf = path.join(procedures, "a.md");
  await symlink(outside, leaf, process.platform === "win32" ? "junction" : "dir");
  await expect(inspectManagedDestination(root, ".chat-harness/procedures/a.md", "specialist")).rejects.toThrow();
  await rm(leaf);
  await writeFile(path.join(procedures, "A.md"), "existing");
  await expect(inspectManagedDestination(root, ".chat-harness/procedures/a.md", "specialist")).rejects.toThrow();
});

test("conditional promotion preserves a newly appeared destination and stage", async () => {
  const root = await tempRoot();
  const stage = path.join(root, ".stage");
  const target = path.join(root, "target");
  await writeFile(stage, "new");
  await writeFile(target, "intervening user data");
  await expect(promoteStageNoReplace(stage, target)).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(stage, "utf8")).toBe("new");
  expect(await readFile(target, "utf8")).toBe("intervening user data");
});

test("promotion creates exact bytes and removes only its stage name", async () => {
  const root = await tempRoot();
  const stage = path.join(root, ".stage");
  const target = path.join(root, "target");
  await writeFile(stage, "new bytes");
  await promoteStageNoReplace(stage, target);
  expect(await readFile(target, "utf8")).toBe("new bytes");
  expect(await readdir(root)).toEqual(["target"]);
});

test("two concurrent promotions never overwrite the winner", async () => {
  const root = await tempRoot();
  const stageA = path.join(root, ".stage-a");
  const stageB = path.join(root, ".stage-b");
  const target = path.join(root, "result");
  await writeFile(stageA, "A");
  await writeFile(stageB, "B");
  const results = await Promise.allSettled([
    promoteStageNoReplace(stageA, target),
    promoteStageNoReplace(stageB, target),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(["A", "B"]).toContain(await readFile(target, "utf8"));
});

test("stage must be a real sibling file", async () => {
  const root = await tempRoot();
  const stage = path.join(root, ".stage");
  const target = path.join(root, "target");
  await mkdir(stage);
  await expect(promoteStageNoReplace(stage, target)).rejects.toThrow();
  expect(await readdir(root)).toEqual([".stage"]);
  await expect(promoteStageNoReplace(path.join(root, "not-there"), path.join(root, "elsewhere", "target"))).rejects.toThrow();
});
