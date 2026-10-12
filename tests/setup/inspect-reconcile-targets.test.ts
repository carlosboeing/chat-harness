import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectReconcileTargets, buildReadonlySemanticPreview } from "../../src/setup/inspect-reconcile-targets.js";
import { buildDesiredManifest, exactByteDigest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE } from "../../src/setup/templates.js";
import { SPECIALISTS, specialistSections } from "../../src/specialists/definitions.js";
import { createWorkspaceInstructions, recomposeWorkspaceInstructions,
  adoptUnmarkedWorkspaceInstructions } from "../../src/setup/workspace-boundary.js";

const roots: string[] = [];
const MANIFEST = ".chat-harness/manifest.yaml";
const WORKSPACE = ".chat-harness/WORKSPACE.md";
const consents = { replaceAgents: false, adoptWorkspace: false };

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(ids: readonly string[] | null = null): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-targets-"));
  roots.push(root);
  if (ids !== null) {
    await mkdir(path.join(root, ".chat-harness/procedures"), { recursive: true });
    await writeFile(path.join(root, "AGENTS.md"), AGENTS_TEMPLATE);
    await writeFile(path.join(root, WORKSPACE), createWorkspaceInstructions(specialistSections(ids)));
    for (const id of ids) for (const proc of SPECIALISTS[id as keyof typeof SPECIALISTS].procedures ?? []) {
      await writeFile(path.join(root, proc.path), proc.content);
    }
    await writeFile(path.join(root, MANIFEST),
      serializeManifest(buildDesiredManifest("0.3.7", AGENTS_TEMPLATE, ids)));
  }
  return root;
}

async function fingerprint(root: string): Promise<string> {
  const items: string[] = [];
  async function walk(dir: string) {
    for (const name of (await readdir(dir)).sort()) {
      const full = path.join(dir, name);
      const stat = await lstat(full);
      const rel = path.relative(root, full);
      if (stat.isDirectory()) { items.push(rel + "/"); await walk(full); }
      else if (stat.isFile()) items.push(rel + "=" +
        createHash("sha256").update(await readFile(full)).digest("hex"));
      else items.push(rel + ":other");
    }
  }
  await walk(root);
  return items.join("\n");
}

async function readOnly(root: string, fn: () => Promise<void>): Promise<void> {
  const before = await fingerprint(root);
  await fn();
  expect(await fingerprint(root)).toBe(before);
}

