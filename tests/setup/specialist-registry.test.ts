import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SPECIALIST_ASSETS } from "../../src/specialists/embedded-assets.js";
import { SPECIALIST_IDS, SPECIALISTS, composeSpecialistWorkspace, isSpecialistId,
  selectSpecialists, validateSpecialistRegistry } from "../../src/specialists/definitions.js";
import { generateSpecialistAssets } from "../../scripts/generate-specialist-assets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("vNext first-party Specialist registry (unwired to legacy setup)", () => {
  test("has exactly 12 versioned domain IDs, never general, research or none", () => {
    expect([...SPECIALIST_IDS]).toEqual([
      "business", "career", "dev", "education", "finance", "health",
      "home", "legal", "shopping", "tax", "tech", "travel",
    ]);
    expect(Object.keys(SPECIALISTS).sort()).toEqual([...SPECIALIST_IDS]);
    expect(SPECIALIST_IDS.every(id => SPECIALISTS[id].version === 1)).toBe(true);
    for (const sentinel of ["general", "research", "none"]) {
      expect(isSpecialistId(sentinel)).toBe(false);
      expect(() => selectSpecialists([sentinel])).toThrow("Unknown Specialist");
    }
    expect(selectSpecialists([])).toEqual([]);
    expect(composeSpecialistWorkspace([])).not.toContain("## Specialist — ");
    expect(validateSpecialistRegistry()).toEqual([]);
  });

  test("composition is exact, duplicate-free and lexically ordered", () => {
    expect(selectSpecialists(["tax", "career", "finance"]).map(s => s.id))
      .toEqual(["career", "finance", "tax"]);
    expect(() => selectSpecialists(["tax", "tax"])).toThrow("Duplicate Specialist");
    expect(composeSpecialistWorkspace(["tax", "finance"]))
      .toBe(composeSpecialistWorkspace(["finance", "tax"]));
  });

  test("Technology and Software Development route by objective", () => {
    expect(SPECIALISTS.tech.workspaceFragment).toContain("troubleshoot technology");
    expect(SPECIALISTS.dev.workspaceFragment).toContain("Inspect the real repository");
    expect(SPECIALISTS.dev.scaffold).toEqual(["Projects"]);
    expect(SPECIALISTS.tech.scaffold).toBeUndefined();
  });

  test("Shopping owns exact marked Procedures; Career recommendation is optional", () => {
    const paths = SPECIALISTS.shopping.procedures?.map(p => p.path);
    expect(paths).toEqual([
      ".chat-harness/procedures/deal-discovery-and-channel-optimization.md",
      ".chat-harness/procedures/shopping-research-methodology.md",
    ]);
    for (const procedure of SPECIALISTS.shopping.procedures ?? [])
      expect(procedure.content.startsWith("<!-- chat-harness-managed: procedure -->\n")).toBe(true);
    expect(SPECIALISTS.shopping.capabilities).toBeUndefined();
    expect(SPECIALISTS.career.capabilities).toEqual({ recommended: ["linkedin.job.lookup"] });
    expect(SPECIALISTS.career.capabilities?.required).toBeUndefined();
  });

  test("invalid ownership, versions, paths and markers fail validation", () => {
    const shopping = SPECIALISTS.shopping;
    const p = shopping.procedures![0]!;
    const problems = validateSpecialistRegistry([
      shopping,
      { ...SPECIALISTS.finance, procedures: [p], version: 0, scaffold: ["../unsafe"] },
    ]).join("\n");
    expect(problems).toContain("Duplicate Procedure destination");
    expect(problems).toContain("Invalid version");
    expect(problems).toContain("Invalid scaffold path");
    expect(validateSpecialistRegistry([
      { ...shopping, procedures: [{ ...p, content: "# No marker\n", path: "../escape.md" }] },
    ]).join("\n")).toContain("Missing Procedure marker");
  });

  test("embedded release assets match authoritative Markdown byte-for-byte", async () => {
    expect(Object.keys(SPECIALIST_ASSETS).length).toBe(14);
    for (const [relative, embedded] of Object.entries(SPECIALIST_ASSETS)) {
      const source = await readFile(path.join(root, "src", "specialists", "assets", ...relative.split("/")), "utf8");
      expect(embedded).toBe(source);
    }
    const embedded = await readFile(path.join(root, "src", "specialists", "embedded-assets.ts"), "utf8");
    expect(await generateSpecialistAssets()).toBe(embedded);
  });
});
