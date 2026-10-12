import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileReadonlyTransactionIntent } from "../../src/setup/compile-transaction-intent.js";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { buildDesiredManifest, exactByteDigest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE } from "../../src/setup/templates.js";
import { createWorkspaceInstructions } from "../../src/setup/workspace-boundary.js";
import { SPECIALISTS, specialistSections } from "../../src/specialists/definitions.js";

const ID="abcdef0123456789";
const roots:string[]=[];
afterEach(async()=>await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true}))));
async function fixture(ids:readonly string[]|null=null):Promise<string>{
  const root=await mkdtemp(path.join(os.tmpdir(),"harness-transaction-intent-"));roots.push(root);
  if(ids!==null){
    await mkdir(path.join(root,".chat-harness/procedures"),{recursive:true});
    await writeFile(path.join(root,"AGENTS.md"),AGENTS_TEMPLATE);
    await writeFile(path.join(root,".chat-harness/WORKSPACE.md"),
      createWorkspaceInstructions(specialistSections(ids)));
    for(const id of ids)for(const p of SPECIALISTS[id as keyof typeof SPECIALISTS].procedures??[]){
      await writeFile(path.join(root,p.path),p.content);
    }
    await writeFile(path.join(root,".chat-harness/manifest.yaml"),
      serializeManifest(buildDesiredManifest("0.3.7",AGENTS_TEMPLATE,ids)));
  }
  return root;
}
describe("pure transaction-intent compiler",()=>{
  test("fresh shopping plan has exact manifest-last stage and no scaffold ownership",async()=>{
    const root=await fixture(),before=await readdir(root);
    const plan=await inspectAndPlanReadonlyReconciliation(root,{specialists:"shopping",scaffoldDomain:true},"0.3.7");
    expect(plan.safeToPresent).toBe(true);
    const compiled=compileReadonlyTransactionIntent(plan,ID);
    expect(compiled.executable).toBe(false);
    expect(compiled.journal.startingManifest).toBeNull();
    expect(compiled.journal.operations.map(o=>o.action)).toEqual(
      expect.arrayContaining(["create"]));
    expect(compiled.journal.operations.some(o=>o.path.includes("source-policy"))).toBe(false);
    expect(compiled.stages.find(s=>s.path.includes("source-policy"))).toBeUndefined();
    expect(compiled.stages.some(s=>s.path.startsWith(".chat-harness/.manifest.yaml."))).toBe(true);
    expect(compiled.stages.every(s=>exactByteDigest(s.content)===s.digest)).toBe(true);
    expect(compiled.commitTokenRequired).toBe(false);
    expect(await readdir(root)).toEqual(before);
  });
  test("same-digest Workspace-only update requires distinct commit indication",async()=>{
    const root=await fixture(["finance"]),target=path.join(root,".chat-harness/WORKSPACE.md");
    await writeFile(target,(await readFile(target,"utf8")).replace("# Workspace Instructions","# Local managed title"));
    const before=await readFile(target);
    const plan=await inspectAndPlanReadonlyReconciliation(root,{},"0.3.7");
    expect(plan.sameDigestTransactionRequired).toBe(true);
    const compiled=compileReadonlyTransactionIntent(plan,ID);
    expect(compiled.journal.startingManifest).toBe(compiled.journal.targetManifest);
    expect(compiled.commitTokenRequired).toBe(true);
    expect(compiled.journal.operations).toHaveLength(1);
    expect(compiled.journal.operations[0]?.path).toBe(".chat-harness/WORKSPACE.md");
    expect(compiled.stages).toHaveLength(1);
    expect(await readFile(target)).toEqual(before);
  });
  test("manifest-backed Specialist removal journal records exact before digest, no after stage",async()=>{
    const root=await fixture(["shopping"]);
    const plan=await inspectAndPlanReadonlyReconciliation(root,{specialists:"none"},"0.3.7");
    expect(plan.safeToPresent).toBe(true);
    const compiled=compileReadonlyTransactionIntent(plan,ID);
    const removals=compiled.journal.operations.filter(o=>o.action==="remove");
    expect(removals).toHaveLength(SPECIALISTS.shopping.procedures!.length);
    expect(removals.every(o=>o.before!==null&&o.after===null&&o.stage===null&&o.backup!==null)).toBe(true);
    expect(compiled.stages.some(s=>s.path.includes("shopping-research-methodology"))).toBe(false);
  });
  test("tampered render or transaction ID cannot become a journal",async()=>{
    const root=await fixture();
    const valid=await inspectAndPlanReadonlyReconciliation(root,{},"0.3.7");
    expect(()=>compileReadonlyTransactionIntent({...valid,safeToPresent:false},ID)).toThrow();
    expect(()=>compileReadonlyTransactionIntent(valid,"../unsafe")).toThrow();
    const ops=valid.operations.map(o=>o.path==="AGENTS.md"?{...o,content:"tampered"}:o);
    expect(()=>compileReadonlyTransactionIntent({...valid,operations:ops},ID)).toThrow();
  });
});
