import { constants } from "node:fs";
import { lstat,open } from "node:fs/promises";
import path from "node:path";
import type { Finding } from "../cli/result.js";
import { SPECIALISTS,type SpecialistId } from "../specialists/definitions.js";
/** Local advisory evidence only: never installs a tool or claims host access. */
export async function recommendedCapabilityFindings(workspace:string,selected:readonly SpecialistId[]):Promise<Finding[]>{
 const recommended=[...new Set(selected.flatMap(id=>SPECIALISTS[id].capabilities?.recommended??[]))].sort();
 if(!recommended.length)return [];
 const declared=new Set<string>();
 for(const relative of ["registry.json","extensions/github/registry.json"]){
  try{
   const segments=relative.split("/");let parent=workspace;
   for(const segment of segments.slice(0,-1)){parent=path.join(parent,segment);const state=await lstat(parent);if(!state.isDirectory() || state.isSymbolicLink())throw new Error("Unsafe registry ancestor");}
   const file=path.join(workspace,relative),state=await lstat(file);
   if(!state.isFile() || state.isSymbolicLink() || state.size>1024*1024)continue;
   const handle=await open(file,constants.O_RDONLY | (constants.O_NOFOLLOW??0) | constants.O_NONBLOCK);
   try{
    const bytes=await handle.readFile();if(bytes.length>1024*1024)continue;
    const registry=JSON.parse(bytes.toString("utf8"));
    for(const id of Object.keys(registry.capabilities??{}))declared.add(id);
   }finally{await handle.close();}
  }catch{/* Invalid registries are diagnosed separately; absence is advisory. */}
 }
 return recommended.filter(id=>!declared.has(id)).map(id=>({code:"capability.recommended_missing",severity:"warning",location:id,
  message:"Recommended capability is not verified in a local registry; host-provided availability cannot be inferred locally. Specialist guidance remains usable.",remediation:"Optionally provide the recommended capability through an authorized host integration; it is not a setup dependency."}));
}
