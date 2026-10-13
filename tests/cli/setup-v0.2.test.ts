// Negative compatibility fixtures for the removed pre-v1 CLI contract.
import { expect,test } from "bun:test";
import { mkdtemp,readdir,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/main.js";
for(const args of [["--specialist","career"],["--specialist","general"],["--replace-workspace"],["--force"]]){
 test(`obsolete setup syntax ${args.join(" ")} is rejected without mutation`,async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"harness-legacy-cli-"));
  try{
   expect(await runCli(["setup",root,...args],{cwd:root,isTTY:false,stdout:()=>{},stderr:()=>{}})).toBe(2);
   expect(await readdir(root)).toEqual([]);
  }finally{await rm(root,{recursive:true,force:true});}
 });
}