describe("read-only desired targets and semantic preview", () => {
  test("missing manifest and missing files yield exact-set create preview with explicit none", async () => {
    const root = await fixture();
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, "none");
      expect(snapshot.selectedIds).toEqual([]);
      expect(snapshot.base.manifestState).toBe("missing");
      expect(snapshot.findings).toEqual([]);
      const plan = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.executable).toBe(false);
      expect(plan.operations.map(x => [x.path, x.action, x.expected.kind])).toEqual([
        [WORKSPACE, "create", "absent"],
        ["AGENTS.md", "create", "absent"],
        [MANIFEST, "create", "absent"],
      ]);
      expect(plan.desiredManifest.specialists).toEqual({});
    });
    await expect(inspectReconcileTargets(root, ["unknown"])).rejects.toThrow();
    await expect(inspectReconcileTargets(root, ["shopping", "shopping"])).rejects.toThrow();
  });

  test("clean installed shopping -> none plans recorded exact-digest removal, preserves CRLF suffix", async () => {
    const root = await fixture(["shopping"]);
    const current = (await readFile(path.join(root, WORKSPACE), "utf8"))
      .replace("## Workspace customization\n", "## My local notes\r\nValue\r\n");
    await writeFile(path.join(root, WORKSPACE), current);
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, "none");
      expect(snapshot.findings).toEqual([]);
      const plan = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(plan.safeToPresent).toBe(true);
      expect(plan.operations.filter(x => x.action === "remove").map(x => x.path)).toEqual(
        SPECIALISTS.shopping.procedures!.map(p => p.path).sort());
      const work = plan.operations.find(x => x.path === WORKSPACE)!;
      expect(work.action).toBe("replace");
      expect(work.expected).toEqual({ kind: "exact", digest: exactByteDigest(current) });
      expect(work.afterDigest).toBe(exactByteDigest(recomposeWorkspaceInstructions(current, [])));
      expect(recomposeWorkspaceInstructions(current, [])).toContain("## My local notes\r\nValue\r\n");
      expect(plan.operations.at(-1)?.path).toBe(MANIFEST);
      expect(plan.operations.every(x => x.owner !== "manifest" || x.action !== "remove")).toBe(true);
    });
  });

  test("unmanaged AGENTS and unmarked Workspace require separate explicit consents", async () => {
    const root = await fixture();
    const instructions = "# Existing custom instructions\r\nTake care!\r\n";
    await writeFile(path.join(root, "AGENTS.md"), "Existing root instructions\n");
    await mkdir(path.join(root, ".chat-harness"));
    await writeFile(path.join(root, WORKSPACE), instructions);
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["finance"]);
      expect(snapshot.agents?.containsManagedMarker).toBe(false);
      expect(snapshot.workspaceFile?.containsManagedMarker).toBe(false);
      const noConsent = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(noConsent.safeToPresent).toBe(false);
      expect(noConsent.operations).toEqual([]);
      expect(noConsent.findings.map(x => x.code)).toContain("setup.agents_consent_required");
      expect(noConsent.findings.map(x => x.code)).toContain("setup.workspace_adoption_required");
      const approved = buildReadonlySemanticPreview(snapshot, "0.3.7",
        { replaceAgents: true, adoptWorkspace: true });
      expect(approved.safeToPresent).toBe(true);
      expect(approved.executable).toBe(false);
      expect(approved.operations.find(x => x.path === "AGENTS.md")?.action).toBe("replace");
      const work = approved.operations.find(x => x.path === WORKSPACE)!;
      expect(work.afterDigest).toBe(exactByteDigest(
        adoptUnmarkedWorkspaceInstructions(instructions, specialistSections(["finance"]))));
      expect(adoptUnmarkedWorkspaceInstructions(instructions,
        specialistSections(["finance"]))).toContain("<!-- chat-harness-user: workspace -->" + instructions);
    });
  });

  test("unowned Procedure collisions remain blocked even when file bears managed marker", async () => {
    const root = await fixture();
    const p = SPECIALISTS.shopping.procedures![0]!;
    await mkdir(path.join(root, ".chat-harness/procedures"), { recursive: true });
    await writeFile(path.join(root, p.path), p.content);
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["shopping"]);
      expect(snapshot.unownedProcedures.find(x => x.path === p.path)?.kind).toBe("file");
      expect(snapshot.findings.map(x => x.code)).toContain("setup.unowned_procedure_collision");
      const preview = buildReadonlySemanticPreview(snapshot, "0.3.7",
        { replaceAgents: true, adoptWorkspace: true });
      expect(preview.safeToPresent).toBe(false);
      expect(preview.operations).toEqual([]);
    });
  });

  test("recorded Procedure divergence prohibits even an unrelated change", async () => {
    const root = await fixture(["shopping"]);
    const p = SPECIALISTS.shopping.procedures![0]!;
    await writeFile(path.join(root, p.path),
      "<!-- chat-harness-managed: procedure -->\nlocal customization\n");
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["finance"]);
      expect(snapshot.findings.some(x => x.code === "setup.managed_file_diverged")).toBe(true);
      expect(buildReadonlySemanticPreview(snapshot, "0.3.7", consents).operations).toEqual([]);
    });
  });

  test("pending reconciliation stops all downstream inspection, planning and repairs", async () => {
    const root = await fixture(["shopping"]);
    await mkdir(path.join(root, ".chat-harness/temp/reconcile"), { recursive: true });
    await writeFile(path.join(root, MANIFEST), "tampered!\n");
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["shopping"]);
      expect(snapshot.base.transaction).toBe("pending");
      expect(snapshot.base.manifestState).toBe("not_inspected");
      expect(snapshot.workspaceFile).toBeNull();
      const plan = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(plan.safeToPresent).toBe(false);
      expect(plan.operations).toEqual([]);
    });
  });

  test("malformed Workspace markers and case alias never create a plan", async () => {
    const root = await fixture(["shopping"]);
    await writeFile(path.join(root, WORKSPACE),
      "<!-- chat-harness-managed: workspace -->\n# broken\n");
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["shopping"]);
      const plan = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(plan.findings.map(x => x.code)).toContain("setup.workspace_boundary_invalid");
      expect(plan.operations).toEqual([]);
    });
    await rm(path.join(root, WORKSPACE));
    await writeFile(path.join(root, ".chat-harness/workspace.md"), "# user alias");
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["shopping"]);
      expect(snapshot.findings.map(x => x.code)).toContain("setup.destination_unsafe");
      expect(buildReadonlySemanticPreview(snapshot, "0.3.7", consents).operations).toEqual([]);
    });
  });

  test("valid no-op state and changed release manifest remain deterministic and observational", async () => {
    const root = await fixture(["shopping"]);
    await readOnly(root, async () => {
      const snapshot = await inspectReconcileTargets(root, ["shopping"]);
      expect(snapshot.base.manifestState).toBe("valid");
      expect(snapshot.findings).toEqual([]);
      const same = buildReadonlySemanticPreview(snapshot, "0.3.7", consents);
      expect(same.safeToPresent).toBe(true);
      expect(same.operations.every(x => x.action === "unchanged")).toBe(true);
      expect(same.sameDigestTransactionRequired).toBe(false);
      const upgrade = buildReadonlySemanticPreview(snapshot, "0.3.8", consents);
      expect(upgrade.safeToPresent).toBe(true);
      expect(upgrade.operations.find(x => x.path === MANIFEST)?.action).toBe("replace");
      expect(upgrade.executable).toBe(false);
    });
  });
});
