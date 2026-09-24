import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateWorkstreamFile } from "../../src/validation/workstream.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "chat-harness-ws-"));
  roots.push(value);
  return value;
}

function document(status: string, extraFrontmatter = "", next = true): string {
  return [
    "---",
    `status: ${status}`,
    "created: 2026-09-24",
    extraFrontmatter,
    "---",
    "# Workstream",
    "",
    "## Objective",
    "",
    "Complete the objective.",
    "",
    "## Current state",
    "",
    "Current state is known.",
    ...(next ? ["", "## Next action", "", "Continue implementation."] : []),
    "",
  ].join("\n");
}

describe("Workstream validation", () => {
  test.each(["active", "parked", "resolved"])("accepts status %s", async (status) => {
    const dir = await root();
    const file = path.join(dir, "item.md");
    await writeFile(file, document(status, "", status === "active"));
    expect(await validateWorkstreamFile(file, { workstreamsRoot: dir })).toEqual([]);
  });

  test("active requires Next action while parked/resolved do not", async () => {
    const dir = await root();
    const active = path.join(dir, "active.md");
    const parked = path.join(dir, "parked.md");
    await writeFile(active, document("active", "", false));
    await writeFile(parked, document("parked", "", false));

    expect((await validateWorkstreamFile(active, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.next_action_missing");
    expect(await validateWorkstreamFile(parked, { workstreamsRoot: dir })).toEqual([]);
  });

  test("requires exactly one real H1 and ignores headings in fenced code", async () => {
    const dir = await root();
    const file = path.join(dir, "item.md");
    const source = document("active").replace(
      "# Workstream\n",
      ["# Workstream", "", "~~~text", "# fake heading", "## Objective", "~~~", ""].join("\n"),
    );
    await writeFile(file, source);
    expect(await validateWorkstreamFile(file, { workstreamsRoot: dir })).toEqual([]);

    await writeFile(file, source + "\n# Second H1\n");
    expect((await validateWorkstreamFile(file, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.heading_invalid");
  });

  test("rejects duplicate YAML keys, unknown fields, and invalid calendar dates", async () => {
    const dir = await root();
    const duplicate = path.join(dir, "duplicate.md");
    await writeFile(
      duplicate,
      document("active").replace("status: active", "status: active\nstatus: parked"),
    );
    expect((await validateWorkstreamFile(duplicate, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.frontmatter_invalid");

    const unknown = path.join(dir, "unknown.md");
    await writeFile(unknown, document("active", "owner: someone"));
    expect((await validateWorkstreamFile(unknown, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.frontmatter_invalid");

    const date = path.join(dir, "date.md");
    await writeFile(date, document("active").replace("2026-09-24", "2026-02-31"));
    expect((await validateWorkstreamFile(date, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.frontmatter_invalid");
  });

  test("validates supersession target and rejects path escape", async () => {
    const dir = await root();
    const successor = path.join(dir, "successor.md");
    await writeFile(successor, document("active"));
    const old = path.join(dir, "old.md");
    await writeFile(old, document("superseded", "superseded_by: ./successor.md", false));
    expect(await validateWorkstreamFile(old, { workstreamsRoot: dir })).toEqual([]);

    await writeFile(old, document("superseded", "superseded_by: ../outside.md", false));
    expect((await validateWorkstreamFile(old, { workstreamsRoot: dir })).map((f) => f.code))
      .toContain("workstream.supersession_invalid");
  });
});
