import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { inspectManagedDestination } from "../workspace/managed-path-safety.js";
export async function legacyLayoutFindings(workspace:string):Promise<Finding[]>{
 try{
  await inspectManagedDestination(workspace,".chat-harness/workbench","scaffold");
  await lstat(path.join(workspace,".chat-harness/workbench/2-decisions"));
  return [{code:"setup.legacy_workspace_unsupported",severity:"error",location:".chat-harness/workbench/2-decisions",
   message:"Unsupported historical Workbench layout requires explicit one-time migration; setup does not reorganize it.",remediation:"Review and migrate historical ownership/taxonomy outside ordinary setup."}];
 }catch(error){
  if((error as NodeJS.ErrnoException).code==="ENOENT")return [];
  return [{code:"setup.managed_path_unsafe",severity:"error",location:".chat-harness/workbench",message:String(error),remediation:"Resolve unsafe ancestors without deleting user files."}];
 }
}
