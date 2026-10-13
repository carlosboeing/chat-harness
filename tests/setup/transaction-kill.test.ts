import { beforeAll,afterAll,expect,test } from "bun:test";
import { spawn,spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync,mkdirSync,mkdtempSync,realpathSync,rmSync,existsSync,readFileSync,writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWindowsHelper } from "../../scripts/build-windows-helper.js";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { executeManagedReconciliation,recoverManagedReconciliation } from "../../src/setup/transaction-engine.js";

const enabled=["darwin","linux","win32"].includes(process.platform) && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
let scratch="",entry="";
beforeAll(async()=>{
 if(!enabled)return;
 scratch=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-kill-")));
 entry=path.join(scratch,"entry.js");
 const helper=path.join(scratch,"native",process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",`${process.platform}-${process.arch}`,process.platform === "win32" ? "safe-move.exe" : "safe-move");
 mkdirSync(path.dirname(helper),{recursive:true});
 if(process.platform === "win32") {
  const built=path.resolve(import.meta.dir,"../../dist/tests/windows-safe-move.exe");
  await buildWindowsHelper("x64",built,true);copyFileSync(built,helper);
 } else {
 const compiled=spawnSync("cc",["-std=c11","-O2","-Wall","-Wextra","-Werror","-DGATE0_TEST_HOOKS",...(process.platform === "linux" ? ["-Wno-deprecated-declarations","-static"] : []),path.resolve(import.meta.dir,"../../native/macos/gate0-safe-move.c"),...(process.platform === "linux" ? ["-lcrypto","-ldl","-pthread"] : []),"-o",helper],{encoding:"utf8"});
 if(compiled.status!==0)throw new Error(compiled.stderr);
 }
 writeFileSync(helper+".sha256",createHash("sha256").update(readFileSync(helper)).digest("hex")+"  "+path.basename(helper)+"\n");
});
afterAll(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});
const runtime=()=>({platform:process.platform,arch:process.arch,standalone:false,entryPath:entry,executablePath:"unused"});
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
for(const boundary of ["stage-open:journal.json","staged:journal.json","stage-open:.AGENTS.md.chat-harness-stage-","stage-open:.source-policy.yaml.chat-harness-stage-","staged:.AGENTS.md.chat-harness-stage-","moved:AGENTS.md","moved:manifest.yaml","retired:reconcile","discarded:journal.json"]){
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
   const helperPid=Number(readFileSync(signal,"utf8").split("\n")[1]);
   expect(Number.isSafeInteger(helperPid) && helperPid>0).toBe(true);
   const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));
   child.kill("SIGKILL");
   // The synchronous helper is a separate process. Kill it too; otherwise
   // already-buffered stdin may finish a journal after the parent terminates.
   process.kill(helperPid,"SIGKILL");await exited;
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

test.skipIf(!enabled)("parent-only SIGKILL cannot release exclusion while a native backup is still running",async()=>{
 const root=realpathSync(mkdtempSync(path.join(scratch,"parent-only-")));
 await executeManagedReconciliation(await inspectAndPlanReadonlyReconciliation(root,{specialists:"shopping"},"0.3.7"),runtime());
 const original=readFileSync(path.join(root,".chat-harness/WORKSPACE.md"));
 const signal=path.join(scratch,"parent-only-signal");
 const child=spawn(process.execPath,[path.resolve(import.meta.dir,"transaction-worker.ts"),root,entry,"none"],
  {env:{...process.env,GATE0_TEST_BOUNDARY:"pre-move:WORKSPACE.md",GATE0_TEST_BOUNDARY_SIGNAL:signal},stdio:"ignore"});
 try{
  const deadline=Date.now()+20000;while(!existsSync(signal) && Date.now()<deadline)await tick();
  expect(existsSync(signal)).toBe(true);
  const exited=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;
  // Do NOT kill its active native child. Recovery must refuse until that
  // already-started operation completes, even though the CLI parent is dead.
  await expect(recoverManagedReconciliation(root,runtime())).rejects.toThrow("busy");
  expect(existsSync(path.join(root,".chat-harness/temp/reconcile/journal.json"))).toBe(true);
  await new Promise(resolve=>setTimeout(resolve,2200));
  expect(await recoverManagedReconciliation(root,runtime())).toBe("rolled_back");
  expect(readFileSync(path.join(root,".chat-harness/WORKSPACE.md"))).toEqual(original);
 }finally{child.kill("SIGKILL");await new Promise(resolve=>setTimeout(resolve,2200));rmSync(root,{recursive:true,force:true});}
},30000);
