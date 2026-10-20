import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_TEMPLATE, CORE_VERSION, WORKSTREAM_TEMPLATE } from "../../src/setup/templates.js";
import { SPECIALIST_IDS, specialistTemplate } from "../../src/setup/specialists.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
describe("canonical templates",()=>{
  test("AGENTS stays synchronized and within Project Instructions budget",async()=>{
    const source=await readFile(path.join(root,"templates","AGENTS.md"),"utf8");
    expect(source).toBe(AGENTS_TEMPLATE);
    expect(CORE_VERSION).toBe(2);
    expect(source).toContain("explicit scoped approval");
    expect(source.length).toBeLessThanOrEqual(8000);
    const classify = source.indexOf("Classify each request as **Answer-only** or **Work**.");
    const workspace = source.indexOf("After classification, read `.chat-harness/WORKSPACE.md`");
    expect(classify).toBeGreaterThanOrEqual(0);
    expect(workspace).toBeGreaterThan(classify);
    expect(source).not.toContain(".chat-harness/README.md");
    expect(source).toContain("resume a same-objective Workstream");
    expect(source).toContain("discovery, not freshness authority");
    expect(source).toContain("never cite/link temp as canonical");
    const persistence = source.split("## Persistence invariants\n")[1]!.split("## Checkpoint and closeout")[0]!;
    expect(persistence).toContain("verified COW backup cleanup");
    const order = ["verify a complete candidate", "re-read canon for concurrent changes", "rename canon to a unique", "promote candidate", "re-read/verify canon", "request any required deletion approval", "delete backup and list to verify absence"];
    for (let i = 1; i < order.length; i++) {
      expect(persistence.indexOf(order[i]!)).toBeGreaterThan(persistence.indexOf(order[i - 1]!));
    }
    expect(persistence).toContain("Never delete the last known-good copy");
    expect(persistence).toContain("Denied, failed or unverified cleanup is persistence failure");
    expect(persistence).toContain("preserve copies, report exact paths/IDs and recovery Next action");
    expect(persistence).toContain("never claim a complete checkpoint");
  });
  test("specialist seeds stay compact",()=>{
    for(const id of SPECIALIST_IDS){
      expect(specialistTemplate(id).length).toBeLessThanOrEqual(3500);
    }
  });
  test("Core explicitly honors read-only Work and CREATE/CLOSE ownership",()=>{
    expect(AGENTS_TEMPLATE).toContain("read-only Work");
    expect(AGENTS_TEMPLATE).toContain("**CREATE**");
    expect(AGENTS_TEMPLATE).toContain("**CLOSE**");
    expect(AGENTS_TEMPLATE).toContain("what changes, where, why");
    expect(AGENTS_TEMPLATE).toContain("Temp files retain Workstream ownership");
  });
  // These assert instruction contracts, not hosted model compliance.
  test("ordinary Work executes persistence before substantive reasoning or a final answer",()=>{
    const lifecycle = AGENTS_TEMPLATE.split("## Work lifecycle\n")[1]!.split("### Workstream")[0]!;
    expect(lifecycle).toMatch(/before substantive (?:domain )?(?:reasoning|analysis).*completed answer/);
    expect(lifecycle).toContain("execute these steps without waiting for a save request");
    expect(lifecycle.indexOf("resume a same-objective Workstream")).toBeLessThan(lifecycle.indexOf("Workbench artifact"));
    expect(AGENTS_TEMPLATE).toContain("Create immediately for each new open-ended Work objective");
  });
  test("design-only restrictions preserve authorized internal Markdown persistence",()=>{
    expect(AGENTS_TEMPLATE).toMatch(/"design only".*"do not implement\/deploy".*"no real external actions"/);
    expect(AGENTS_TEMPLATE).toContain("do not prohibit authorized internal Workspace Markdown");
    expect(AGENTS_TEMPLATE).toContain("Consequential external actions require explicit human approval");
    expect(AGENTS_TEMPLATE).toContain("Never modify **unrelated** Workstreams");
  });
  test("Answer-only and explicitly read-only Work prohibit all Workspace mutations",()=>{
    expect(AGENTS_TEMPLATE).toMatch(/Answer-only and explicitly read-only Work.*without creating or modifying Workstreams, artifacts, temp files or other Workspace state/);
    expect(AGENTS_TEMPLATE).toContain("Folders describe purpose, not mandatory stages. Create on trigger without placeholders");
  });
  test("Core names exact required Workstream sections and resumable Next action",()=>{
    expect(AGENTS_TEMPLATE).toContain("exact H2s: Objective, Current direction, Next action");
    expect(AGENTS_TEMPLATE).toContain("Active Workstreams require a Next action");
  });
  test("Workstream stays synchronized",async()=>{
    expect(await readFile(path.join(root,"templates","workstream.md"),"utf8")).toBe(WORKSTREAM_TEMPLATE);
  });
  test("publishes one frontmatter-first template per Workbench class",async()=>{
    for(const [name,type] of [["idea.md","idea"],["research.md","research"],["design.md","design"],["plan.md","plan"],["review.md","review"]] as const){
      const source=await readFile(path.join(root,"templates","workbench",name),"utf8");
      expect(source.startsWith("---\n")).toBe(true);
      expect(source).toContain(`type: ${type}`);
      expect(source).toContain("status: draft");
      expect(source).toContain("created: YYYY-MM-DD");
      expect(source).toContain("updated: YYYY-MM-DD");
      expect(source).toContain("workstream: .chat-harness/workstreams/");
    }
  });
});
