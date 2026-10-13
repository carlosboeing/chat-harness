import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { executeManagedReconciliation, recoverManagedReconciliation } from "../../src/setup/transaction-engine.js";

test("unsupported mutation fails before any additive or managed writes", async () => {
  if (process.platform === "darwin" || process.platform === "linux") {
    // Unsupported Windows mutation must refuse before touching the fixture.
  }
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-unsupported-"));
  try {
    const plan = await inspectAndPlanReadonlyReconciliation(root, {specialists:"shopping"}, "0.3.7");
    expect(plan.safeToPresent).toBe(true);
    await expect(executeManagedReconciliation(plan,{platform:"win32",arch:"arm64",standalone:false,entryPath:"/missing",executablePath:"/missing"})).rejects.toThrow("unsupported");
    expect(existsSync(path.join(root,".chat-harness"))).toBe(false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

const native = ["darwin","linux","win32"].includes(process.platform) && process.env.CHAT_HARNESS_TEST_PACKAGING === "1";
const runtime = {platform:process.platform,arch:process.arch,standalone:false,
  entryPath:path.resolve(import.meta.dir,"../../dist/npm/chat-harness.js"),executablePath:"unused"};

test.skipIf(!native)("native fresh/repeated/exact-set removal preserves user bytes", async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "harness-engine-")));
  try {
    writeFileSync(path.join(root,"notes.bin"),Buffer.from([0,255,13,10]));
    let plan = await inspectAndPlanReadonlyReconciliation(root,{specialists:"shopping, career",scaffoldDomain:true},"0.3.7");
    expect(await executeManagedReconciliation(plan,runtime)).toEqual({committed:true,cleanupPending:false});
    const workspace = path.join(root,".chat-harness/WORKSPACE.md");
    writeFileSync(workspace,readFileSync(workspace,"utf8")+"\r\nUser customisation\r\n");
    plan = await inspectAndPlanReadonlyReconciliation(root,{},"0.3.7");
    expect(plan.operations.filter(op=>op.action!=="unchanged")).toHaveLength(0);
    plan = await inspectAndPlanReadonlyReconciliation(root,{specialists:"none"},"0.3.7");
    await executeManagedReconciliation(plan,runtime);
    expect(readFileSync(workspace,"utf8").endsWith("\r\nUser customisation\r\n")).toBe(true);
    expect(existsSync(path.join(root,".chat-harness/procedures/shopping-research-methodology.md"))).toBe(false);
    expect(existsSync(path.join(root,"Purchases"))).toBe(true);
    expect(readFileSync(path.join(root,"notes.bin"))).toEqual(Buffer.from([0,255,13,10]));
    expect(await recoverManagedReconciliation(root,runtime)).toBe("absent");
  } finally { rmSync(root,{recursive:true,force:true}); }
},30000);

test.skipIf(!native)("native Core upgrade and Specialist additions use recorded before bytes without owning user files",async()=>{
  const {parseManifest,serializeManifest}=await import("../../src/setup/manifest.js");
  const {AGENTS_TEMPLATE,CORE_VERSION}=await import("../../src/setup/templates.js");
  const {exactByteDigest}=await import("../../src/setup/manifest.js");
  const root=realpathSync(mkdtempSync(path.join(os.tmpdir(),"harness-upgrade-")));
  try{
    await executeManagedReconciliation(await inspectAndPlanReadonlyReconciliation(root,{specialists:"shopping"},"0.3.7"),runtime);
    const old="<!-- chat-harness-managed: agents -->\n# Older verified Core\n";
    writeFileSync(path.join(root,"AGENTS.md"),old);
    const manifestPath=path.join(root,".chat-harness/manifest.yaml");
    const installed=parseManifest(readFileSync(manifestPath,"utf8"));
    installed.core.version=CORE_VERSION-1;installed.core.files["AGENTS.md"].digest=exactByteDigest(old);
    writeFileSync(manifestPath,serializeManifest(installed));
    const userFile=path.join(root,".chat-harness/procedures/user-notes.bin");
    writeFileSync(userFile,Buffer.from([255,0,13,10]));
    const upgraded=await inspectAndPlanReadonlyReconciliation(root,{specialists:"travel"},"0.3.7");
    expect(upgraded.operations.some(op=>op.path==="AGENTS.md" && op.action==="replace_file")).toBe(true);
    await executeManagedReconciliation(upgraded,runtime);
    expect(readFileSync(path.join(root,"AGENTS.md"),"utf8")).toBe(AGENTS_TEMPLATE);
    expect(parseManifest(readFileSync(manifestPath,"utf8")).core.version).toBe(CORE_VERSION);
    await executeManagedReconciliation(await inspectAndPlanReadonlyReconciliation(root,{specialists:"travel,shopping"},"0.3.7"),runtime);
    expect(existsSync(path.join(root,".chat-harness/procedures/shopping-research-methodology.md"))).toBe(true);
    expect(readFileSync(userFile)).toEqual(Buffer.from([255,0,13,10]));
  }finally{rmSync(root,{recursive:true,force:true});}
},30000);
