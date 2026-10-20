import { describe, expect, test } from "bun:test";
import {
  buildDesiredManifest, exactByteDigest, parseManifest, previewManifestChanges,
  serializeManifest, validateManifest,
} from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE, CORE_VERSION } from "../../src/setup/templates.js";
import { SPECIALISTS } from "../../src/specialists/definitions.js";

const desired = (ids: string[] = []) => buildDesiredManifest("0.3.7", AGENTS_TEMPLATE, ids);

describe("pure schema-1 Workspace manifest", () => {
  test("creates exact-byte Core digest, empty Specialist mapping and stable YAML", () => {
    const data = desired();
    expect(data.schema).toBe(1);
    expect(data.core.version).toBe(CORE_VERSION);
    expect(data.core.files["AGENTS.md"].digest).toBe(exactByteDigest(AGENTS_TEMPLATE));
    expect(data.specialists).toEqual({});
    const source = serializeManifest(data);
    expect(source).toContain("specialists: {}");
    expect(parseManifest(source)).toEqual(data);
    expect(serializeManifest(parseManifest(source))).toBe(source);
    expect(exactByteDigest("a")).not.toBe(exactByteDigest("a\n"));
  });

  test("Core v2 wording updates are detected by digest without a manifest migration", () => {
    // Exact bytes of the pre-hardening Core at f70ea949, not a generated expectation.
    const previous = desired();
    previous.core.version = 2;
    previous.core.files["AGENTS.md"].digest = "sha256:62d34da8aeb527710c8552fc5e38ff480a191c53d4591b554035f8aa1cc70759";
    const parsed = parseManifest(serializeManifest(previous));
    const candidate = desired();
    expect(candidate.core.version).toBe(2);
    expect(previewManifestChanges(parsed, candidate)).toEqual([{
      path: "AGENTS.md", owner: "core", action: "replace",
      beforeDigest: previous.core.files["AGENTS.md"].digest,
      afterDigest: candidate.core.files["AGENTS.md"].digest,
    }]);
  });

  test("records lexically ordered component ownership including marked Procedures", () => {
    const first = desired(["shopping", "finance", "career"]);
    expect(Object.keys(first.specialists)).toEqual(["career", "finance", "shopping"]);
    expect(serializeManifest(first)).toBe(serializeManifest(desired(["career", "shopping", "finance"])));
    expect(first.specialists.career?.files).toBeUndefined();
    expect(first.specialists.shopping?.version).toBe(SPECIALISTS.shopping.version);
    const owned = first.specialists.shopping?.files ?? {};
    expect(Object.keys(owned)).toEqual([
      ".chat-harness/procedures/deal-discovery-and-channel-optimization.md",
      ".chat-harness/procedures/shopping-research-methodology.md",
    ]);
    for (const procedure of SPECIALISTS.shopping.procedures ?? []) {
      expect(owned[procedure.path]?.digest).toBe(exactByteDigest(procedure.content));
    }
    expect(serializeManifest(first)).not.toContain("WORKSPACE.md");
    expect(serializeManifest(first)).not.toContain("source-policy");
  });

  test("unknown/future schemas, components, versions and loose fields fail closed", () => {
    const current = desired(["finance"]);
    expect(() => validateManifest({ ...current, schema: 2 })).toThrow();
    expect(() => validateManifest({ ...current, specialists: {
      ...current.specialists, research: { version: 1 },
    } })).toThrow("Unknown installed Specialist");
    expect(() => validateManifest({ ...current, core: {
      ...current.core, version: CORE_VERSION + 1,
    } })).toThrow("Newer-than-bundled");
    expect(() => validateManifest({ ...current, specialists: {
      finance: { version: SPECIALISTS.finance.version + 1 },
    } })).toThrow("Newer-than-bundled");
    expect(() => validateManifest({ ...current, secrets: "no" })).toThrow("Unknown field");
    expect(() => validateManifest({ ...current, specialists: undefined })).toThrow();
  });

  test("bad digests, core ownership and historical unsafe/aliased paths fail closed", () => {
    const current = desired(["shopping"]);
    expect(() => validateManifest({ ...current, core: {
      ...current.core, files: { "AGENTS.md": { digest: "sha256:ABC" } },
    } })).toThrow("Malformed exact-byte");
    expect(() => validateManifest({ ...current, core: {
      ...current.core, files: { "other.md": { digest: exactByteDigest("a") } },
    } })).toThrow("Core schema");
    expect(() => validateManifest({ ...current, specialists: {
      shopping: { version: 1, files: {
        "../outside.md": { digest: exactByteDigest("unsafe") },
      } },
    } })).toThrow();
    expect(() => validateManifest({ ...current, specialists: {
      shopping: { version: 1, files: {
        ".chat-harness/procedures/first.md": { digest: exactByteDigest("a") },
        ".chat-harness/procedures/FIRST.md": { digest: exactByteDigest("b") },
      } },
    } })).toThrow("Duplicate/aliased managed owner");
  });

  test("YAML duplicate keys and aliases are rejected, not silently interpreted", () => {
    const valid = serializeManifest(desired());
    expect(() => parseManifest(valid.replace("schema: 1", "schema: 1\nschema: 1"))).toThrow("Malformed YAML");
    expect(() => parseManifest("schema: 1\nharness: &h {version: 0.3.7}\ncore: *h\nspecialists: {}\n")).toThrow();
    expect(() => parseManifest("schema: 2\n")).toThrow("Unsupported manifest schema");
    expect(() => parseManifest("x".repeat(1024 * 1024 + 1))).toThrow("exceeds 1 MiB");
  });

  test("a pure preview labels operations but cannot authorize filesystem mutation", () => {
    const initial = desired(["shopping"]);
    const changed = desired(["finance"]);
    const planned = previewManifestChanges(initial, changed);
    expect(planned.map(item => [item.path, item.action])).toEqual([
      [".chat-harness/procedures/deal-discovery-and-channel-optimization.md", "remove"],
      [".chat-harness/procedures/shopping-research-methodology.md", "remove"],
      ["AGENTS.md", "unchanged"],
    ]);
    expect(previewManifestChanges(null, desired(["shopping"]))
      .every(item => item.action === "create")).toBe(true);
    expect(previewManifestChanges(initial, initial)
      .every(item => item.action === "unchanged")).toBe(true);
  });

  test("historical (removed) Procedure paths can still be represented safely", () => {
    const current = desired(["shopping"]);
    current.specialists.shopping!.files = {
      ".chat-harness/procedures/retired-but-owned.md": { digest: exactByteDigest("old") },
    };
    const parsed = parseManifest(serializeManifest(current));
    expect(parsed.specialists.shopping?.files?.[".chat-harness/procedures/retired-but-owned.md"])
      .toEqual({ digest: exactByteDigest("old") });
  });

  test("does not mutate provided records or turn a digest into file ownership", () => {
    const current = desired(["shopping"]);
    const before = serializeManifest(current);
    previewManifestChanges(current, desired(["shopping", "finance"]));
    expect(serializeManifest(current)).toBe(before);
    expect(serializeManifest(desired(["shopping"]))).not.toContain("WORKSPACE.md");
  });
});
