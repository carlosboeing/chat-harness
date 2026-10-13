import { expect,test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { compileReadonlyTransactionIntent } from "../../src/setup/compile-transaction-intent.js";
import { executeManagedReconciliation, recoverManagedReconciliation } from "../../src/setup/transaction-engine.js";
import { stageExclusiveMacosJournal } from "../../src/setup/stage-macos-journal.js";
import { invokeMacosSafeMove,invokeMacosSafeStage } from "../../src/workspace/macos-helper.js";
import { exactByteDigest } from "../../src/setup/manifest.js";
import { journalSibling } from "../../src/setup/multifile-journal-contract.js";
import { expectedCompletionMarker } from "../../src/setup/equal-digest-marker.js";

const enabled = ["darwin","linux","win32"].includes(process.platform) && process.env.CHAT_HARNESS_TEST_PACKAGING === "1";
const runtime = {platform:process.platform,arch:process.arch,standalone:false,
 entryPath:path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js"),executablePath:"unused"};
const MANIFEST=".chat-harness/manifest.yaml", TOKEN=".chat-harness/temp/reconcile/commit.token";
const id="0123456789abcdef0123456789abcdef";
function snapshot(root:string): Record<string,string> {
 const result: Record<string,string>={};
 const visit=(dir:string)=>{for(const e of readdirSync(path.join(root,dir),{withFileTypes:true})) {
  const p=dir?dir+"/"+e.name:e.name;
  if(e.isDirectory())visit(p);else result[p]=readFileSync(path.join(root,p)).toString("base64");
 }};visit("");return result;
}
function move(root:string,from:string,to:string,digest:string){
 invokeMacosSafeMove({operation:"move",workspace:root,parent:path.posix.dirname(from),source:path.posix.basename(from),destination:path.posix.basename(to),digest:digest.slice(7)},runtime);
}
function stage(root:string,target:string,content:string){
 invokeMacosSafeStage({workspace:root,parent:path.posix.dirname(target),destination:path.posix.basename(target),digest:exactByteDigest(content).slice(7),content:Buffer.from(content)},runtime);
}
async function fixture(same=false){
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-recovery-")));
 const installed=await inspectAndPlanReadonlyReconciliation(root,{specialists:"shopping"},"0.3.7");
 await executeManagedReconciliation(installed,runtime);
 if(same){const file=path.join(root,".chat-harness/WORKSPACE.md");writeFileSync(file,readFileSync(file,"utf8").replace("# Workspace Instructions","# Workspace Instructions\nNon-authoritative prefix edit"));}
 const before=snapshot(root);
 const plan=await inspectAndPlanReadonlyReconciliation(root,{specialists:same?"shopping":"none"},"0.3.7");
 const intent=compileReadonlyTransactionIntent(plan,id);
 stageExclusiveMacosJournal(root,intent.journal,runtime);
 for(const s of intent.stages)stage(root,s.path,s.content);
 return {root,before,plan,intent};
}

for(const boundary of ["staged","backup-first","promotion-first","all-before-commit","manifest-backed-up","committed"]){
 test.skipIf(!enabled)(`native multi-file recovery at ${boundary}`,async()=>{
  const {root,before,intent}=await fixture();
  try {
   if(boundary!=="staged")for(const [i,op] of intent.journal.operations.entries()){
    if(op.backup)move(root,op.path,op.backup,op.before!);
    if(i===0 && boundary==="backup-first")break;
    if(op.stage)move(root,op.stage,op.path,op.after!);
    if(i===0 && boundary==="promotion-first")break;
   }
   if(boundary==="manifest-backed-up" || boundary==="committed"){
    move(root,MANIFEST,journalSibling(MANIFEST,"backup",id),intent.journal.startingManifest!);
    if(boundary==="committed")move(root,journalSibling(MANIFEST,"stage",id),MANIFEST,intent.journal.targetManifest);
   }
   const recovered=await recoverManagedReconciliation(root,runtime);
   expect(recovered).toBe(boundary==="committed"?"committed":"rolled_back");
   if(boundary!=="committed")expect(snapshot(root)).toEqual(before);
   else {
    expect(existsSync(path.join(root,".chat-harness/procedures/shopping-research-methodology.md"))).toBe(false);
    expect(existsSync(path.join(root,".chat-harness/temp/reconcile"))).toBe(false);
   }
  } finally{rmSync(root,{recursive:true,force:true});}
 },30000);
}

for(const committed of [false,true])test.skipIf(!enabled)(`identical manifest recovery uses atomic token: committed=${committed}`,async()=>{
 const {root,before,intent}=await fixture(true);
 try{
  expect(intent.commitTokenRequired).toBe(true);
  for(const op of intent.journal.operations){if(op.backup)move(root,op.path,op.backup,op.before!);if(op.stage)move(root,op.stage,op.path,op.after!);}
  if(committed){const bytes=expectedCompletionMarker(intent.journal);const stagePath=journalSibling(TOKEN,"stage",id);stage(root,stagePath,bytes);move(root,stagePath,TOKEN,exactByteDigest(bytes));}
  expect(await recoverManagedReconciliation(root,runtime)).toBe(committed?"committed":"rolled_back");
  if(!committed)expect(snapshot(root)).toEqual(before);
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);

for(const poison of ["canonical","stage","backup","journal","unexpected-evidence"]){
 test.skipIf(!enabled)(`native recovery preserves all evidence for ${poison} conflict`,async()=>{
  const {root,intent}=await fixture();
  try{
   const op=intent.journal.operations[0]!;
   if(poison==="backup"){move(root,op.path,op.backup!,op.before!);writeFileSync(path.join(root,op.backup!),"user changed backup");}
   else if(poison==="stage"){const staged=intent.stages[0]!;writeFileSync(path.join(root,staged.path),"changed stage");}
   else if(poison==="journal")writeFileSync(path.join(root,".chat-harness/temp/reconcile/journal.json"),'{"schema":1,"transactionId":"../../escape"}\n');
   else if(poison==="unexpected-evidence")writeFileSync(path.join(root,".chat-harness/temp/reconcile/user.txt"),"keep me");
   else writeFileSync(path.join(root,op.path),"third state user edit");
   const evidence=snapshot(root);
   await expect(recoverManagedReconciliation(root,runtime)).rejects.toThrow();
   expect(snapshot(root)).toEqual(evidence);
  }finally{rmSync(root,{recursive:true,force:true});}
 },30000);
}
