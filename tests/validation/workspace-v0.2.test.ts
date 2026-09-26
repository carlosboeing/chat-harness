import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSetup } from "../../src/setup/command.js";
import { validateWorkspace } from "../../src/validation/workspace.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-v02-validation-"));
  roots.push(root);
  return root;
}

describe("v0.2 workspace validation", () => {
  test("requires the complete v0.2 scaffold", async () => {
    const root = await workspace();
    const findings = await validateWorkspace(root);
    expect(findings.filter((finding) => finding.code === "workspace.required_missing").length).toBe(15);
  });

  test("ignores obsolete v0.1 lifecycle content", async () => {
    const root = await workspace();
    await runSetup(root, {
      dryRun: false,
      specialist: "general",
      scaffoldDomain: false,
      replaceAgents: false,
      replaceWorkspace: false,
    });

    const lifecycle = path.join(root, ".chat-harness", "lifecycle", "2-design");
    await mkdir(lifecycle, { recursive: true });
    await writeFile(path.join(lifecycle, "legacy.md"), "not valid lifecycle metadata\n");

    expect(await validateWorkspace(root)).toEqual([]);
  });

  test("validates the v0.2 Workstream current-direction contract", async () => {
    const root = await workspace();
    await runSetup(root, {
      dryRun: false,
      specialist: "general",
      scaffoldDomain: false,
      replaceAgents: false,
      replaceWorkspace: false,
    });

    await writeFile(
      path.join(root, ".chat-harness", "workstreams", "broken.md"),
      [
        "---",
        "type: workstream",
        "title: Broken",
        "status: active",
        "created: 2026-09-26",
        "updated: 2026-09-26",
        "---",
        "# Broken",
        "",
        "## Objective",
        "",
        "Goal",
        "",
        "## Current state",
        "",
        "Old v0.1 section name",
        "",
        "## Next action",
        "",
        "Continue.",
        "",
      ].join("\n"),
    );

    const findings = await validateWorkspace(root);
    expect(findings.map((finding) => finding.code)).toContain("workstream.heading_invalid");
  });
});
