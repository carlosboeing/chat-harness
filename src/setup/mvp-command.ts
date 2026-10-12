import type { Finding } from "../cli/result.js";
import { inspectAndPlanReadonlyReconciliation,type CombinedReadonlyPlan } from "./readonly-reconcile-plan.js";
import { inspectManifestDisk } from "./inspect-manifest-disk.js";
import { executeManagedReconciliation,recoverManagedReconciliation,ReconciliationError } from "./transaction-engine.js";
import { MacosHelperError } from "../workspace/macos-helper.js";
import { SPECIALISTS } from "../specialists/definitions.js";
import type { ReconcileSelectionOptions } from "./reconcile-request.js";

export interface MvpSetupOptions extends ReconcileSelectionOptions {dryRun:boolean;}
export interface MvpSetupDependencies {
  /** UI approval happens while the plan is still read-only. */
  beforeApply?: (plan: CombinedReadonlyPlan)=>Promise<boolean>;
  beforeRecovery?: ()=>Promise<boolean>;
}
export async function runMvpSetup(workspace: string, options: MvpSetupOptions, version: string, dependencies: MvpSetupDependencies={}) {
  const initial=await inspectManifestDisk(workspace);
  const installed=Object.keys(initial.manifest?.specialists??{}).sort();
  let plan: CombinedReadonlyPlan;
  try {plan=await inspectAndPlanReadonlyReconciliation(workspace,options,version);}
  catch(error) {
    return {result:{state:"user_action_required",current_specialists:installed,desired_specialists:[]},findings:[{
      code:"setup.specialist_unknown",severity:"error" as const,location:"specialists",message:String(error),remediation:"Use supported comma-separated IDs, or 'none' alone."}]};
  }
  const result=(state:string,activePlan=plan)=>({state,current_specialists:installed,
    desired_specialists:activePlan.request?.desiredSpecialists??[],
    specialist_changes:activePlan.request?.desiredSpecialists? [...new Set([...installed,...activePlan.request.desiredSpecialists])].sort().map(id=>({
      id,action:!installed.includes(id)?"add":!activePlan.request!.desiredSpecialists.includes(id as keyof typeof SPECIALISTS)?"remove":
        initial.manifest?.specialists[id]?.version!==SPECIALISTS[id as keyof typeof SPECIALISTS].version?"update":"unchanged",
      current_version:initial.manifest?.specialists[id]?.version??null,
      desired_version:activePlan.request!.desiredSpecialists.includes(id as keyof typeof SPECIALISTS)?SPECIALISTS[id as keyof typeof SPECIALISTS].version:null,
    })):[],
    operations:activePlan.operations.map(({path,owner,action})=>({path,owner,action})),
    ...(["changes_applied","no_changes"].includes(state)?{host_action:"Copy the complete current AGENTS.md into any manual host binding, including ChatGPT Project Instructions. Host activation/currency is not verified by filesystem setup."}:{}),
  });
  const failure=(error:unknown)=>{
    const code=error instanceof ReconciliationError?error.code:error instanceof MacosHelperError?
      error.code==="unsupported"?"setup.platform_unsupported":"setup.native_helper_unavailable":"setup.verification_failed";
    return {result:result("user_action_required"),findings:[...plan.findings,{code,severity:"error" as const,message:String(error),
      remediation:"Preserve Workspace and transaction evidence. Resolve the reported problem before retrying setup."}]};
  };
  if(!options.dryRun && initial.transaction==="pending") {
    if(dependencies.beforeRecovery && !await dependencies.beforeRecovery())return {result:result("cancelled"),findings:[] as Finding[]};
    try {await recoverManagedReconciliation(workspace);plan=await inspectAndPlanReadonlyReconciliation(workspace,options,version);}
    catch(error){return failure(error);}
  }
  if(!plan.safeToPresent)return {result:result("user_action_required"),findings:[...plan.findings]};
  const changes=plan.operations.some(op=>op.action!=="unchanged");
  if(!changes)return {result:result("no_changes"),findings:[...plan.findings]};
  if(options.dryRun)return {result:result("changes_planned"),findings:[...plan.findings]};
  if(dependencies.beforeApply && !await dependencies.beforeApply(plan))return {result:result("cancelled"),findings:[] as Finding[]};
  try {
    const applied=await executeManagedReconciliation(plan);
    return {result:result("changes_applied"),findings:[...plan.findings,...(applied.cleanupPending?[{
      code:"setup.cleanup_pending",severity:"warning" as const,location:".chat-harness/temp",message:"Managed commit was verified; transaction cleanup remains pending.",remediation:"Run setup again to verify and finish cleanup. Read-only commands preserve evidence."}]:[])]};
  }catch(error){return failure(error);}
}
