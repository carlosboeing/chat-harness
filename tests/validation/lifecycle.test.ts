import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateLifecycleFile } from "../../src/validation/lifecycle.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function lifecycle(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-lifecycle-"));
  roots.push(root);
  return root;
}

function artifact(type: string, status = "approved", extra = ""): string {
  return ["---", `type: ${type}`, `status: ${status}`, "created: 2026-09-24", extra, "---", "# Artifact", ""].join("\n");
}

describe("lifecycle validation", () => {
  test.each([
    ["0-brainstorms", "brainstorm"],
    ["1-discovery", "discovery"],
    ["2-design", "design"],
    ["3-plans", "plan"],
    ["4-reviews", "review"],
    ["4-reviews", "retro"],
    ["4-reviews", "audit"],
  ])("accepts %s / %s mapping", async (folder, type) => {
    const root = await lifecycle();
    const dir = path.join(root, folder);
    await mkdir(dir);
    const file = path.join(dir, "item.md");
    await writeFile(file, artifact(type));
    expect(await validateLifecycleFile(file, root)).toEqual([]);
  });

  test("rejects folder/type mismatch", async () => {
    const root = await lifecycle();
    const dir = path.join(root, "2-design");
    await mkdir(dir);
    const file = path.join(dir, "item.md");
    await writeFile(file, artifact("plan"));
    expect((await validateLifecycleFile(file, root)).map((f) => f.code))
      .toContain("lifecycle.folder_type_mismatch");
  });

  test("superseded target must remain in lifecycle and be valid", async () => {
    const root = await lifecycle();
    const dir = path.join(root, "2-design");
    await mkdir(dir);
    const next = path.join(dir, "next.md");
    await writeFile(next, artifact("design"));
    const old = path.join(dir, "old.md");
    await writeFile(old, artifact("design", "superseded", "superseded_by: ./next.md"));
    expect(await validateLifecycleFile(old, root)).toEqual([]);

    await writeFile(old, artifact("design", "superseded", "superseded_by: ../../outside.md"));
    expect((await validateLifecycleFile(old, root)).map((f) => f.code))
      .toContain("lifecycle.supersession_invalid");
  });
});
