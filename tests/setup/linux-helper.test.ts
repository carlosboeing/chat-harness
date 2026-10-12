import { expect,test } from "bun:test";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { verifiedMacosHelper,invokeMacosSafeMove } from "../../src/workspace/macos-helper.js";

test.skipIf(process.platform!=="linux")("Linux static native backend moves without replacing a collision",()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"harness-linux-"));
 try{
  const helper=path.join(root,"native/linux",`linux-${process.arch}`,"safe-move");mkdirSync(path.dirname(helper),{recursive:true});
  const result=spawnSync("cc",["-std=c11","-O2","-Wall","-Wextra","-Werror","-Wno-deprecated-declarations","-static",path.resolve(import.meta.dir,"../../native/macos/gate0-safe-move.c"),"-lcrypto","-ldl","-pthread","-o",helper],{encoding:"utf8"});
  expect(result.status).toBe(0);
  writeFileSync(helper+".sha256",createHash("sha256").update(readFileSync(helper)).digest("hex")+"  safe-move\n");
  const runtime={platform:"linux",arch:process.arch,standalone:false,entryPath:path.join(root,"entry.js"),executablePath:"unused"};
  expect(verifiedMacosHelper(runtime)).toBe(helper);
  writeFileSync(path.join(root,"source"),"keep source");writeFileSync(path.join(root,"target"),"keep target");
  expect(()=>invokeMacosSafeMove({operation:"move",workspace:root,parent:".",source:"source",destination:"target",digest:createHash("sha256").update("keep source").digest("hex")},runtime)).toThrow();
  expect(readFileSync(path.join(root,"source"),"utf8")).toBe("keep source");expect(readFileSync(path.join(root,"target"),"utf8")).toBe("keep target");
  const dependencies=spawnSync("ldd",[helper],{encoding:"utf8"});
  expect(dependencies.stdout+dependencies.stderr).toContain("not a dynamic executable");
 }finally{rmSync(root,{recursive:true,force:true});}
});
