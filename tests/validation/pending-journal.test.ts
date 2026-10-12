import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exactByteDigest } from "../../src/setup/manifest.js";
import { managedStateHealthFindings } from "../../src/validation/managed-state.js";

const roots: string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
async function fixture():Promise<string>{
  const root=await mkdtemp(path.join(os.tmpdir(),"harness-pending-journal-"));roots.push(root);
  await mkdir(path.join(root,".chat-harness/temp/reconcile"),{recursive:true});return root;
}
function journal(equal=false):string{
  return JSON.stringify({
    schema:1,transactionId:"abcdef0123456789",
    startingManifest:exactByteDigest("before"),
    targetManifest:exactByteDigest(equal?"before":"after"),
    operations:[],
  })+"\n";
}
describe("read-only pending multi-file journal health",()=>{
  test("bounded valid pending journal is recognized but never recovered",async()=>{
    const root=await fixture(),p=path.join(root,".chat-harness/temp/reconcile/journal.json");
    await writeFile(p,journal());
    const before=await readFile(p);
    const findings=await managedStateHealthFindings(root);
    expect(findings.map(f=>f.code)).toEqual(["setup.recovery_required"]);
    expect(await readFile(p)).toEqual(before);
  });
  test("missing, malformed and poisoned journal report recovery conflict",async()=>{
    const root=await fixture(),p=path.join(root,".chat-harness/temp/reconcile/journal.json");
    expect((await managedStateHealthFindings(root)).map(f=>f.code))
      .toEqual(["setup.recovery_required","setup.recovery_conflict"]);
    await writeFile(p,'{"schema":2}');
    expect((await managedStateHealthFindings(root)).find(f=>f.code==="setup.recovery_conflict")).toBeDefined();
    await writeFile(p,journal().replace("abcdef0123456789","../../traversal"));
    expect((await managedStateHealthFindings(root)).find(f=>f.code==="setup.recovery_conflict")).toBeDefined();
    await writeFile(p,"X".repeat(65537));
    expect((await managedStateHealthFindings(root)).find(f=>f.code==="setup.recovery_conflict")).toBeDefined();
  });
  test("symlinked journal never follows external files",async()=>{
    const root=await fixture(),outside=await mkdtemp(path.join(os.tmpdir(),"harness-journal-outside-"));
    roots.push(outside);
    const external=path.join(outside,"user.json");
    await writeFile(external,journal());
    await symlink(external,path.join(root,".chat-harness/temp/reconcile/journal.json"));
    const before=await readFile(external);
    expect((await managedStateHealthFindings(root)).map(f=>f.code))
      .toContain("setup.recovery_conflict");
    expect(await readFile(external)).toEqual(before);
  });
  test("equal-manifest token is observable but never treated as automatic recovery approval",async()=>{
    const root=await fixture();
    await writeFile(path.join(root,".chat-harness/temp/reconcile/journal.json"),journal(true));
    await writeFile(path.join(root,".chat-harness/temp/reconcile/commit.token"),"unverified");
    expect((await managedStateHealthFindings(root)).map(f=>f.code))
      .toEqual(["setup.recovery_required"]);
    await writeFile(path.join(root,".chat-harness/temp/reconcile/journal.json"),journal(false));
    expect((await managedStateHealthFindings(root)).map(f=>f.code))
      .toContain("setup.recovery_conflict");
  });
});
