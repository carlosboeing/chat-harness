import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../../src/cli/main.js";

test("packaged setup surface supports exact sets and emits a read-only semantic preview",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"harness-v1-cli-"));
  try {
    let output="";
    const code=await runCli(["setup",root,"--specialists"," shopping, career,shopping ","--scaffold-domain","--adopt-workspace","--dry-run","--json","--no-color"],
      {cwd:root,isTTY:false,stdout:t=>output+=t,stderr:t=>output+=t});
    expect(code).toBe(0);
    const parsed=JSON.parse(output);
    expect(parsed.result.state).toBe("changes_planned");
    expect(parsed.result.desired_specialists).toEqual(["career","shopping"]);
    expect(parsed.result.current_specialists).toEqual([]);
    expect(parsed.result.operations.some((op:{path:string})=>op.path===".chat-harness/procedures/shopping-research-methodology.md")).toBe(true);
    expect(output).not.toContain("chat-harness-stage");
    expect(await readdir(root)).toEqual([]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test.each(["--specialist","--replace-workspace","--force"])("setup rejects obsolete/unsupported %s",async(flag)=>{
  let output="";
  const args=["setup",flag,...(flag==="--specialist"?["travel"]:[])];
  expect(await runCli(args,{isTTY:false,stdout:t=>output+=t,stderr:t=>output+=t})).toBe(2);
  expect(output).toContain("unknown option");
});

test("invalid exact sets return stable Specialist findings",async()=>{
  let output="";
  expect(await runCli(["setup","--dry-run","--json","--specialists","none,tech"],{isTTY:false,stdout:t=>output+=t,stderr:t=>output+=t})).toBe(1);
  expect(JSON.parse(output).findings[0].code).toBe("setup.specialist_unknown");
});
