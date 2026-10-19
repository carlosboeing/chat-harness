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
    const originalPersistenceBlock = "## Persistence invariants\n\nDurable internal text defaults to raw Markdown. Workstreams and textual Workbench artifacts **must** be `.md` with required YAML and H1; invalid structure is persistence failure.\n\nOn remote storage, write Markdown (`text/markdown`); never substitute a native provider document for convenience. Other formats are allowed only when the artifact requires them.\n\nAfter every Workstream/Workbench write, re-read/list it and verify filename, format/MIME where available, frontmatter/H1, and intended content. If writing or verification fails, report persistence failure; do not claim success.\n\nA checkpoint is complete only when the canonical Workstream reflects the latest durable state and has been re-read successfully. A replacement in chat, `.chat-harness/temp/`, or another artifact does not count.\n\n";
    expect(source).toContain(originalPersistenceBlock);
    const originalBlockIndex = source.indexOf(originalPersistenceBlock);
    const fallbackIndex = source.indexOf("If an authorized in-place replacement fails after a normal retry, and the provider supports create/read/rename/delete, use a copy-on-write fallback: create a complete temporary candidate and verify its content/type/location; re-read the canonical file to detect concurrent changes; rename the canonical file to a unique backup; promote the candidate; re-read and verify the new canonical file; then delete the backup. Never delete the last known-good copy. If promotion or verification fails, restore the backup when possible and report persistence failure. Surface any changed provider file ID or metadata/reference consequences.");
    expect(originalBlockIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThan(originalBlockIndex);
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
