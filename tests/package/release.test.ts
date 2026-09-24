import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sha256File } from "../../scripts/checksum.js";
import { validatePackedPaths } from "../../scripts/validate-package.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("release packaging", () => {
  test("computes stable SHA-256 digests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-hash-"));
    roots.push(root);
    const file = path.join(root, "fixture.txt");
    await writeFile(file, "chat-harness\n", "utf8");

    expect(await sha256File(file)).toBe(
      "5f8892a0e58ae12d7198260de06937d75bb848c430d94af1e47a6fba7e68895c",
    );
  });

  test("accepts the intended npm package surface", () => {
    expect(
      validatePackedPaths([
        "package.json",
        "README.md",
        "LICENSE",
        "dist/npm/chat-harness.js",
        "docs/architecture.md",
        "templates/AGENTS.md",
        "schemas/workstream/workstream.schema.json",
      ]),
    ).toEqual([]);
  });

  test("rejects private/runtime-only repository material from npm packages", () => {
    const errors = validatePackedPaths([
      "package.json",
      "README.md",
      "LICENSE",
      "dist/npm/chat-harness.js",
      ".chat-harness/workstreams/private.md",
      "examples/travel-planning/Bookings/confirmed.md",
      "evals/scenarios/v0.1.json",
      "extensions/github/dispatch.ts",
      "capabilities/linkedin-job/handler.ts",
      "tests/setup/setup.test.ts",
      ".github/workflows/ci.yml",
    ]);

    expect(errors.length).toBe(7);
    expect(errors.join("\n")).toContain(".chat-harness/");
    expect(errors.join("\n")).toContain("examples/");
    expect(errors.join("\n")).toContain("evals/");
    expect(errors.join("\n")).toContain("extensions/");
    expect(errors.join("\n")).toContain("capabilities/");
    expect(errors.join("\n")).toContain("tests/");
    expect(errors.join("\n")).toContain(".github/");
  });
});
