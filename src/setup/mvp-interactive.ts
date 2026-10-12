import { confirm,intro,isCancel,log,multiselect,note } from "@clack/prompts";
import { CORE_VERSION } from "./templates.js";
import { parseManifest,type WorkspaceManifest } from "./manifest.js";
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
export function wizardInitialSelection(supplied:string|undefined,installed:readonly string[]):string[]{
  const ids=supplied === undefined ? [...installed].sort() : parseSpecialistSelection(supplied);
  return ids.length?ids:["none"];
}
export function renderMvpPlan(plan:CombinedReadonlyPlan,current:WorkspaceManifest|null):string{
  const desired=plan.request?.desiredSpecialists??[];
  const targetOp=plan.operations.at(-1);
  const target=targetOp?.content?parseManifest(targetOp.content):null;
  const lines=[plan.workspace,`Current Specialists: ${Object.keys(current?.specialists??{}).sort().join(", ") || "Core only"}`,
    `Desired Specialists: ${desired.join(", ") || "Core only"}`];
  for(const id of [...new Set([...Object.keys(current?.specialists??{}),...desired])].sort()){
    const previous=current?.specialists[id];
    const included=desired.includes(id as SpecialistId);
    const next=target?.specialists[id]?.version??SPECIALISTS[id as SpecialistId].version;
    if(previous && !included)lines.push(`Remove ${SPECIALISTS[id as SpecialistId].label} (v${previous.version})`);
    else if(!previous && included)lines.push(`Add ${SPECIALISTS[id as SpecialistId].label} (v${next})`);
    else if(previous && previous.version!==next)lines.push(`Update ${SPECIALISTS[id as SpecialistId].label}: v${previous.version} → v${next}`);
  }
  if(current && current.core.version!==CORE_VERSION)lines.push(`Update Core: v${current.core.version} → v${CORE_VERSION}`);
  lines.push(...plan.operations.filter(op=>op.action!=="unchanged").map(op=>`${op.action}: ${op.path}`));
  return lines.join("\n");
}
export async function selectMvpSetup(workspace:string,request:ReconcileSelectionOptions,version:string):Promise<ReconcileSelectionOptions|null>{
  intro("Chat Harness setup");
  const installed=await inspectManifestDisk(workspace);
  if(installed.transaction!=="absent")return request; // Recovery approval occurs separately; don't infer installed selection from partial state.
  let initial:string[];try{initial=wizardInitialSelection(request.specialists,Object.keys(installed.manifest?.specialists??{}));}catch{return request;}
  let specialists:string|undefined;
  while(specialists===undefined){
    const selection=await multiselect({message:"Choose the Specialist guidance for this Workspace",
      options:[{value:"none",label:"General / mixed use — Core only"},...SPECIALIST_IDS.map(id=>({value:id,label:SPECIALISTS[id].label,hint:SPECIALISTS[id].summary}))],
      initialValues:initial,required:false,
    });
    if(isCancel(selection))return null;
    try{specialists=resolveWizardSelection(selection).join(",") || "none";}catch(error){log.warn(String(error));}
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
  note(renderMvpPlan(plan,(await inspectManifestDisk(plan.workspace)).manifest),"Review Workspace changes");
  const answer=await confirm({message:"Apply these Workspace changes?",initialValue:false});
  return !isCancel(answer) && answer;
}
export async function approveMvpRecovery():Promise<boolean>{
  note("An interrupted reconciliation must be verified and recovered before a new setup can be planned. Changed or ambiguous files will be preserved. A fresh setup preview follows recovery.","Pending reconciliation");
  const answer=await confirm({message:"Verify and recover the pending reconciliation?",initialValue:false});
  return !isCancel(answer) && answer;
}
