import { expect,test } from "bun:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm,mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const enabled=process.platform==="win32" && process.env.CHAT_HARNESS_TEST_PACKAGING==="1";
test.skipIf(!enabled)("PowerShell v1 installer installs the qualified native pair and rejects a changed helper before replacement",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"harness-install-windows-"));
  const entry=path.join(root,"fixture.ts"),binaryPath=path.resolve(import.meta.dir,"../../dist/tests/install-fixture.exe");
  await mkdir(path.dirname(binaryPath),{recursive:true});
  await writeFile(entry,'console.log("1.0.0");\n');
  const build=await Bun.build({entrypoints:[entry],compile:{target:"bun-windows-x64",outfile:binaryPath}});
  expect(build.success).toBe(true);
  const binary=await readFile(binaryPath),helper=await readFile(path.resolve(import.meta.dir,"../../dist/npm/native/windows/win32-x64/safe-move.exe"));
  const asset="chat-harness-windows-x64.exe",native=asset+".windows-safe-move.exe";
  const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
  let tampered=false;
  const server=createServer((req,res)=>{
    const name=req.url?.slice(1);
    const files:Record<string,Buffer|string>={[asset]:binary,[asset+".sha256"]:hash(binary)+"  "+asset+"\n",
      [native]:tampered?Buffer.from("changed helper"):helper,[native+".sha256"]:hash(helper)+"  "+native+"\n"};
    const body=files[name??""];if(body===undefined){res.writeHead(404);res.end();}else res.end(body);
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();if(!address || typeof address==="string")throw new Error("Fixture server did not bind");
  const script=path.join(root,"install.ps1"),directory=path.join(root,"bin");
  const source=await readFile(path.resolve(import.meta.dir,"../../install.ps1"),"utf8");
  // Redirect the actual installer to a disposable local release fixture.
  await writeFile(script,source.replace('$tempDir = Join-Path',`$base = "http://127.0.0.1:${address.port}"\n$tempDir = Join-Path`));
  const install=()=>new Promise<number>((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",script],{
      env:{...process.env,CHAT_HARNESS_VERSION:"1.0.0",CHAT_HARNESS_INSTALL_DIR:directory},stdio:["ignore","ignore","pipe"]});
    let error="";child.stderr.on("data",c=>error+=String(c));child.on("error",reject);child.on("exit",code=>{if(code && !tampered)reject(new Error(error));else resolve(code??1);});
  });
  try {
    expect(await install()).toBe(0);
    const target=path.join(directory,"chat-harness.exe.windows-safe-move.exe");
    expect(await readFile(target)).toEqual(helper);
    expect(await readFile(target+".sha256","utf8")).toBe(hash(helper)+"  chat-harness.exe.windows-safe-move.exe\n");
    tampered=true;
    expect(await install()).not.toBe(0);
    expect(await readFile(target)).toEqual(helper);
    expect(await readFile(path.join(directory,"chat-harness.exe"))).toEqual(binary);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},90000);
