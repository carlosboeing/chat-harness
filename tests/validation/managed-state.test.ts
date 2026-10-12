import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { managedStateHealthFindings } from "../../src/validation/managed-state.js";
import { runValidate } from "../../src/validation/command.js";
import { runDoctor } from "../../src/doctor/command.js";
import { buildDesiredManifest, serializeManifest } from "../../src/setup/manifest.js";
import { AGENTS_TEMPLATE } from "../../src/setup/templates.js";
import { createWorkspaceInstructions } from "../../src/setup/workspace-boundary.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r,{recursive:true,force:true}))); });
async function fixture(): Promise<string> {
  const r=await mkdtemp(path.join(os.tmpdir(),"managed-health-")); roots.push(r);
  await mkdir(path.join(r,".chat-harness"));
  await writeFile(path.join(r,"AGENTS.md"),AGENTS_TEMPLATE);
  await writeFile(path.join(r,".chat-harness/WORKSPACE.md"),createWorkspaceInstructions([]));
  await writeFile(path.join(r,".chat-harness/manifest.yaml"),serializeManifest(
    buildDesiredManifest("0.3.7",AGENTS_TEMPLATE,[])));
  return r;
}
describe("read-only manifest diagnostics",()=>{
  test("clean manifest emits no health findings in both CLI commands",async()=>{
    const r=await fixture(), file=path.join(r,"AGENTS.md"),before=await readFile(file);
    expect(await managedStateHealthFindings(r)).toEqual([]);
    expect((await runValidate(r)).findings.some(x=>x.code==="setup.managed_file_diverged")).toBe(false);
    expect((await runDoctor(r,{runtimeFacts:{execPath:"/bin/chat-harness"}})).findings
      .some(x=>x.code==="setup.managed_file_diverged")).toBe(false);
    expect(await readFile(file)).toEqual(before);
  });
  test("recorded digest drift is diagnosed by validate and doctor without writing",async()=>{
    const r=await fixture(),file=path.join(r,"AGENTS.md");
    await writeFile(file,AGENTS_TEMPLATE+"\nchanged");
    const before=await readFile(file);
    expect((await runValidate(r)).findings.map(x=>x.code)).toContain("setup.managed_file_diverged");
    expect((await runDoctor(r,{runtimeFacts:{execPath:"/bin/chat-harness"}})).findings
      .map(x=>x.code)).toContain("setup.managed_file_diverged");
    expect(await readFile(file)).toEqual(before);
  });
  test("invalid Workspace markers and symlinks are surfaced without rewriting",async()=>{
    const r=await fixture(),file=path.join(r,".chat-harness/WORKSPACE.md");
    await writeFile(file,"# Custom instructions\r\n");
    expect((await managedStateHealthFindings(r)).map(x=>x.code)).toContain("workspace.boundary_invalid");
    const other=await fixture();
    await rm(file);
    await symlink(path.join(other,".chat-harness/WORKSPACE.md"),file);
    expect((await managedStateHealthFindings(r)).map(x=>x.code)).toContain("workspace.instructions_unsafe");
    expect(await readFile(path.join(other,".chat-harness/WORKSPACE.md"),"utf8")).toBe(createWorkspaceInstructions([]));
  });
  test("pending journal halts before invalid manifest ownership interpretation",async()=>{
    const r=await fixture();
    await mkdir(path.join(r,".chat-harness/temp/reconcile"),{recursive:true});
    await writeFile(path.join(r,".chat-harness/manifest.yaml"),"schema: [");
    expect((await managedStateHealthFindings(r)).map(x=>x.code)).toEqual(["setup.recovery_required"]);
  });
  test("invalid schema is reported and absent manifest does not disrupt legacy validation",async()=>{
    const r=await fixture(),p=path.join(r,".chat-harness/manifest.yaml");
    await writeFile(p,"schema: 999");
    expect((await managedStateHealthFindings(r)).map(x=>x.code)).toContain("setup.manifest_invalid");
    await rm(p);
    expect(await managedStateHealthFindings(r)).toEqual([]);
  });
});
