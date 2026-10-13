/**
 * CI-only macOS multi-file native transaction rehearsal. Disposable Workspaces
 * only: NEVER imported by installed setup. Tests exact journal states using
 * the packaged primitive's source-integrity + no-replace rename protocol.
 * No cleanup or OS/power-loss durability is claimed.
 */
import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assessManagedRecovery, journalSibling, validateManagedJournal,
  type ManagedTransactionJournal, type RecoveryObservation,
} from "../../src/setup/multifile-journal-contract.js";
import { exactByteDigest, parseManifest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE, CORE_VERSION } from "../../src/setup/templates.js";

const native = process.env.GATE0_SPIKE_NATIVE;
if (!["darwin","linux"].includes(process.platform) || !native) throw new Error("Compile native helper and supply GATE0_SPIKE_NATIVE");
const tx = "abcdef0123456789";
const JPATH = ".chat-harness/temp/reconcile/journal.json";
const MPATH = ".chat-harness/manifest.yaml";
const WPATH = ".chat-harness/WORKSPACE.md";
const P1 = ".chat-harness/procedures/first.md";
const P2 = ".chat-harness/procedures/second.md";
const OLD_WORKSPACE = "<!-- chat-harness-managed: workspace -->\n# Old\n<!-- chat-harness-user: workspace -->\r\nUser notes\r\n";
const NEW_WORKSPACE = "<!-- chat-harness-managed: workspace -->\n# New\n<!-- chat-harness-user: workspace -->\r\nUser notes\r\n";
const OLD_P1 = "<!-- chat-harness-managed: procedure -->\nOld first\n";
const NEW_P1 = "<!-- chat-harness-managed: procedure -->\nNew first\n";
const NEW_P2 = "<!-- chat-harness-managed: procedure -->\nNew second\n";
const digest = exactByteDigest;
const hex = (value: string): string => value.slice(7);
const pathAt = (root: string, rel: string): string => path.join(root, ...rel.split("/"));
const OLD_MANIFEST = serializeManifest({
  schema: 1, harness: {version: "0.3.7"},
  core: {version: CORE_VERSION,files: {"AGENTS.md":{digest:digest(AGENTS_TEMPLATE)}}},
  specialists: {shopping:{version:1,files:{[P1]:{digest:digest(OLD_P1)}}}},
});
const NEW_MANIFEST = serializeManifest({
  schema: 1, harness: {version: "0.3.8"},
  core: {version: CORE_VERSION,files: {"AGENTS.md":{digest:digest(AGENTS_TEMPLATE)}}},
  specialists: {shopping:{version:1,files:{[P1]:{digest:digest(NEW_P1)},[P2]:{digest:digest(NEW_P2)}}}},
});

