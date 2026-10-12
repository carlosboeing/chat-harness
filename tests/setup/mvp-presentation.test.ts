import { expect,test } from "bun:test";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installMvpFixture } from "../helpers/mvp-workspace.js";
import { inspectManifestDisk } from "../../src/setup/inspect-manifest-disk.js";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { renderMvpPlan,wizardInitialSelection } from "../../src/setup/mvp-interactive.js";
import { CORE_VERSION } from "../../src/setup/templates.js";

test("approval names a deselected bundle without Procedures and an independent Core version update",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"harness-preview-"));
 try{
  await installMvpFixture(root,{specialists:"tax,finance"});
  const current=(await inspectManifestDisk(root)).manifest!;
  current.core.version=CORE_VERSION-1;
  const plan=await inspectAndPlanReadonlyReconciliation(root,{specialists:"tax"},"0.3.7");
  const preview=renderMvpPlan(plan,current);
  expect(preview).toContain("Remove Finance (v1)");
  expect(preview).toContain(`Update Core: v${CORE_VERSION-1} → v${CORE_VERSION}`);
  expect(preview).toContain("Desired Specialists: tax");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("supplied exact IDs prepopulate the interactive multiselect",()=>{
 expect(wizardInitialSelection(" tax,shopping,tax ",["career"])).toEqual(["shopping","tax"]);
 expect(wizardInitialSelection(undefined,["career","tax"])).toEqual(["career","tax"]);
 expect(wizardInitialSelection("none",["career"])).toEqual(["none"]);
});
