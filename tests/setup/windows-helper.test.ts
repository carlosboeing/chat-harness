import { expect, test } from "bun:test";
import { macosHelperPath, verifiedMacosHelper, invokeMacosSafeMove, invokeMacosSafeStage } from "../../src/workspace/macos-helper.js";
import { copyFileSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { runWindowsLifecycleJob, defaultWindowsHelperDependencies } from "../../src/lifecycle/windows.js";

test("Windows x64 uses a packaged executable and rejects unqualified architectures", () => {
  const base={platform:"win32",arch:"x64",standalone:false,entryPath:path.resolve("dist/npm/chat-harness.js"),executablePath:"unused"};
  expect(macosHelperPath(base)).toBe(path.resolve("dist/npm/native/windows/win32-x64/safe-move.exe"));
  expect(macosHelperPath({...base,standalone:true,executablePath:"C:\\bin\\chat-harness.exe"})).toBe("C:\\bin\\chat-harness.exe.windows-safe-move.exe");
  expect(()=>macosHelperPath({...base,arch:"arm64"})).toThrow("unsupported");
});

test("Windows helper rejects checksum-consistent scripts and wrong PE architecture before probing",()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"harness-pe-"));
 const helper=path.join(root,"native/windows/win32-x64/safe-move.exe");
 const info={platform:"win32",arch:"x64",standalone:false,entryPath:path.join(root,"entry.js"),executablePath:"unused"};
 try {
  mkdirSync(path.dirname(helper),{recursive:true});
  const wrong=Buffer.alloc(128);wrong.writeUInt16LE(0x5a4d,0);wrong.writeUInt32LE(64,0x3c);
  wrong.writeUInt32LE(0x00004550,64);wrong.writeUInt16LE(0xaa64,68);wrong.writeUInt16LE(0x20b,88);
  for(const bytes of [Buffer.from("#!/bin/sh\necho untrusted\n"),wrong]) {
   writeFileSync(helper,bytes);writeFileSync(helper+".sha256",createHash("sha256").update(bytes).digest("hex")+"  safe-move.exe\n");
   expect(()=>verifiedMacosHelper(info)).toThrow("wrong executable format");
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

const enabled=process.platform==="win32" && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
const runtime={platform:process.platform,arch:process.arch,standalone:false,entryPath:path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js"),executablePath:"unused"};
const hash=(bytes:string)=>createHash("sha256").update(bytes).digest("hex");

test.skipIf(!enabled)("Windows software update verifies the actual renamed helper and rebinds its checksum basename",async()=>{
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-win-update-")));
  try {
    const target=path.join(root,"chat-harness.exe"),staged=path.join(root,".chat-harness-update.test.exe");
    const helper=staged+".windows-safe-move.exe",backup=path.join(root,".chat-harness-backup.test.exe");
    copyFileSync(path.resolve(import.meta.dir,"../../dist/bin/chat-harness-windows-x64.exe"),staged);
    copyFileSync(verifiedMacosHelper(runtime),helper);
    const digest=createHash("sha256").update(readFileSync(helper)).digest("hex");
    writeFileSync(helper+".sha256",digest+"  "+path.basename(helper)+"\n");
    await runWindowsLifecycleJob({schema:1,action:"replace",parentPid:1,target,staged,expectedVersion:"0.3.7",backupPath:backup,
      nativeHelper:{staged:helper,backupPath:backup+".windows-safe-move.exe",digest},helperPath:"unused",jobPath:"unused"},
      {...defaultWindowsHelperDependencies,isProcessRunning:()=>false,scheduleCleanup:()=>{}});
    expect(verifiedMacosHelper({...runtime,standalone:true,executablePath:target})).toBe(target+".windows-safe-move.exe");
    expect(readFileSync(target+".windows-safe-move.exe.sha256","utf8")).toBe(digest+"  chat-harness.exe.windows-safe-move.exe\n");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test.skipIf(!enabled)("Windows native collision and digest mismatch preserve both copies",()=>{
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-windows-")));
  try {
    expect(verifiedMacosHelper(runtime)).toEndWith("safe-move.exe");
    writeFileSync(path.join(root,"source"),"source bytes");writeFileSync(path.join(root,"target"),"user target");
    const input={operation:"move" as const,workspace:root,parent:".",source:"source",destination:"target",digest:hash("source bytes")};
    expect(()=>invokeMacosSafeMove(input,runtime)).toThrow();
    expect(readFileSync(path.join(root,"source"),"utf8")).toBe("source bytes");
    expect(readFileSync(path.join(root,"target"),"utf8")).toBe("user target");
    expect(()=>invokeMacosSafeMove({...input,destination:"new",digest:hash("wrong")},runtime)).toThrow();
    expect(existsSync(path.join(root,"new"))).toBe(false);
    invokeMacosSafeMove({...input,destination:"new"},runtime);
    expect(existsSync(path.join(root,"source"))).toBe(false);
    expect(readFileSync(path.join(root,"new"),"utf8")).toBe("source bytes");
  } finally {rmSync(root,{recursive:true,force:true});}
});

test.skipIf(!enabled)("Windows native stage refuses junction parents and occupied leaves",()=>{
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-win-junction-")));
  const outside=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-win-outside-")));
  try {
    symlinkSync(outside,path.join(root,"junction"),"junction");
    const input={workspace:root,parent:"junction",destination:"stage",digest:hash("new bytes"),content:Buffer.from("new bytes")};
    expect(()=>invokeMacosSafeStage(input,runtime)).toThrow();
    expect(existsSync(path.join(outside,"stage"))).toBe(false);
    writeFileSync(path.join(root,"stage"),"keep occupied");
    expect(()=>invokeMacosSafeStage({...input,parent:"."},runtime)).toThrow();
    expect(readFileSync(path.join(root,"stage"),"utf8")).toBe("keep occupied");
    mkdirSync(path.join(root,"safe"));
    invokeMacosSafeStage({...input,parent:"safe"},runtime);
    expect(readFileSync(path.join(root,"safe/stage"),"utf8")).toBe("new bytes");
  } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test.skipIf(!enabled)("Windows physical-root identity and alias-prone native leaf names fail before changing files",()=>{
 const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-win-identities-")));
 try {
  writeFileSync(path.join(root,"source"),"keep exact source");
  const input={operation:"move" as const,workspace:root,parent:".",source:"source",destination:"new",digest:hash("keep exact source")};
  expect(()=>invokeMacosSafeMove(input,{...runtime,rootIdentity:"0:0"})).toThrow();
  for(const leaf of ["../escape","target:ads","CON","NUL.txt","target.","target "])
   expect(()=>invokeMacosSafeMove({...input,destination:leaf},runtime)).toThrow();
  const junction=path.join(root,"linked-root");symlinkSync(root,junction,"junction");
  expect(()=>invokeMacosSafeMove({...input,workspace:junction},runtime)).toThrow();
  expect(readFileSync(path.join(root,"source"),"utf8")).toBe("keep exact source");
  expect(existsSync(path.join(root,"new"))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
