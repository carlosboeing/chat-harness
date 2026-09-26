import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSetup } from "../../src/setup/command.js";
import { validateWorkspace } from "../../src/validation/workspace.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-validate-"));
  roots.push(root);
  return root;
}

describe("workspace validation", () => {
  test("v0.2 setup with no workstreams is valid", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });
    expect(await validateWorkspace(root)).toEqual([]);
  });

  test("validates workstreams and Source Policy and orders findings deterministically", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });

    await writeFile(
      path.join(root, ".chat-harness", "workstreams", "broken.md"),
      ["---", "type: workstream", "title: Broken", "status: active", "created: 2026-09-24", "updated: 2026-09-24", "---", "# Broken", "", "## Objective", "", "Goal", "", "## Current direction", "", ""].join("\n"),
    );
    await writeFile(
      path.join(root, ".chat-harness", "source-policy.yaml"),
      ["version: 1", "unexpected: true", ""].join("\n"),
    );

    const first = await validateWorkspace(root);
    const second = await validateWorkspace(root);
    expect(second).toEqual(first);
    expect(first.map((finding) => finding.code)).toContain("workstream.next_action_missing");
    expect(first.map((finding) => finding.code)).toContain("source_policy.invalid");
  });

  test("rejects non-Markdown durable artifacts", async () => {
    const root = await workspace();
    await runSetup(root, { dryRun: false });
    await writeFile(
      path.join(root, ".chat-harness", "workbench", "0-ideas", "native-doc.txt"),
      "not markdown\n",
    );
    await writeFile(
      path.join(root, ".chat-harness", "workstreams", "tracker.txt"),
      "not markdown\n",
    );

    const findings = await validateWorkspace(root);
    expect(findings.map((finding) => finding.code)).toContain(
      "workbench.file_extension_invalid",
    );
    expect(findings.map((finding) => finding.code)).toContain(
      "workstream.file_extension_invalid",
    );
  });

  test("missing scaffolding is reported, not repaired", async () => {
    const root = await workspace();
    const findings = await validateWorkspace(root);
    expect(findings.filter((finding) => finding.code === "workspace.required_missing").length).toBe(15);
  });
});
