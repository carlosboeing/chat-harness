import { expect, test } from "bun:test";
import { macosHelperPath, verifiedMacosHelper, invokeMacosSafeMove, invokeMacosSafeStage } from "../../src/workspace/macos-helper.js";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

test("Windows x64 uses a packaged executable and rejects unqualified architectures", () => {
  const base={platform:"win32",arch:"x64",standalone:false,entryPath:path.resolve("dist/npm/chat-harness.js"),executablePath:"unused"};
  expect(macosHelperPath(base)).toBe(path.resolve("dist/npm/native/windows/win32-x64/safe-move.exe"));
  expect(macosHelperPath({...base,standalone:true,executablePath:"C:\\bin\\chat-harness.exe"})).toBe("C:\\bin\\chat-harness.exe.windows-safe-move.exe");
  expect(()=>macosHelperPath({...base,arch:"arm64"})).toThrow("unsupported");
});

const enabled=process.platform==="win32" && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
const runtime={platform:process.platform,arch:process.arch,standalone:false,entryPath:path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js"),executablePath:"unused"};
const hash=(bytes:string)=>createHash("sha256").update(bytes).digest("hex");

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
