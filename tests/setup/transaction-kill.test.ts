import { beforeAll,afterAll,expect,test } from "bun:test";
import { spawn,spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync,mkdtempSync,realpathSync,rmSync,existsSync,readFileSync,writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { executeManagedReconciliation,recoverManagedReconciliation } from "../../src/setup/transaction-engine.js";

const enabled=process.platform==="darwin" && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
let scratch="",entry="";
beforeAll(()=>{
 if(!enabled)return;
 scratch=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-kill-")));
 entry=path.join(scratch,"entry.js");
 const helper=path.join(scratch,"native/macos",`darwin-${process.arch}`,"safe-move");
 mkdirSync(path.dirname(helper),{recursive:true});
 const compiled=spawnSync("cc",["-std=c11","-O2","-Wall","-Wextra","-Werror","-DGATE0_TEST_HOOKS",path.resolve(import.meta.dir,"../../native/macos/gate0-safe-move.c"),"-o",helper],{encoding:"utf8"});
 if(compiled.status!==0)throw new Error(compiled.stderr);
 writeFileSync(helper+".sha256",createHash("sha256").update(readFileSync(helper)).digest("hex")+"  safe-move\n");
});
afterAll(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});
const runtime=()=>({platform:"darwin",arch:process.arch,standalone:false,entryPath:entry,executablePath:"unused"});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
for(const boundary of ["stage-open:journal.json","staged:journal.json","stage-open:.AGENTS.md.chat-harness-stage-","staged:.AGENTS.md.chat-harness-stage-","moved:AGENTS.md","moved:manifest.yaml","retired:reconcile","discarded:journal.json"]){
 test.skipIf(!enabled)(`real process termination preserves/recoverably resolves ${boundary}`,async()=>{
  const root=realpathSync(mkdtempSync(path.join(scratch,"workspace-")));
  const signal=path.join(scratch,"signal-"+Math.random());
  const user=Buffer.from([0,255,13,10]);writeFileSync(path.join(root,"unmanaged.bin"),user);
  const child=spawn(process.execPath,[path.resolve(import.meta.dir,"transaction-worker.ts"),root,entry,"shopping"],
   {env:{...process.env,GATE0_TEST_BOUNDARY:boundary,GATE0_TEST_BOUNDARY_SIGNAL:signal},stdio:"ignore"});
  try{
   const deadline=Date.now()+20000;
   while(!existsSync(signal) && child.exitCode===null && Date.now()<deadline)await tick();
   expect(existsSync(signal)).toBe(true);
   const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;
   // The currently executing native primitive has at most a two-second test
   // pause; wait for its completion before acquiring the recovery lease.
   await new Promise(resolve=>setTimeout(resolve,2200));
   if(boundary.startsWith("stage-open:")){
    await expect(recoverManagedReconciliation(root,runtime())).rejects.toThrow();
    expect(existsSync(path.join(root,".chat-harness/temp/reconcile"))).toBe(true);
   }else {
    expect(await recoverManagedReconciliation(root,runtime())).toBe(boundary==="discarded:journal.json"?"cleaned":["moved:manifest.yaml","retired:reconcile"].includes(boundary)?"committed":"rolled_back");
    expect(existsSync(path.join(root,".chat-harness/temp/reconcile"))).toBe(false);
   }
   expect(readFileSync(path.join(root,"unmanaged.bin"))).toEqual(user);
  }finally{child.kill("SIGKILL");rmSync(root,{recursive:true,force:true});}
 },30000);
}

test.skipIf(!enabled)("active transaction lease rejects a simultaneous executor",async()=>{
 const root=realpathSync(mkdtempSync(path.join(scratch,"concurrent-")));
 const signal=path.join(scratch,"concurrent-signal");
 const child=spawn(process.execPath,[path.resolve(import.meta.dir,"transaction-worker.ts"),root,entry,"none"],
  {env:{...process.env,GATE0_TEST_BOUNDARY:"staged:journal.json",GATE0_TEST_BOUNDARY_SIGNAL:signal},stdio:"ignore"});
 try{
  const deadline=Date.now()+20000;while(!existsSync(signal) && Date.now()<deadline)await tick();
  expect(existsSync(signal)).toBe(true);
  await expect(recoverManagedReconciliation(root,runtime())).rejects.toThrow("busy");
  const plan=await inspectAndPlanReadonlyReconciliation(root,{},"0.3.7");
  expect(plan.safeToPresent).toBe(false);
 }finally{const done=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await done;await new Promise(resolve=>setTimeout(resolve,2200));rmSync(root,{recursive:true,force:true});}
},30000);
