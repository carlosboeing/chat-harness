import { spawnSync } from "node:child_process";
import { chmod,mkdir,writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256File } from "./checksum.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export function linuxNpmHelperPath(arch:string):string{return path.join(root,"dist/npm/native/linux",`linux-${arch}`,"safe-move");}
/** Compile on matching Linux CI architecture, statically including SHA-256.
 * No runtime compiler, source checkout, libcrypto.so or network dependency. */
export async function buildLinuxHelper(arch:string,output:string):Promise<void>{
 if(process.platform!=="linux" || process.arch!==arch || !["arm64","x64"].includes(arch))throw new Error("Linux helper requires a matching Linux build host.");
 const absolute=path.resolve(output);
 if(!absolute.startsWith(root+path.sep))throw new Error("Native helper output must remain inside repository.");
 await mkdir(path.dirname(absolute),{recursive:true});
 const result=spawnSync("cc",["-std=c11","-O2","-Wall","-Wextra","-Werror","-Wno-deprecated-declarations","-static",path.join(root,"native/macos/gate0-safe-move.c"),"-lcrypto","-ldl","-pthread","-o",absolute],{stdio:"inherit"});
 if(result.error)throw result.error;if(result.status!==0)throw new Error("Static Linux helper compilation failed.");
 const dependencies=spawnSync("ldd",[absolute],{encoding:"utf8"});
 if(!/not a dynamic executable|statically linked/.test(dependencies.stdout+dependencies.stderr))throw new Error("Linux helper unexpectedly has runtime library dependencies.");
 await chmod(absolute,0o755);
 await writeFile(absolute+".sha256",await sha256File(absolute)+"  "+path.basename(absolute)+"\n");
}
