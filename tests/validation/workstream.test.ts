import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
function document(status: "active" | "parked" | "completed", extra = "", next = true): string {
  return ["---","type: workstream","title: Workstream",`status: ${status}`,"created: 2026-09-24","updated: 2026-09-24",extra,"---","# Workstream","","## Objective","","Complete the objective.","","## Current direction","","Current direction is known.",...(next ? ["","## Next action","","Continue implementation."] : []),""].join("\n");
}

describe("Workstream validation", () => {
  test.each(["active","parked","completed"] as const)("accepts status %s", async (status) => {
    const dir=await root(); const file=path.join(dir,"item.md");
    await writeFile(file,document(status,"",status==="active"));
    expect(await validateWorkstreamFile(file,{workstreamsRoot:dir})).toEqual([]);
  });
  test("active requires Next action while parked/completed do not", async () => {
    const dir=await root(); const active=path.join(dir,"active.md"); const parked=path.join(dir,"parked.md");
    await writeFile(active,document("active","",false)); await writeFile(parked,document("parked","",false));
    expect((await validateWorkstreamFile(active,{workstreamsRoot:dir})).map((f)=>f.code)).toContain("workstream.next_action_missing");
    expect(await validateWorkstreamFile(parked,{workstreamsRoot:dir})).toEqual([]);
  });
  test("rejects missing/unknown fields, invalid dates, and backwards updates", async () => {
    const dir=await root();
    const missing=path.join(dir,"missing.md"); await writeFile(missing,document("active").replace("type: workstream\n",""));
    expect((await validateWorkstreamFile(missing,{workstreamsRoot:dir})).map((f)=>f.code)).toContain("workstream.frontmatter_invalid");
    const unknown=path.join(dir,"unknown.md"); await writeFile(unknown,document("active","owner: someone"));
    expect((await validateWorkstreamFile(unknown,{workstreamsRoot:dir})).map((f)=>f.code)).toContain("workstream.frontmatter_invalid");
    const invalid=path.join(dir,"invalid.md"); await writeFile(invalid,document("active").replaceAll("2026-09-24","2026-02-31"));
    expect((await validateWorkstreamFile(invalid,{workstreamsRoot:dir})).map((f)=>f.code)).toContain("workstream.frontmatter_invalid");
    const backwards=path.join(dir,"backwards.md"); await writeFile(backwards,document("active").replace("updated: 2026-09-24","updated: 2026-09-23"));
    expect((await validateWorkstreamFile(backwards,{workstreamsRoot:dir})).map((f)=>f.message)).toContain("updated must not be earlier than created.");
  });
  test("requires exactly one real H1", async () => {
    const dir=await root(); const file=path.join(dir,"item.md"); await writeFile(file,document("active")+"\n# Second\n");
    expect((await validateWorkstreamFile(file,{workstreamsRoot:dir})).map((f)=>f.code)).toContain("workstream.heading_invalid");
  });
});
