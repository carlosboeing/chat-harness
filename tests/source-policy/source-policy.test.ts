import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readSourceWithPolicy,
  resolveSourcePolicy,
} from "../../src/source-policy/resolve.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(policy?: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chat-harness-policy-"));
  roots.push(root);
  await mkdir(path.join(root, ".chat-harness"));
  if (policy !== undefined) {
    await writeFile(path.join(root, ".chat-harness", "source-policy.yaml"), policy);
  }
  return root;
}

describe("Source Policy resolution", () => {
  test.each(["public", "personal", "confidential", "restricted"] as const)(
    "resolves default privacy %s",
    async (privacy) => {
      const root = await workspace(
        ["version: 1", "defaults:", `  privacy: ${privacy}`, ""].join("\n"),
      );
      const result = await resolveSourcePolicy(root, "Records/file.pdf");
      expect(result).toEqual({
        state: "resolved",
        privacy,
        matchedBy: "default",
      });
    },
  );

  test("distinguishes absent policy", async () => {
    const root = await workspace();
    const result = await resolveSourcePolicy(root, "Records/file.pdf");
    expect(result.state).toBe("absent");
  });

  test("exact path beats subtree and longest subtree wins", async () => {
    const root = await workspace(
      [
        "version: 1",
        "defaults:",
        "  privacy: personal",
        "rules:",
        '  - match: { path: "Records/**" }',
        "    privacy: confidential",
        '  - match: { path: "Records/Tax/**" }',
        "    privacy: restricted",
        '  - match: { path: "Records/Tax/public.pdf" }',
        "    privacy: public",
        "",
      ].join("\n"),
    );

    const exact = await resolveSourcePolicy(root, "Records/Tax/public.pdf");
    expect(exact.state).toBe("resolved");
    if (exact.state === "resolved") {
      expect(exact.privacy).toBe("public");
      expect(exact.matchedBy).toBe("exact");
    }

    const nested = await resolveSourcePolicy(root, "Records/Tax/private.pdf");
    expect(nested.state).toBe("resolved");
    if (nested.state === "resolved") {
      expect(nested.privacy).toBe("restricted");
      expect(nested.matchedBy).toBe("subtree");
    }
  });

  test("duplicate same-value rule is deterministic; conflicting duplicate fails", async () => {
    const same = await workspace(
      [
        "version: 1",
        "rules:",
        '  - match: { path: "Records/**" }',
        "    privacy: confidential",
        '  - match: { path: "Records/**" }',
        "    privacy: confidential",
        "",
      ].join("\n"),
    );
    const sameResult = await resolveSourcePolicy(same, "Records/file.pdf");
    expect(sameResult.state).toBe("resolved");

    const conflict = await workspace(
      [
        "version: 1",
        "rules:",
        '  - match: { path: "Records/**" }',
        "    privacy: confidential",
        '  - match: { path: "Records/**" }',
        "    privacy: restricted",
        "",
      ].join("\n"),
    );
    const conflictResult = await resolveSourcePolicy(conflict, "Records/file.pdf");
    expect(conflictResult.state).toBe("unavailable");
    if (conflictResult.state === "unavailable") {
      expect(conflictResult.code).toBe("source_policy.rule_conflict");
    }
  });

  test.each([
    "/absolute/path",
    "../escape",
    "a/../b",
    "a\\b",
    "a/*/b",
    "a/**/b",
    "a?b",
  ])("invalid match path %s makes policy unavailable", async (matchPath) => {
    const root = await workspace(
      [
        "version: 1",
        "rules:",
        `  - match: { path: "${matchPath.replaceAll("\\", "\\\\")}" }`,
        "    privacy: restricted",
        "",
      ].join("\n"),
    );
    const result = await resolveSourcePolicy(root, "Records/file.pdf");
    expect(result.state).toBe("unavailable");
  });

  test("unknown fields and unsupported version are unavailable, not absent", async () => {
    const unknown = await workspace(
      ["version: 1", "unexpected: true", ""].join("\n"),
    );
    expect((await resolveSourcePolicy(unknown, "a")).state).toBe("unavailable");

    const version = await workspace("version: 2\n");
    const result = await resolveSourcePolicy(version, "a");
    expect(result.state).toBe("unavailable");
    if (result.state === "unavailable") {
      expect(result.code).toBe("source_policy.unsupported_version");
    }
  });

  test("invalid or unreadable policy fails closed before content callback", async () => {
    const invalid = await workspace("version: [\n");
    let reads = 0;
    const result = await readSourceWithPolicy(invalid, "Records/file.pdf", async () => {
      reads += 1;
      return "secret";
    });
    expect(result.state).toBe("blocked");
    expect(reads).toBe(0);
  });

  test("absent policy permits controlled read without inventing classification", async () => {
    const root = await workspace();
    let reads = 0;
    const result = await readSourceWithPolicy(root, "Records/file.pdf", async () => {
      reads += 1;
      return "content";
    });
    expect(result.state).toBe("read");
    expect(reads).toBe(1);
    if (result.state === "read") {
      expect(result.policy.state).toBe("absent");
    }
  });
});
