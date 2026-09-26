import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_TEMPLATE, WORKSTREAM_TEMPLATE } from "../../src/setup/templates.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
describe("canonical templates",()=>{
  test("AGENTS stays synchronized and within Project Instructions budget",async()=>{
    const source=await readFile(path.join(root,"templates","AGENTS.md"),"utf8");
    expect(source).toBe(AGENTS_TEMPLATE);
    expect(source.length).toBeLessThanOrEqual(7500);
  });
  test("Workstream stays synchronized",async()=>{
    expect(await readFile(path.join(root,"templates","workstream.md"),"utf8")).toBe(WORKSTREAM_TEMPLATE);
  });
  test("publishes one frontmatter-first template per Workbench class",async()=>{
    for(const [name,type] of [["idea.md","idea"],["research.md","research"],["decision.md","decision"],["plan.md","plan"],["review.md","review"]] as const){
      const source=await readFile(path.join(root,"templates","workbench",name),"utf8");
      expect(source.startsWith("---\n")).toBe(true);
      expect(source).toContain(`type: ${type}`);
      expect(source).toContain("status: draft");
      expect(source).toContain("created: YYYY-MM-DD");
      expect(source).toContain("updated: YYYY-MM-DD");
      expect(source).toContain("workstream: ../../workstreams/");
    }
  });
});
