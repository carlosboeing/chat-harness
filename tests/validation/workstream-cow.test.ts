import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/main.js";
import { installMvpFixture } from "../helpers/mvp-workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const initial = `---
type: workstream
title: Fictional architecture
status: active
created: 2026-10-20
updated: 2026-10-20
---
# Fictional architecture

## Objective
Choose an architecture.

## Current direction
Compare alternatives.

## Next action
Compare the two approaches.
`;
const completed = initial.replace("status: active", "status: completed")
  .replace("Compare alternatives.", "Architecture chosen; design saved.")
  .replace("Compare the two approaches.", "Await implementation authorization.");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-workstream-cow-"));
  roots.push(root);
  await installMvpFixture(root);
  const directory = path.join(root, ".chat-harness/workstreams");
  return { root, directory, canonical: path.join(directory, "architecture.md"),
    backup: path.join(directory, ".architecture-backup-20261020.md") };
}

async function check(root: string, command: "validate" | "doctor", expectedExit: number) {
  let stdout = "";
  const code = await runCli([command, root, "--json"], {
    cwd: root, env: {}, isTTY: false,
    stdout: text => { stdout += text; }, stderr: () => {},
  });
  expect(code).toBe(expectedExit);
  return JSON.parse(stdout);
}

test.each(["validate", "doctor"] as const)("%s fails visibly on stale active backup beside completed canonical without modifying either", async command => {
  const f = await fixture();
  await writeFile(f.canonical, completed);
  await writeFile(f.backup, initial);
  const before = await readdir(f.directory);
  const result = await check(f.root, command, 1);
  expect(result.success).toBe(false);
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: "workstream.cow_cleanup_incomplete", severity: "error", location: await realpath(f.backup),
    remediation: expect.stringContaining("Never delete the last known-good copy"),
  }));
  expect(await readdir(f.directory)).toEqual(before);
  expect(await readFile(f.backup, "utf8")).toBe(initial);
  expect(await readFile(f.canonical, "utf8")).toBe(completed);
});

test("interrupted promotion preserves and diagnoses a backup even when canonical is absent", async () => {
  const f = await fixture();
  await writeFile(f.canonical, initial);
  await rename(f.canonical, f.backup);
  await check(f.root, "validate", 1);
  await check(f.root, "doctor", 1);
  expect(await readFile(f.backup, "utf8")).toBe(initial);
  expect(await readdir(f.directory)).toEqual([path.basename(f.backup)]);
});

test("verified promotion remains incomplete until cleanup, then both checks pass", async () => {
  const f = await fixture();
  await writeFile(f.backup, initial);
  await writeFile(f.canonical, completed);
  expect(await readFile(f.canonical, "utf8")).toBe(completed);
  // A denied, failed or interrupted host delete leaves this same observable state.
  // These diagnostics cannot establish the cause, and never perform recovery.
  await check(f.root, "validate", 1);
  await check(f.root, "doctor", 1);
  await rm(f.backup);
  await check(f.root, "validate", 0);
  await check(f.root, "doctor", 0);
  expect(await readFile(f.canonical, "utf8")).toBe(completed);
});

test("completed backup still requires cleanup; status alone cannot hide an interrupted checkpoint", async () => {
  const f = await fixture();
  await writeFile(f.backup, completed);
  await writeFile(f.canonical, completed);
  await check(f.root, "validate", 1);
  await check(f.root, "doctor", 1);
});

test("ordinary hidden Markdown and backup-related objectives remain valid", async () => {
  const f = await fixture();
  for (const name of [".notes.md", "database-backup-20261020.md", ".backup-policy.md", ".architecture-backup-not-a-date.md"]) {
    await writeFile(path.join(f.directory, name), initial);
  }
  await check(f.root, "validate", 0);
  await check(f.root, "doctor", 0);
});

test("doctor does not follow a symlink into another Workspace for COW inspection", async () => {
  const f = await fixture();
  const other = await fixture();
  await writeFile(other.backup, initial);
  await symlink(other.directory, path.join(f.directory, "external"));
  const result = await check(f.root, "doctor", 0);
  expect(result.findings.some((f: {code: string}) => f.code === "workstream.cow_cleanup_incomplete")).toBe(false);
  expect(await readFile(other.backup, "utf8")).toBe(initial);
});
