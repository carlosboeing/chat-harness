import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectManifestDisk } from "../../src/setup/inspect-manifest-disk.js";
import { buildDesiredManifest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE } from "../../src/setup/templates.js";
import { SPECIALISTS } from "../../src/specialists/definitions.js";

const roots: string[] = [];
const manifestPath = ".chat-harness/manifest.yaml";

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(selected: readonly string[] = []): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "harness-inspection-"));
  roots.push(root);
  await mkdir(path.join(root, ".chat-harness", "temp"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), AGENTS_TEMPLATE);
  for (const id of selected) {
    for (const procedure of SPECIALISTS[id as keyof typeof SPECIALISTS].procedures ?? []) {
      const destination = path.join(root, procedure.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, procedure.content);
    }
  }
  await writeFile(path.join(root, manifestPath),
    serializeManifest(buildDesiredManifest("0.3.7", AGENTS_TEMPLATE, selected)));
  return root;
}

async function tree(root: string): Promise<string> {
  const results: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of (await readdir(directory)).sort()) {
      const absolute = path.join(directory, entry);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) results.push(relative + " -> " + await readlink(absolute));
      else if (stat.isDirectory()) { results.push(relative + "/"); await walk(absolute); }
      else if (stat.isFile()) {
        const data = await readFile(absolute);
        results.push(relative + "=" + createHash("sha256").update(data).digest("hex"));
      } else results.push(relative + ":other");
    }
  }
  await walk(root);
  return results.join("\n");
}

async function unchanged(root: string, check: () => Promise<void>): Promise<void> {
  const before = await tree(root);
  await check();
  expect(await tree(root)).toBe(before);
}

