import { spawnSync } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./checksum.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export const windowsNpmHelperPath=()=>path.join(root,"dist/npm/native/windows/win32-x64/safe-move.exe");

/** Build-time MSVC discovery only. The packaged helper uses static CRT and
 * Windows system APIs; consumers never run a compiler or download a helper. */
function compilerEnvironment():NodeJS.ProcessEnv {
  if(process.env.VCToolsInstallDir)return process.env;
  const programFiles=process.env["ProgramFiles(x86)"];
  if(!programFiles)throw new Error("MSVC build tools are unavailable.");
  const found=spawnSync(path.join(programFiles,"Microsoft Visual Studio/Installer/vswhere.exe"),
    ["-latest","-products","*","-requires","Microsoft.VisualStudio.Component.VC.Tools.x86.x64","-property","installationPath"],{encoding:"utf8"});
  const installation=found.stdout?.trim();
  if(found.error || found.status!==0 || !installation || /["\r\n%&|<>^]/.test(installation))throw new Error("MSVC installation could not be resolved.");
  const vcvars=path.join(installation,"VC/Auxiliary/Build/vcvars64.bat");
  const result=spawnSync(process.env.ComSpec??"cmd.exe",["/d","/s","/c",`call "${vcvars}" >nul && set`],{encoding:"utf8",windowsVerbatimArguments:true});
  if(result.error || result.status!==0)throw new Error("MSVC x64 environment initialization failed: "+result.stderr);
  const environment:NodeJS.ProcessEnv={...process.env};
  for(const line of result.stdout.split(/\r?\n/)){const at=line.indexOf("=");if(at>0)environment[line.slice(0,at)]=line.slice(at+1);}
  return environment;
}
export async function buildWindowsHelper(arch:string,output:string,testHooks=false):Promise<void> {
  if(process.platform!=="win32" || process.arch!=="x64" || arch!=="x64")throw new Error("Windows helper requires a matching Windows x64 build host.");
  const absolute=path.resolve(output);
  if(!absolute.startsWith(root+path.sep) || !absolute.endsWith(".exe"))throw new Error("Windows helper output must remain inside repository and end in .exe.");
  await mkdir(path.dirname(absolute),{recursive:true});
  const environment=compilerEnvironment();
  const result=spawnSync("cl.exe",["/nologo","/std:c11","/O2","/W3","/WX","/MT","/D_CRT_SECURE_NO_WARNINGS",
    ...(testHooks?["/DGATE0_TEST_HOOKS"]:[]),path.join(root,"native/windows/safe-move.c"),
    "/Fo"+absolute+".obj","/Fe"+absolute,"/link","bcrypt.lib"],{env:environment,encoding:"utf8"});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error("Windows helper compilation failed:\n"+result.stdout+result.stderr);
  await unlink(absolute+".obj");
  await writeFile(absolute+".sha256",await sha256File(absolute)+"  "+path.basename(absolute)+"\n");
}
