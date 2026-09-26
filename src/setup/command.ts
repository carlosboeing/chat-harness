import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { applySetupPlan, SetupStalePlanError, SetupVerificationError, type ApplySetupOptions } from "./apply.js";
import { buildSetupPlan, inspectDomainScaffold, type SetupOperation } from "./plan.js";
import type { SpecialistId } from "./specialists.js";

const HOST_ACTION = "For ChatGPT Projects, copy the complete current AGENTS.md file into Project Instructions.";

export interface SetupCommandOptions {
  dryRun: boolean;
  specialist?: SpecialistId;
  scaffoldDomain?: boolean;
  replaceAgents?: boolean;
  replaceWorkspace?: boolean;
}
export interface SetupCommandDependencies { inspect?: typeof inspectWorkspace; applyOptions?: ApplySetupOptions; }
export interface SetupCommandOutput {
  result: {
    state: "no_changes" | "changes_planned" | "changes_applied" | "user_action_required" | "execution_failure";
    operations: ReadonlyArray<SetupOperation>;
    specialist: SpecialistId;
    host_action: string;
  };
  findings: Finding[];
}

export async function runSetup(workspace: string, options: SetupCommandOptions, dependencies: SetupCommandDependencies = {}): Promise<SetupCommandOutput> {
  const specialist = options.specialist ?? "general";
  const resolved = { specialist, scaffoldDomain: options.scaffoldDomain ?? false, replaceAgents: options.replaceAgents ?? false, replaceWorkspace: options.replaceWorkspace ?? false };
  const inspect = dependencies.inspect ?? inspectWorkspace;
  const snapshot = await inspect(workspace);
  const domain = resolved.scaffoldDomain ? await inspectDomainScaffold(workspace, specialist) : [];
  const plan = buildSetupPlan(snapshot, resolved, domain);
  const result = (state: SetupCommandOutput["result"]["state"], operations: ReadonlyArray<SetupOperation>) => ({ state, operations, specialist, host_action: HOST_ACTION });

  if (plan.findings.some((finding) => finding.severity === "error")) return { result: result("user_action_required", plan.operations), findings: [...plan.findings] };
  if (plan.operations.length === 0) return { result: result("no_changes", []), findings: [] };
  if (options.dryRun) return { result: result("changes_planned", plan.operations), findings: [] };

  try {
    await applySetupPlan(plan, dependencies.applyOptions);
    return { result: result("changes_applied", plan.operations), findings: [] };
  } catch (error) {
    if (error instanceof SetupStalePlanError) return { result: result("user_action_required", plan.operations), findings: [{ code: "setup.stale_plan", severity: "error", message: "Workspace state changed after inspection; setup stopped without overwriting the changed path.", location: error.operation.path, remediation: "Inspect the path and rerun setup." }] };
    if (error instanceof SetupVerificationError) return { result: result("execution_failure", plan.operations), findings: [{ code: "setup.verification_failed", severity: "error", message: error.message, remediation: "Inspect Workspace state before retrying setup." }] };
    throw error;
  }
}
