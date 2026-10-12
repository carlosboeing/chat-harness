import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { buildDesiredManifest, exactByteDigest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_MANAGED_MARKER, AGENTS_TEMPLATE, SOURCE_POLICY_TEMPLATE } from "../../src/setup/templates.js";
import { SPECIALISTS, specialistSections } from "../../src/specialists/definitions.js";
import { adoptUnmarkedWorkspaceInstructions, createWorkspaceInstructions,
  recomposeWorkspaceInstructions } from "../../src/setup/workspace-boundary.js";

const roots: string[] = [];
const VERSION = "0.3.7";
const MANIFEST = ".chat-harness/manifest.yaml";
const WORKSPACE = ".chat-harness/WORKSPACE.md";

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(ids: readonly string[] | null = null): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-combined-readonly-"));
  roots.push(root);
  if (ids !== null) {
    await mkdir(path.join(root, ".chat-harness/procedures"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), AGENTS_TEMPLATE);
    await writeFile(path.join(root, WORKSPACE), createWorkspaceInstructions(specialistSections(ids)));
    for (const id of ids) {
      for (const item of SPECIALISTS[id as keyof typeof SPECIALISTS].procedures ?? []) {
        await writeFile(path.join(root, item.path), item.content);
      }
    }
    await writeFile(path.join(root, MANIFEST),
      serializeManifest(buildDesiredManifest(VERSION, AGENTS_TEMPLATE, ids)));
  }
  return root;
}

async function tree(root: string): Promise<string> {
  const lines: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const absolute = path.join(current, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) lines.push(relative + " -> " + await readlink(absolute));
      else if (stat.isDirectory()) { lines.push(relative + "/"); await walk(absolute); }
      else if (stat.isFile()) lines.push(relative + "=" +
        createHash("sha256").update(await readFile(absolute)).digest("hex"));
      else lines.push(relative + ":other");
    }
  }
  await walk(root);
  return lines.join("\n");
}

async function unchanged(root: string, action: () => Promise<void>): Promise<void> {
  const before = await tree(root);
  await action();
  expect(await tree(root)).toBe(before);
}

