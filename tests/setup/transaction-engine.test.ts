import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { executeManagedReconciliation, recoverManagedReconciliation } from "../../src/setup/transaction-engine.js";

test("unsupported mutation fails before any additive or managed writes", async () => {
  if (process.platform === "darwin") return;
  const root = mkdtempSync(path.join(os.tmpdir(), "harness-unsupported-"));
  try {
    const plan = await inspectAndPlanReadonlyReconciliation(root, {specialists:"shopping"}, "0.3.7");
    expect(plan.safeToPresent).toBe(true);
    await expect(executeManagedReconciliation(plan)).rejects.toThrow("unsupported");
    expect(existsSync(path.join(root,".chat-harness"))).toBe(false);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

const native = process.platform === "darwin" && process.env.CHAT_HARNESS_TEST_PACKAGING === "1";
const runtime = {platform:"darwin",arch:process.arch,standalone:false,
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
