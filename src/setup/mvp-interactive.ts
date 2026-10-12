import { confirm,intro,isCancel,log,multiselect,note } from "@clack/prompts";
import { inspectManifestDisk } from "./inspect-manifest-disk.js";
import { SPECIALISTS,SPECIALIST_IDS,type SpecialistId } from "../specialists/definitions.js";
import { parseSpecialistSelection,type ReconcileSelectionOptions } from "./reconcile-request.js";
import { inspectAndPlanReadonlyReconciliation,type CombinedReadonlyPlan } from "./readonly-reconcile-plan.js";

/** Pure validation also used by the multiselect; general is the empty set. */
export function resolveWizardSelection(values: readonly string[]): SpecialistId[] {
  if(values.includes("none")) {
    if(values.length!==1)throw new Error("General / mixed use must be selected alone.");
    return [];
  }
  return parseSpecialistSelection(values.length?values.join(","):"none");
}
export async function selectMvpSetup(workspace:string,request:ReconcileSelectionOptions,version:string):Promise<ReconcileSelectionOptions|null>{
  intro("Chat Harness setup");
  const installed=await inspectManifestDisk(workspace);
  if(installed.transaction!=="absent")return request; // Recovery approval occurs separately; don't infer installed selection from partial state.
  let specialists=request.specialists;
  if(specialists===undefined){
    const current=Object.keys(installed.manifest?.specialists??{});
    while(specialists===undefined){
    const selection=await multiselect({message:"Choose the Specialist guidance for this Workspace",
      options:[{value:"none",label:"General / mixed use — Core only"},...SPECIALIST_IDS.map(id=>({value:id,label:SPECIALISTS[id].label,hint:SPECIALISTS[id].summary}))],
      initialValues:current.length?current:["none"],required:false,
    });
    if(isCancel(selection))return null;
    try{specialists=resolveWizardSelection(selection).join(",") || "none";}catch(error){log.warn(String(error));}
    }
  }
  let desired:SpecialistId[];try{desired=parseSpecialistSelection(specialists);}catch{return request;}
  let scaffold=request.scaffoldDomain??false;
  const dirs=[...new Set(desired.flatMap(id=>SPECIALISTS[id].scaffold??[]))].sort();
  if(!scaffold && dirs.length){
    note(dirs.join("\n"),"Optional additive starter folders");
    const value=await confirm({message:"Add any missing starter folders?",initialValue:false});
    if(isCancel(value))return null;scaffold=value;
  }
  let resolved={...request,specialists,scaffoldDomain:scaffold};
  const preview=await inspectAndPlanReadonlyReconciliation(workspace,resolved,version);
  for(const [code,key,message] of [
    ["setup.agents_consent_required","replaceAgents","Replace the existing unmanaged AGENTS.md with Core instructions?"],
    ["setup.workspace_adoption_required","adoptWorkspace","Preserve all existing WORKSPACE.md bytes under the user boundary?"],
  ] as const)if(preview.findings.some(f=>f.code===code)){
    const consent=await confirm({message,initialValue:false});if(isCancel(consent))return null;
    if(consent)resolved={...resolved,[key]:true};
  }
  return resolved;
}
export async function approveMvpPlan(plan:CombinedReadonlyPlan):Promise<boolean>{
  note([plan.workspace,...plan.operations.filter(op=>op.action!=="unchanged").map(op=>`${op.action}: ${op.path}`)].join("\n"),"Review Workspace changes");
  const answer=await confirm({message:"Apply these Workspace changes?",initialValue:false});
  return !isCancel(answer) && answer;
}
export async function approveMvpRecovery():Promise<boolean>{
  note("An interrupted reconciliation must be verified and recovered before a new setup can be planned. Changed or ambiguous files will be preserved. A fresh setup preview follows recovery.","Pending reconciliation");
  const answer=await confirm({message:"Verify and recover the pending reconciliation?",initialValue:false});
  return !isCancel(answer) && answer;
}