describe("read-only on-disk manifest-backed inspection", () => {
  test("fresh Workspace has no manifest ownership, creates nothing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "harness-empty-"));
    roots.push(root);
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.transaction).toBe("absent");
      expect(observed.manifestState).toBe("missing");
      expect(observed.files).toEqual([]);
      expect(observed.findings).toEqual([]);
    });
  });

  test("records exact-byte Core and Specialist ownership without inventing ownership for scaffold", async () => {
    const root = await fixture(["shopping", "finance"]);
    await mkdir(path.join(root, "Purchases"));
    await writeFile(path.join(root, "Purchases", "personal.txt"), "my own file\n");
    await unchanged(root, async () => {
      const inspection = await inspectManifestDisk(root);
      expect(inspection.manifestState).toBe("valid");
      expect(inspection.transaction).toBe("absent");
      expect(inspection.files.map(x => [x.path, x.owner, x.state])).toEqual([
        [".chat-harness/procedures/deal-discovery-and-channel-optimization.md", "shopping", "clean"],
        [".chat-harness/procedures/shopping-research-methodology.md", "shopping", "clean"],
        ["AGENTS.md", "core", "clean"],
      ]);
      expect(inspection.files.every(x => x.actualDigest === x.recordedDigest)).toBe(true);
      expect(inspection.findings).toEqual([]);
      expect(inspection.manifest?.specialists.finance?.version).toBe(1);
      expect(inspection.files.some(x => x.path.includes("Purchases"))).toBe(false);
    });
  });

  test("pending reconciliation is inspected FIRST; does not parse invalid manifest or follow pending journal", async () => {
    const root = await fixture(["shopping"]);
    await writeFile(path.join(root, manifestPath), "malformed: [");
    await mkdir(path.join(root, ".chat-harness/temp/reconcile"));
    await writeFile(path.join(root, ".chat-harness/temp/reconcile/journal.json"), "{unknown}");
    await unchanged(root, async () => {
      const result = await inspectManifestDisk(root);
      expect(result.transaction).toBe("pending");
      expect(result.manifestState).toBe("not_inspected");
      expect(result.manifest).toBeNull();
      expect(result.files).toEqual([]);
      expect(result.findings.map(f => f.code)).toEqual(["setup.recovery_required"]);
    });
  });

  test("symlinked reconciliation directory fails closed before manifest reads", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "harness-outside-"));
    roots.push(outside);
    await writeFile(path.join(outside, "journal.json"), "untrusted");
    await symlink(outside, path.join(root, ".chat-harness/temp/reconcile"), process.platform === "win32" ? "junction" : "dir");
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.transaction).toBe("unsafe");
      expect(observed.manifestState).toBe("not_inspected");
      expect(observed.findings[0]?.code).toBe("setup.recovery_conflict");
    });
    expect(await readFile(path.join(outside, "journal.json"), "utf8")).toBe("untrusted");
  });

  test("untrusted manifest structure/path cannot trigger historical file traversal", async () => {
    const root = await fixture(["shopping"]);
    let source = await readFile(path.join(root, manifestPath), "utf8");
    source = source.replace(".chat-harness/procedures/shopping-research-methodology.md", "../outside-secret.md");
    await writeFile(path.join(root, manifestPath), source);
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.manifestState).toBe("invalid");
      expect(observed.files).toEqual([]);
      expect(observed.findings[0]?.code).toBe("setup.manifest_invalid");
    });
  });

  test("records drift, missing and unmarked files without granting overwrite permission", async () => {
    const root = await fixture(["shopping"]);
    const procedures = SPECIALISTS.shopping.procedures!;
    await rm(path.join(root, procedures[0]!.path));
    await writeFile(path.join(root, procedures[1]!.path),
      "<!-- chat-harness-managed: procedure -->\nuser edit\n");
    await writeFile(path.join(root, "AGENTS.md"), "other project instructions");
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.files.map(f => f.state)).toEqual(["missing", "diverged", "wrong_marker"]);
      expect(observed.findings.map(f => f.code)).toEqual([
        "setup.managed_file_missing", "setup.managed_file_diverged", "setup.managed_marker_invalid",
      ]);
      expect(observed.files[1]?.actualDigest).not.toBe(observed.files[1]?.recordedDigest);
    });
  });

  test("wrong types, symlinked parents and case/Unicode aliases remain hard conflicts", async () => {
    const root = await fixture(["shopping"]);
    const procedures = path.join(root, ".chat-harness/procedures");
    const scratch = await mkdtemp(path.join(os.tmpdir(), "harness-procedures-"));
    roots.push(scratch);
    await rm(procedures, { recursive: true });
    await symlink(scratch, procedures, process.platform === "win32" ? "junction" : "dir");
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.files.map(f => f.state)).toEqual(["unsafe", "unsafe", "clean"]);
      expect(observed.findings.some(f => f.code === "setup.managed_path_unsafe")).toBe(true);
    });
    await rm(procedures);
    await mkdir(procedures);
    const p = SPECIALISTS.shopping.procedures![0]!.path;
    await writeFile(path.join(root, p).replace(".md", ".MD"), "collision");
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.files[0]?.state).toBe("unsafe");
    });
    await rm(path.join(root, p).replace(".md", ".MD"));
    await mkdir(path.join(root, p));
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.files[0]?.state).toBe("wrong_type");
      expect(observed.findings.some(f => f.code === "setup.managed_file_type")).toBe(true);
    });
  });

  test("existing manifest symlink is not followed", async () => {
    const root = await fixture();
    const outside = await mkdtemp(path.join(os.tmpdir(), "harness-external-manifest-"));
    roots.push(outside);
    const external = path.join(outside, "secret.yaml");
    await writeFile(external, "secret");
    await rm(path.join(root, manifestPath));
    await symlink(external, path.join(root, manifestPath));
    await unchanged(root, async () => {
      const observed = await inspectManifestDisk(root);
      expect(observed.manifestState).toBe("unsafe");
      expect(observed.manifest).toBeNull();
      expect(observed.files).toEqual([]);
    });
    expect(await readFile(external, "utf8")).toBe("secret");
  });
});
