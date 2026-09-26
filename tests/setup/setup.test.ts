import { afterEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSetup } from "../../src/setup/command.js";
import { inspectWorkspace } from "../../src/workspace/inspect.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-setup-"));
  roots.push(root);
  return root;
}

async function snapshotTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  async function walk(current: string): Promise<void> {
    for (const name of await readdir(current)) {
      const absolute = path.join(current, name);
      const relative = path.relative(root, absolute);
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        result[relative] = "directory";
        await walk(absolute);
      } else if (info.isFile()) {
        result[relative] = await readFile(absolute, "utf8");
      } else if (info.isSymbolicLink()) {
        result[relative] = "symlink";
      }
    }
  }

  await walk(root);
  return result;
}

describe("setup reconciliation", () => {
  test("empty existing directory gets the v0.2 scaffold", async () => {
    const root = await workspace();

    const output = await runSetup(root, { dryRun: false });
    expect(output.result.state).toBe("changes_applied");
    expect(output.result.operations.map((item) => item.path)).toEqual([
      "AGENTS.md",
      "_inbox",
      ".chat-harness",
      ".chat-harness/WORKSPACE.md",
      ".chat-harness/README.md",
      ".chat-harness/source-policy.yaml",
      ".chat-harness/workstreams",
      ".chat-harness/workbench",
      ".chat-harness/workbench/0-ideas",
      ".chat-harness/workbench/1-research",
      ".chat-harness/workbench/2-analysis",
      ".chat-harness/workbench/3-plans",
      ".chat-harness/workbench/4-reviews",
      ".chat-harness/procedures",
      ".chat-harness/temp",
    ]);

    const tree = await snapshotTree(root);
    expect(tree["AGENTS.md"]).toContain("Chat Harness Project Instructions");
    expect(tree[".chat-harness"]).toBe("directory");
    expect(tree[".chat-harness/README.md"]).toContain("# Workspace Map");
    expect(tree[".chat-harness/workstreams"]).toBe("directory");
    expect(tree[".chat-harness/source-policy.yaml"]).toContain("version: 1");
    expect(tree["Knowledge"]).toBeUndefined();
    expect(tree["Research"]).toBeUndefined();
  });

  test("second run is idempotent", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });
    const before = await snapshotTree(root);

    const output = await runSetup(root, { dryRun: false });
    expect(output.result.state).toBe("no_changes");
    expect(output.result.operations).toEqual([]);
    expect(await snapshotTree(root)).toEqual(before);
  });

  test("dry-run and real setup expose identical operations", async () => {
    const root = await workspace();
    const planned = await runSetup(root, { dryRun: true });
    const before = await snapshotTree(root);

    expect(planned.result.state).toBe("changes_planned");
    expect(before).toEqual({});

    const applied = await runSetup(root, { dryRun: false });
    expect(applied.result.state).toBe("changes_applied");
    expect(applied.result.operations).toEqual(planned.result.operations);
  });

  test("brownfield content and custom user-owned files are preserved byte-for-byte", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "Domain"), { recursive: true });
    await writeFile(path.join(root, "Domain", "record.txt"), "domain sentinel\n");
    await writeFile(path.join(root, "AGENTS.md"), "<!-- chat-harness-managed: agents -->\n# stale\n");
    await mkdir(path.join(root, ".chat-harness"));
    await writeFile(
      path.join(root, ".chat-harness", "README.md"),
      "custom workspace map\n",
    );
    const beforeDomain = await readFile(
      path.join(root, "Domain", "record.txt"),
      "utf8",
    );

    const output = await runSetup(root, { dryRun: false });
    expect(output.result.state).toBe("changes_applied");
    expect(output.result.operations.map((item) => item.path)).toContain("AGENTS.md");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toContain(
      "# Chat Harness Project Instructions",
    );
    expect(
      await readFile(path.join(root, ".chat-harness", "README.md"), "utf8"),
    ).toBe("custom workspace map\n");
    expect(
      await readFile(path.join(root, "Domain", "record.txt"), "utf8"),
    ).toBe(beforeDomain);
  });

  test.each([
    "AGENTS.md",
    ".chat-harness",
    ".chat-harness/README.md",
    ".chat-harness/workstreams",
  ])("wrong-type collision at %s requires user action", async (managedPath) => {
    const root = await workspace();
    const target = path.join(root, ...managedPath.split("/"));

    if (managedPath === ".chat-harness") {
      await writeFile(target, "wrong type");
    } else if (managedPath.endsWith("workstreams")) {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "wrong type");
    } else if (managedPath.endsWith("README.md")) {
      await mkdir(path.dirname(target), { recursive: true });
      await mkdir(target);
    } else {
      await mkdir(target);
    }

    const output = await runSetup(root, { dryRun: false });
    expect(output.result.state).toBe("user_action_required");
    expect(output.findings.some((finding) => finding.code === "setup.path_collision")).toBe(true);
  });

  test.each([
    "AGENTS.md",
    ".chat-harness",
    ".chat-harness/README.md",
    ".chat-harness/workstreams",
  ])("symlink at managed path %s is never followed", async (managedPath) => {
    const root = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), "chat-harness-outside-"));
    roots.push(outside);
    const target = path.join(root, ...managedPath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(outside, target);

    const output = await runSetup(root, { dryRun: false });
    expect(output.result.state).toBe("user_action_required");
    expect(output.findings.some((finding) => finding.code === "setup.symlink_collision")).toBe(true);
    expect(await readdir(outside)).toEqual([]);
  });

  test("state change between plan and apply stops without overwrite", async () => {
    const root = await workspace();

    const output = await runSetup(
      root,
      { dryRun: false },
      {
        applyOptions: {
          beforeApply: async () => {
            await writeFile(path.join(root, "AGENTS.md"), "raced content\n");
          },
        },
      },
    );

    expect(output.result.state).toBe("user_action_required");
    expect(output.findings[0]?.code).toBe("setup.stale_plan");
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(
      "raced content\n",
    );
  });

  test("post-apply verification failure is an execution failure", async () => {
    const root = await workspace();

    const output = await runSetup(
      root,
      { dryRun: false },
      {
        applyOptions: {
          inspect: async (workspaceRoot) => {
            const actual = await inspectWorkspace(workspaceRoot);
            return {
              ...actual,
              observations: actual.observations.map((observation) =>
                observation.path === ".chat-harness/workstreams"
                  ? { ...observation, kind: "missing" as const }
                  : observation,
              ),
            };
          },
        },
      },
    );

    expect(output.result.state).toBe("execution_failure");
    expect(output.findings[0]?.code).toBe("setup.verification_failed");
  });

  test("final approval hook can cancel before any mutation", async () => {
    const root = await workspace();

    const output = await runSetup(
      root,
      { dryRun: false },
      { applyOptions: { beforeApply: () => false } },
    );

    expect(output.result.state).toBe("cancelled");
    expect(await readdir(root)).toEqual([]);
  });

});
