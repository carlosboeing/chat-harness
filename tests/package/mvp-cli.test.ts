import { expect,test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync,readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync,realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SPECIALIST_IDS } from "../../src/specialists/definitions.js";

const enabled=["darwin","linux"].includes(process.platform) && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
const npmCli=path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js");
const binary=path.resolve(import.meta.dir,`../../dist/bin/chat-harness-${process.platform}-${process.arch}`);
function tree(root:string){
 const result:Record<string,string>={};
 function visit(dir:string){for(const file of readdirSync(path.join(root,dir),{withFileTypes:true})){
  const p=dir?dir+"/"+file.name:file.name;
  if(file.isDirectory()){result[p]="directory";visit(p);}else result[p]=readFileSync(path.join(root,p)).toString("base64");
 }}visit("");return result;
}
for(const distribution of ["node","standalone"] as const)test.skipIf(!enabled)(`${distribution}: all Specialists, exact removal, brownfield bytes and read-only pending recovery`,()=>{
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-package-v1-")));
 const node=spawnSync("node",["-p","process.execPath"],{encoding:"utf8"}).stdout.trim();
 const executable=distribution==="node"?node:binary;
 const prefix=distribution==="node"?[npmCli]:[];
 function invoke(args:string[],expected=0){
  const run=spawnSync(executable,[...prefix,...args,"--json"],{cwd:root,env:{...process.env,PATH:""},encoding:"utf8",timeout:20000});
  expect(run.error).toBeUndefined();expect(run.status).toBe(expected);
  return JSON.parse(run.stdout);
 }
 try{
  const agents="Unmanaged user instructions\r\n";
  const workspace="\ufeff# User instructions\r\nExact bytes, including BOM.\r\n";
  mkdirSync(path.join(root,".chat-harness"));writeFileSync(path.join(root,"AGENTS.md"),agents);
  writeFileSync(path.join(root,".chat-harness/WORKSPACE.md"),workspace);
  const before=tree(root);
  expect(invoke(["setup","--specialists",SPECIALIST_IDS.join(",")],1).result.state).toBe("user_action_required");
  expect(tree(root)).toEqual(before);
  const configured=invoke(["setup","--specialists",SPECIALIST_IDS.join(","),"--scaffold-domain","--replace-agents","--adopt-workspace"]);
  expect(configured.result.state).toBe("changes_applied");
  expect(configured.result.desired_specialists).toEqual([...SPECIALIST_IDS]);
  expect(readFileSync(path.join(root,".chat-harness/WORKSPACE.md"),"utf8").endsWith(workspace)).toBe(true);
  const policy=path.join(root,".chat-harness/source-policy.yaml");
  const originalPolicy=readFileSync(policy);writeFileSync(policy,Buffer.concat([originalPolicy,Buffer.from("\n# user policy suffix\r\n")]));
  const keptPolicy=readFileSync(policy);
  expect(invoke(["setup"]).result.state).toBe("no_changes");
  expect(invoke(["setup","--specialists","none"]).result.state).toBe("changes_applied");
  expect(readFileSync(policy)).toEqual(keptPolicy);
  expect(readFileSync(path.join(root,".chat-harness/WORKSPACE.md"),"utf8").endsWith(workspace)).toBe(true);
  expect(invoke(["validate"]).result.state).toBe("valid");
  mkdirSync(path.join(root,".chat-harness/temp/reconcile"));
  writeFileSync(path.join(root,".chat-harness/temp/reconcile/journal.json"),"incomplete evidence");
  const pending=tree(root);
  expect(invoke(["setup","--dry-run"],1).findings.some((f:{code:string})=>f.code==="setup.recovery_required")).toBe(true);
  invoke(["validate"],1);invoke(["doctor"],1);
  expect(tree(root)).toEqual(pending);
 }finally{rmSync(root,{recursive:true,force:true});}
},60000);
