import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectReconcileTargets } from "../../src/setup/inspect-reconcile-targets.js";
import { inspectAdditiveScaffold, previewAdditiveScaffold } from "../../src/setup/inspect-additive-scaffold.js";
import { parseSpecialistSelection, resolveReconcileRequest } from "../../src/setup/reconcile-request.js";
import { buildDesiredManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE, SOURCE_POLICY_TEMPLATE } from "../../src/setup/templates.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "harness-additive-"));
  roots.push(value); return value;
}
async function fingerprint(directory: string): Promise<string> {
  const entries: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(directory, absolute);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) entries.push(relative + " -> " + await readlink(absolute));
      else if (stat.isDirectory()) { entries.push(relative + "/"); await walk(absolute); }
      else if (stat.isFile()) {
        entries.push(relative + "=" + createHash("sha256").update(await readFile(absolute)).digest("hex"));
      } else entries.push(relative + ":other");
    }
  }
  await walk(directory); return entries.join("\n");
}
async function assertUnchanged(workspace: string, work: () => Promise<void>): Promise<void> {
  const before = await fingerprint(workspace);
  await work();
  expect(await fingerprint(workspace)).toBe(before);
}

describe("pure desired Specialist set", () => {
  test("deduplicates, sorts, trims comma selections; none is exclusive", () => {
    expect(parseSpecialistSelection(" shopping,finance, shopping , career ")).toEqual(["career", "finance", "shopping"]);
    expect(parseSpecialistSelection("none")).toEqual([]);
    expect(() => parseSpecialistSelection("none,tax")).toThrow();
    for (const value of ["", " ", "tax,", "finance,,tax", "research", "Dev", "none,none"]) {
      expect(() => parseSpecialistSelection(value)).toThrow();
    }
  });

  test("omitted selection preserves installed Specialists, never silently clears", () => {
    const installed = buildDesiredManifest("0.3.7", AGENTS_TEMPLATE, ["travel", "shopping"]);
    const current = resolveReconcileRequest({}, installed);
    expect(current.desiredSpecialists).toEqual(["shopping", "travel"]);
    expect(current.scaffoldDomain).toBe(false);
    expect(current.replaceAgents).toBe(false);
    expect(resolveReconcileRequest({}, null).desiredSpecialists).toEqual([]);
    const requested = resolveReconcileRequest({ specialists: "none", scaffoldDomain: true }, installed);
    expect(requested.desiredSpecialists).toEqual([]);
    expect(requested.scaffoldDomain).toBe(true);
    expect(Object.isFrozen(requested.desiredSpecialists)).toBe(true);
  });
});

