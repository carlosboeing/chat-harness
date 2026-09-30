import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS_TEMPLATE, WORKSTREAM_TEMPLATE } from "../../src/setup/templates.js";
import { SPECIALIST_IDS, specialistTemplate } from "../../src/setup/specialists.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
describe("canonical templates",()=>{
  test("AGENTS stays synchronized and within Project Instructions budget",async()=>{
    const source=await readFile(path.join(root,"templates","AGENTS.md"),"utf8");
    expect(source).toBe(AGENTS_TEMPLATE);
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
      expect(source).toContain("workstream: .chat-harness/workstreams/");
    }
  });
});
