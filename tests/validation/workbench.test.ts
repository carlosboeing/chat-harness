import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateWorkbenchFile, type WorkbenchArtifactType } from "../../src/validation/workbench.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root)=>rm(root,{recursive:true,force:true}))); });
async function fixture() {
  const root=await mkdtemp(path.join(os.tmpdir(),"chat-harness-wb-")); roots.push(root);
  const workbenchRoot=path.join(root,"workbench"); const workstreamsRoot=path.join(root,"workstreams");
  await mkdir(workbenchRoot); await mkdir(workstreamsRoot);
  await writeFile(path.join(workstreamsRoot,"owner.md"),["---","type: workstream","title: Owner","status: active","created: 2026-09-24","updated: 2026-09-24","---","# Owner","","## Objective","","Own artifact.","","## Current direction","","Continue.","","## Next action","","Validate.",""].join("\n"));
  return {workbenchRoot,workstreamsRoot};
}
function document(type: WorkbenchArtifactType,status="draft",extra="") {
  return ["---",`type: ${type}`,"title: Artifact",`status: ${status}`,"created: 2026-09-24","updated: 2026-09-24","workstream: ../../workstreams/owner.md",extra,"---","# Artifact","","Durable content.",""].join("\n");
}
async function artifact(state: Awaited<ReturnType<typeof fixture>>,dir:string,source:string,name="artifact.md") {
  const root=path.join(state.workbenchRoot,dir); await mkdir(root,{recursive:true}); const file=path.join(root,name); await writeFile(file,source); return file;
}

describe("Workbench validation", () => {
  test.each([["0-ideas","idea"],["1-research","research"],["2-decisions","decision"],["3-plans","plan"],["4-reviews","review"]] as const)("accepts %s with type %s",async(dir,type)=>{
    const state=await fixture(); const file=await artifact(state,dir,document(type));
    expect(await validateWorkbenchFile(file,{...state,expectedType:type})).toEqual([]);
  });
  test.each(["draft","approved","completed"] as const)("accepts status %s",async(status)=>{
    const state=await fixture(); const file=await artifact(state,"1-research",document("research",status));
    expect(await validateWorkbenchFile(file,{...state,expectedType:"research"})).toEqual([]);
  });
  test("enforces folder/type and owning Workstream",async()=>{
    const state=await fixture(); const file=await artifact(state,"1-research",document("decision").replace("owner.md","missing.md"));
    const findings=await validateWorkbenchFile(file,{...state,expectedType:"research"});
    expect(findings.map((f)=>f.code)).toContain("workbench.type_mismatch");
    expect(findings.map((f)=>f.code)).toContain("workbench.workstream_invalid");
  });
  test("superseded requires an existing replacement",async()=>{
    const state=await fixture(); await artifact(state,"3-plans",document("plan"),"replacement.md");
    const old=await artifact(state,"3-plans",document("plan","superseded","superseded_by: ./replacement.md"),"old.md");
    expect(await validateWorkbenchFile(old,{...state,expectedType:"plan"})).toEqual([]);
    await writeFile(old,document("plan","superseded","superseded_by: ../../outside.md"));
    expect((await validateWorkbenchFile(old,{...state,expectedType:"plan"})).map((f)=>f.code)).toContain("workbench.supersession_invalid");
  });
  test("rejects backwards dates and missing required frontmatter",async()=>{
    const state=await fixture(); const file=await artifact(state,"4-reviews",document("review").replace("updated: 2026-09-24","updated: 2026-09-23").replace("workstream: ../../workstreams/owner.md\n",""));
    const findings=await validateWorkbenchFile(file,{...state,expectedType:"review"});
    expect(findings.map((f)=>f.code)).toContain("workbench.frontmatter_invalid");
    expect(findings.map((f)=>f.message)).toContain("updated must not be earlier than created.");
  });
});