describe("read-only additive Core and Specialist scaffold", () => {
  test("fresh selection includes required directories and create-once Source Policy", async () => {
    const workspace = await root();
    await assertUnchanged(workspace, async () => {
      const request = resolveReconcileRequest({ specialists: "none" }, null);
      const inspected = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(inspected, request);
      expect(scaffold.blocked).toBe(false);
      const plan = previewAdditiveScaffold(scaffold);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.executable).toBe(false);
      const policy = plan.operations.find(x => x.path === ".chat-harness/source-policy.yaml")!;
      expect(policy).toMatchObject({ action: "create_file", expected: "absent" });
      expect(policy.afterDigest).toMatch(/^sha256:/);
      expect(plan.operations.find(x => x.path === "_inbox")?.action).toBe("create_directory");
      expect(plan.operations.some(x => x.path === "AGENTS.md")).toBe(false);
      expect(plan.operations.some(x => x.path.endsWith("/reconcile"))).toBe(false);
    });
  });

  test("selected domain scaffold is lexical additive union, never removal or ownership", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, "Research"));
    await writeFile(path.join(workspace, "Research", "mine.txt"), "user bytes");
    await assertUnchanged(workspace, async () => {
      const request = resolveReconcileRequest({
        specialists: "shopping, career, shopping", scaffoldDomain: true,
      }, null);
      const observed = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(observed, request);
      const plan = previewAdditiveScaffold(scaffold);
      expect(plan.safeToPresent).toBe(true);
      for (const directory of ["Opportunities", "Profile", "Purchases", "Research"]) {
        expect(plan.operations.find(x => x.path === directory)?.action)
          .toBe(directory === "Research" ? "unchanged" : "create_directory");
      }
      expect(plan.operations.every(x => !("remove" === x.action))).toBe(true);
      expect(plan.operations.some(x => x.path === "Tax")).toBe(false);
      const next = resolveReconcileRequest({ specialists: "none", scaffoldDomain: true }, null);
      const inspectedNone = await inspectReconcileTargets(workspace, next.desiredSpecialists);
      const nextPlan = previewAdditiveScaffold(await inspectAdditiveScaffold(inspectedNone, next));
      expect(nextPlan.operations.some(x => x.path === "Research")).toBe(false);
    });
    expect(await readFile(path.join(workspace, "Research/mine.txt"), "utf8")).toBe("user bytes");
  });

  test("existing user-authored Source Policy remains unchanged and is not manifest-owned", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, ".chat-harness"));
    const policy = path.join(workspace, ".chat-harness/source-policy.yaml");
    await writeFile(policy, "user: policy\n");
    await assertUnchanged(workspace, async () => {
      const request = resolveReconcileRequest({ specialists: "finance" }, null);
      const scan = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(scan, request);
      const preview = previewAdditiveScaffold(scaffold);
      expect(preview.safeToPresent).toBe(true);
      expect(preview.operations.find(x => x.path === ".chat-harness/source-policy.yaml"))
        .toEqual({ path: ".chat-harness/source-policy.yaml", action: "unchanged", expected: "existing_file" });
      expect(preview.operations.some(x => x.path === "Finance")).toBe(false);
    });
    expect(await readFile(policy, "utf8")).toBe("user: policy\n");
    expect(SOURCE_POLICY_TEMPLATE).not.toBe("user: policy\n");
  });

  test("case aliases, wrong directory types and symlinks fail closed without writes", async () => {
    const workspace = await root();
    await writeFile(path.join(workspace, "research"), "colliding alias");
    const request = resolveReconcileRequest({ specialists: "shopping", scaffoldDomain: true }, null);
    await assertUnchanged(workspace, async () => {
      const target = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(target, request);
      expect(scaffold.blocked).toBe(true);
      expect(scaffold.findings.some(x => x.code === "setup.scaffold_unsafe")).toBe(true);
      expect(previewAdditiveScaffold(scaffold).operations).toEqual([]);
    });
    await rm(path.join(workspace, "research"));
    await writeFile(path.join(workspace, "Research"), "user file collision");
    await assertUnchanged(workspace, async () => {
      const target = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(target, request);
      expect(scaffold.findings.some(x => x.code === "setup.scaffold_collision")).toBe(true);
      expect(previewAdditiveScaffold(scaffold).safeToPresent).toBe(false);
    });
    await rm(path.join(workspace, "Research"));
    const outside = await root();
    await symlink(outside, path.join(workspace, "Research"), process.platform === "win32" ? "junction" : "dir");
    await assertUnchanged(workspace, async () => {
      const target = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(target, request);
      expect(scaffold.findings.some(x => x.code === "setup.scaffold_unsafe")).toBe(true);
    });
  });

  test("pending journal stops scaffold inspection before observing managed paths", async () => {
    const workspace = await root();
    await mkdir(path.join(workspace, ".chat-harness/temp/reconcile"), { recursive: true });
    await writeFile(path.join(workspace, ".chat-harness/temp/reconcile/journal.json"), "{broken}");
    await assertUnchanged(workspace, async () => {
      const request = resolveReconcileRequest({ specialists: "shopping", scaffoldDomain: true }, null);
      const target = await inspectReconcileTargets(workspace, request.desiredSpecialists);
      const scaffold = await inspectAdditiveScaffold(target, request);
      expect(scaffold.blocked).toBe(true);
      expect(scaffold.observations).toEqual([]);
      expect(previewAdditiveScaffold(scaffold).operations).toEqual([]);
    });
  });

  test("disagreement between resolved exact set and snapshot blocks further inspection", async () => {
    const workspace = await root();
    const base = await inspectReconcileTargets(workspace, ["shopping"]);
    const request = resolveReconcileRequest({ specialists: "finance", scaffoldDomain: true }, null);
    const scaffold = await inspectAdditiveScaffold(base, request);
    expect(scaffold.blocked).toBe(true);
    expect(scaffold.findings.some(f => f.code === "setup.selection_changed")).toBe(true);
  });
});