const journal: ManagedTransactionJournal = validateManagedJournal({
  schema:1, transactionId:tx,
  startingManifest:digest(OLD_MANIFEST),targetManifest:digest(NEW_MANIFEST),
  operations:[
    {path:WPATH,owner:"workspace",action:"replace",before:digest(OLD_WORKSPACE),after:digest(NEW_WORKSPACE),
      stage:journalSibling(WPATH,"stage",tx),backup:journalSibling(WPATH,"backup",tx)},
    {path:P1,owner:"specialist",action:"replace",before:digest(OLD_P1),after:digest(NEW_P1),
      stage:journalSibling(P1,"stage",tx),backup:journalSibling(P1,"backup",tx)},
    {path:P2,owner:"specialist",action:"create",before:null,after:digest(NEW_P2),
      stage:journalSibling(P2,"stage",tx),backup:null},
  ],
});
const contents: Record<string,string> = {
  [WPATH]:NEW_WORKSPACE, [P1]:NEW_P1, [P2]:NEW_P2,
};
const roots: string[] = [];
afterEach(async () => { for(const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });

async function atDigest(root: string, rel: string | null): Promise<ReturnType<typeof digest> | null> {
  if(!rel)return null;
  try {
    const full=pathAt(root,rel);
    const stat=await lstat(full);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Unsafe leaf: "+rel);
    return digest(await readFile(full));
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==="ENOENT")return null;
    throw error;
  }
}
async function observation(root:string):Promise<RecoveryObservation>{
  const operations=[];
  for(const op of journal.operations) operations.push({
    path:op.path,canonical:await atDigest(root,op.path),
    stage:await atDigest(root,op.stage),backup:await atDigest(root,op.backup),
  });
  return {
    canonicalManifest:await atDigest(root,MPATH),
    manifestBackup:await atDigest(root,journalSibling(MPATH,"backup",tx)),
    equalManifestCommit:"absent",operations,
  };
}
function move(root:string,operation:"move"|"promote"|"restore",src:string,dst:string,expected:string):void{
  const parent=path.posix.dirname(src);
  if(parent!==path.posix.dirname(dst))throw new Error("Non-sibling move");
  execFileSync(native!,[operation,root,parent==="."?".":parent,path.posix.basename(src),
    path.posix.basename(dst),hex(expected)],{stdio:["ignore","pipe","pipe"]});
}
async function fixture():Promise<string>{
  const temp=await mkdtemp(path.join(tmpdir(),"harness-multifile-"));
  roots.push(temp);
  const root=await realpath(temp); // macOS /var alias protection
  await mkdir(pathAt(root,".chat-harness/procedures"),{recursive:true});
  await mkdir(pathAt(root,".chat-harness/temp"),{recursive:true});
  await writeFile(pathAt(root,"AGENTS.md"),AGENTS_TEMPLATE,{flag:"wx"});
  await writeFile(pathAt(root,WPATH),OLD_WORKSPACE,{flag:"wx"});
  await writeFile(pathAt(root,P1),OLD_P1,{flag:"wx"});
  await writeFile(pathAt(root,MPATH),OLD_MANIFEST,{flag:"wx"});
  await mkdir(pathAt(root,".chat-harness/temp/reconcile")); // exclusive
  for(const op of journal.operations){
    if(op.stage)await writeFile(pathAt(root,op.stage),contents[op.path]!,{flag:"wx"});
  }
  await writeFile(pathAt(root,journalSibling(MPATH,"stage",tx)),NEW_MANIFEST,{flag:"wx"});
  await writeFile(pathAt(root,JPATH),JSON.stringify(journal)+"\n",{flag:"wx"});
  return root;
}
async function checkJournal(root:string):Promise<void>{
  const raw=await readFile(pathAt(root,JPATH),"utf8");
  const parsed=validateManagedJournal(JSON.parse(raw));
  if(JSON.stringify(parsed)!==JSON.stringify(journal))throw new Error("Transaction journal modified");
}
type Stop = "after-workspace-backup"|"after-workspace-promotion"|
  "after-first-backup"|"after-first-promotion"|"after-create"|"after-manifest-backup"|"after-commit";