describe("composed, non-executable reconciliation preview", () => {
  test("fresh Workspace: Core-only, parent-first scaffold and exact rendered bytes, manifest LAST", async () => {
    const root = await fixture();
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.request?.desiredSpecialists).toEqual([]);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.executable).toBe(false);
      const ops = plan.operations;
      expect(ops.at(-1)?.path).toBe(MANIFEST);
      expect(ops.at(-1)?.action).toBe("create_file");
      expect(ops.findIndex(x => x.path === ".chat-harness")).toBeLessThan(
        ops.findIndex(x => x.path === ".chat-harness/procedures"));
      expect(ops.findIndex(x => x.path === ".chat-harness")).toBeLessThan(
        ops.findIndex(x => x.path === ".chat-harness/source-policy.yaml"));
      expect(ops.findIndex(x => x.path === ".chat-harness")).toBeLessThan(
        ops.findIndex(x => x.path === WORKSPACE));
      expect(ops.find(x => x.path === "AGENTS.md")?.expected).toEqual({ kind: "absent" });
      expect(ops.find(x => x.path === ".chat-harness/source-policy.yaml")?.content)
        .toBe(SOURCE_POLICY_TEMPLATE);
      expect(ops.filter(x => x.action === "create_file" || x.action === "replace_file")
        .every(x => x.content !== undefined && exactByteDigest(x.content) === x.afterDigest))
        .toBe(true);
      expect(ops.filter(x => x.action === "remove_file")).toEqual([]);
      expect(plan.findings).toEqual([]);
    });
  });

  test("clean manifest-backed selected set: idempotent, excludes unselected scaffold", async () => {
    const root = await fixture(["shopping", "finance"]);
    await mkdir(path.join(root, ".chat-harness/temp"));
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.request?.desiredSpecialists).toEqual(["finance", "shopping"]);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.operations.filter(x => x.owner === "manifest")).toHaveLength(1);
      expect(plan.operations.at(-1)).toMatchObject({ path: MANIFEST, action: "unchanged" });
      expect(plan.operations.filter(x => x.owner === "shopping").every(x => x.action === "unchanged")).toBe(true);
      expect(plan.operations.some(x => x.path === "Purchases")).toBe(false);
    });
  });

  test("explicit none removes only owned Procedures, never deletes user directories", async () => {
    const root = await fixture(["shopping"]);
    await mkdir(path.join(root, "Purchases"));
    await writeFile(path.join(root, "Purchases/receipt.md"), "user receipt");
    const original = (await readFile(path.join(root, WORKSPACE), "utf8"))
      .replace("## Workspace customization\n", "## Personal notes\r\nKeep CRLF\r\n");
    await writeFile(path.join(root, WORKSPACE), original);
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, { specialists: "none" }, VERSION);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.request?.desiredSpecialists).toEqual([]);
      const deletes = plan.operations.filter(x => x.action === "remove_file");
      expect(deletes.map(x => x.path)).toEqual(SPECIALISTS.shopping.procedures!.map(x => x.path).sort());
      expect(deletes.every(x => x.expected.kind === "exact_file")).toBe(true);
      expect(plan.operations.find(x => x.path === "Purchases")).toBeUndefined();
      const workspace = plan.operations.find(x => x.path === WORKSPACE)!;
      expect(workspace.action).toBe("replace_file");
      expect(workspace.expected).toEqual({ kind: "exact_file", digest: exactByteDigest(original) });
      expect(workspace.content).toBe(recomposeWorkspaceInstructions(original, []));
      expect(workspace.content).toContain("## Personal notes\r\nKeep CRLF\r\n");
    });
    expect(await readFile(path.join(root, "Purchases/receipt.md"), "utf8")).toBe("user receipt");
  });

  test("unmarked brownfield files require BOTH explicit consents; preserve UTF-8 BOM and CRLF", async () => {
    const root = await fixture();
    const original = "\uFEFF# Existing Workspace\r\nSecret personal notes\r\n";
    await mkdir(path.join(root, ".chat-harness"));
    await writeFile(path.join(root, "AGENTS.md"), "non-harness user instructions\n");
    await writeFile(path.join(root, WORKSPACE), original);
    await unchanged(root, async () => {
      const noConsent = await inspectAndPlanReadonlyReconciliation(root,
        { specialists: "finance" }, VERSION);
      expect(noConsent.safeToPresent).toBe(false);
      expect(noConsent.operations).toEqual([]);
      expect(noConsent.findings.map(f => f.code)).toContain("setup.agents_consent_required");
      const justAgents = await inspectAndPlanReadonlyReconciliation(root,
        { specialists: "finance", replaceAgents: true }, VERSION);
      expect(justAgents.safeToPresent).toBe(false);
      expect(justAgents.findings.map(f => f.code)).toContain("setup.workspace_adoption_required");
      const all = await inspectAndPlanReadonlyReconciliation(root,
        { specialists: "finance", replaceAgents: true, adoptWorkspace: true }, VERSION);
      expect(all.safeToPresent).toBe(true);
      const workspace = all.operations.find(x => x.path === WORKSPACE)!;
      expect(workspace.content).toBe(adoptUnmarkedWorkspaceInstructions(original,
        specialistSections(["finance"])));
      expect(workspace.content?.endsWith(original)).toBe(true);
      expect(workspace.afterDigest).toBe(exactByteDigest(workspace.content!));
    });
  });

  test("changed managed Workspace with identical manifest records same-digest commit requirement", async () => {
    const root = await fixture(["finance"]);
    const initial = await readFile(path.join(root, WORKSPACE), "utf8");
    await writeFile(path.join(root, WORKSPACE),
      initial.replace("# Workspace Instructions", "# Human-modified managed heading"));
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.sameDigestTransactionRequired).toBe(true);
      expect(plan.operations.find(x => x.path === WORKSPACE)?.action).toBe("replace_file");
      expect(plan.operations.at(-1)?.action).toBe("unchanged");
    });
  });

  test("pending transaction blocks even legacy classification and never creates scaffold", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".chat-harness/temp/reconcile"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), AGENTS_TEMPLATE);
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.request).toBeNull();
      expect(plan.operations).toEqual([]);
      expect(plan.findings.map(f => f.code)).toEqual(["setup.recovery_required"]);
    });
  });

  test("unmistakable Chat Harness markers without manifest stop unsupported legacy adoption", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "AGENTS.md"), AGENTS_MANAGED_MARKER + "\nold managed");
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root,
        { replaceAgents: true, adoptWorkspace: true }, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.findings.map(f => f.code)).toContain("setup.legacy_workspace_unsupported");
      expect(plan.operations).toEqual([]);
    });
  });

  test("a pre-existing marked Workspace without manifest also requires explicit migration", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".chat-harness"));
    await writeFile(path.join(root, WORKSPACE), createWorkspaceInstructions([]));
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.findings.map(f => f.code)).toContain("setup.legacy_workspace_unsupported");
      expect(plan.operations).toEqual([]);
    });
  });

  test("invalid historical manifest, unowned Procedure collision and unsafe aliases are fail-closed", async () => {
    const root = await fixture();
    await mkdir(path.join(root, ".chat-harness/procedures"), { recursive: true });
    const proc = SPECIALISTS.shopping.procedures![0]!;
    await writeFile(path.join(root, proc.path), proc.content);
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, { specialists: "shopping" }, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.findings.map(f => f.code)).toContain("setup.unowned_procedure_collision");
      expect(plan.operations).toEqual([]);
    });
    await rm(path.join(root, proc.path));
    await writeFile(path.join(root, MANIFEST), "schema: 999\n");
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.request).toBeNull();
      expect(plan.operations).toEqual([]);
    });
    await rm(path.join(root, MANIFEST));
    await writeFile(path.join(root, "research"), "user alias");
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root,
        { specialists: "shopping", scaffoldDomain: true }, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.findings.map(f => f.code)).toContain("setup.scaffold_unsafe");
      expect(plan.operations).toEqual([]);
    });
  });

  test("symlinked managed ancestors never inspect outside Workspace", async () => {
    const root = await fixture();
    const outside = await fixture();
    await writeFile(path.join(outside, "secret"), "external user data");
    await symlink(outside, path.join(root, ".chat-harness"),
      process.platform === "win32" ? "junction" : "dir");
    await unchanged(root, async () => {
      const plan = await inspectAndPlanReadonlyReconciliation(root, {}, VERSION);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.operations).toEqual([]);
    });
    expect(await readFile(path.join(outside, "secret"), "utf8")).toBe("external user data");
  });
});
