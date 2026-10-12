// Dedicated process used only by the SIGKILL acceptance fixtures.
import { inspectAndPlanReadonlyReconciliation } from "../../src/setup/readonly-reconcile-plan.js";
import { executeManagedReconciliation } from "../../src/setup/transaction-engine.js";
const [root,entryPath,selection] = process.argv.slice(2);
if(!root || !entryPath || selection===undefined)throw new Error("Invalid test worker arguments");
const plan=await inspectAndPlanReadonlyReconciliation(root,{specialists:selection},"0.3.7");
await executeManagedReconciliation(plan,{platform:"darwin",arch:process.arch,standalone:false,entryPath,executablePath:"unused"});