async function apply(root:string,stop?:Stop):Promise<void>{
  await checkJournal(root);
  if(await atDigest(root,MPATH)!==journal.startingManifest)throw new Error("Stale initial manifest");
  for(const [index,op] of journal.operations.entries()){
    if(await atDigest(root,op.path)!==op.before ||
       await atDigest(root,op.stage)!==op.after && op.stage!==null)throw new Error("Stale file precondition");
    if(op.before)move(root,"move",op.path,op.backup!,op.before);
    if(index===0 && stop==="after-workspace-backup")return;
    if(index===1 && stop==="after-first-backup")return;
    if(op.after)move(root,"promote",op.stage!,op.path,op.after);
    if(await atDigest(root,op.path)!==op.after)throw new Error("Post-promotion drift");
    if(index===0 && stop==="after-workspace-promotion")return;
    if(index===1 && stop==="after-first-promotion")return;
    if(index===2 && stop==="after-create")return;
  }
  const assessment=await observation(root);
  if(assessment.operations.some((o,i)=>o.canonical!==journal.operations[i]?.after))
    throw new Error("Incomplete precommit output");
  move(root,"move",MPATH,journalSibling(MPATH,"backup",tx),journal.startingManifest!);
  if(stop==="after-manifest-backup")return;
  move(root,"promote",journalSibling(MPATH,"stage",tx),MPATH,journal.targetManifest);
  if(await atDigest(root,MPATH)!==journal.targetManifest)throw new Error("Manifest commit readback failed");
  if(stop==="after-commit")return;
}
async function recover(root:string):Promise<"rollback"|"committed">{
  await checkJournal(root);
  const before=await observation(root);
  const assessment=assessManagedRecovery(journal,before);
  if(assessment.decision==="conflict")throw new Error("Recovery conflict: "+assessment.conflicts.join("; "));
  if(assessment.decision==="committed"){
    const parsed=parseManifest(await readFile(pathAt(root,MPATH),"utf8"));
    if(parsed.specialists.shopping?.files?.[P2]?.digest!==digest(NEW_P2))
      throw new Error("Committed manifest mismatch");
    return "committed";
  }
  // All operations were classified before ANY restore. Reverse application
  // is idempotent, non-clobbering and preserves promoted after bytes as evidence.
  for(const op of [...journal.operations].reverse()){
    const current=await atDigest(root,op.path);
    if(current===op.after && op.after!==null){
      move(root,"move",op.path,journalSibling(op.path,"stage",tx)+"-held",op.after);
    }
    if(op.before && await atDigest(root,op.backup)===op.before) {
      move(root,"restore",op.backup!,op.path,op.before);
    }
    if(await atDigest(root,op.path)!==op.before)throw new Error("Rollback readback failed");
  }
  if(await atDigest(root,MPATH)===null){
    move(root,"restore",journalSibling(MPATH,"backup",tx),MPATH,journal.startingManifest!);
  }
  if(await atDigest(root,MPATH)!==journal.startingManifest)throw new Error("Manifest rollback mismatch");
  return "rollback";
}

test("multi-file transaction commits manifest LAST and repeat recovery proves committed",async()=>{
  const root=await fixture();await apply(root);
  expect((await observation(root)).canonicalManifest).toBe(journal.targetManifest);
  expect(await recover(root)).toBe("committed");
  expect(await recover(root)).toBe("committed");
  expect(await atDigest(root,P2)).toBe(digest(NEW_P2));
  expect(await atDigest(root,WPATH)).toBe(digest(NEW_WORKSPACE));
});
for(const stop of ["after-workspace-backup","after-workspace-promotion",
  "after-first-backup","after-first-promotion","after-create","after-manifest-backup"] as const){
  test("multi-file rollback after "+stop+" restores pretransaction state",async()=>{
    const root=await fixture();
    await apply(root,stop);
    expect(await recover(root)).toBe("rollback");
    expect(await recover(root)).toBe("rollback");
    expect(await atDigest(root,MPATH)).toBe(journal.startingManifest);
    expect(await atDigest(root,WPATH)).toBe(digest(OLD_WORKSPACE));
    expect(await atDigest(root,P1)).toBe(digest(OLD_P1));
    expect(await atDigest(root,P2)).toBeNull();
  });
}
test("intervening user content at vacated path blocks all rollback moves",async()=>{
  const root=await fixture();
  await apply(root,"after-first-backup");
  await writeFile(pathAt(root,P1),"user-owned edit\n",{flag:"wx"});
  const previous=await readFile(pathAt(root,WPATH));
  await expect(recover(root)).rejects.toThrow("Recovery conflict");
  expect(await readFile(pathAt(root,P1),"utf8")).toBe("user-owned edit\n");
  expect(await atDigest(root,journalSibling(P1,"backup",tx))).toBe(digest(OLD_P1));
  expect(await readFile(pathAt(root,WPATH))).toEqual(previous);
});
test("modified journal blocks recovery without executing native mutation",async()=>{
  const root=await fixture();
  await apply(root,"after-workspace-backup");
  await writeFile(pathAt(root,JPATH),'{"schema":1}',{flag:"w"});
  await expect(recover(root)).rejects.toThrow();
  expect(await atDigest(root,journalSibling(WPATH,"backup",tx))).toBe(digest(OLD_WORKSPACE));
});
