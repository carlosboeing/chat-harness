/** Disposable data fixture materializer, never used by production mutation. */
import { mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
export async function installMvpFixture(root:string,options:{specialists?:string;scaffoldDomain?:boolean}={}){
 const plan=await inspectAndPlanReadonlyReconciliation(root,options,"0.3.7");
 if(!plan.safeToPresent)throw new Error(JSON.stringify(plan.findings));
 for(const op of plan.operations){
  if(op.action==="create_directory")await mkdir(path.join(root,op.path));
  else if(op.action==="create_file")await writeFile(path.join(root,op.path),op.content!);
  else if(op.action!=="unchanged")throw new Error("Fixture expected fresh creation only");
 }
}
