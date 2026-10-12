import { expect,test } from "bun:test";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installMvpFixture } from "../helpers/mvp-workspace.js";
import { managedStateHealthFindings } from "../../src/validation/managed-state.js";
import { runDoctor } from "../../src/doctor/command.js";
import { parseManifest,serializeManifest } from "../../src/setup/manifest.js";
import { CORE_VERSION } from "../../src/setup/templates.js";

test("diagnostics distinguish a clean outdated component from digest drift",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"harness-health-"));
 try{
  await installMvpFixture(root);
  const p=path.join(root,".chat-harness/manifest.yaml");
  const m=parseManifest(await readFile(p,"utf8"));m.core.version=CORE_VERSION-1;await writeFile(p,serializeManifest(m));
  const findings=await managedStateHealthFindings(root);
  expect(findings.some(f=>f.code==="setup.core_outdated" && f.severity==="warning")).toBe(true);
  expect(findings.some(f=>f.code==="setup.managed_file_diverged")).toBe(false);
  await writeFile(path.join(root,"AGENTS.md"),(await readFile(path.join(root,"AGENTS.md"),"utf8"))+"changed");
  expect((await managedStateHealthFindings(root)).some(f=>f.code==="setup.managed_file_diverged")).toBe(true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test("Career's absent recommended capability is a warning without installation",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"harness-career-"));
 try{
  await installMvpFixture(root,{specialists:"career"});
  const result=await runDoctor(root);
  expect(result.findings.some(f=>f.code==="capability.recommended_missing" && f.severity==="warning")).toBe(true);
  expect(result.findings.some(f=>f.code==="capability.recommended_missing" && f.severity==="error")).toBe(false);
 }finally{await rm(root,{recursive:true,force:true});}
});
