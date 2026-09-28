import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { applySetupPlan, SetupCancelledError, SetupStalePlanError, SetupVerificationError, type ApplySetupOptions } from "./apply.js";
import { buildSetupPlan, inspectDomainScaffold, inspectLegacyInstructions, type SetupOperation } from "./plan.js";
import { buildSetupStructure, type SetupStructureEntry } from "./presentation.js";
import type { SpecialistId } from "./specialists.js";

const HOST_ACTION_READY = [
  "Your Workspace files are ready. To use this Workspace with ChatGPT:",
  "1. Make sure this folder is stored in Google Drive so ChatGPT can access the same up-to-date files.",
  "2. In your ChatGPT Project, add the Google Drive folder under Sources.",
  "3. Open AGENTS.md, copy the complete file, and paste it into Project settings → Project Instructions.",
  "Guide: https://github.com/carlosboeing/chat-harness/blob/main/docs/hosts/chatgpt.md",
].join("\n");

const HOST_ACTION_MIGRATION_REQUIRED = [
  "Chat Harness is installed, but existing root project instructions were detected and preserved.",
  "Before changing the host's project instructions, review that legacy file and migrate the Workspace-specific behavior you still need into .chat-harness/WORKSPACE.md.",
  "Only after that review should you activate the host binding with the complete AGENTS.md.",
  "Guide: https://github.com/carlosboeing/chat-harness/blob/main/docs/hosts/chatgpt.md",
].join("\n");

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
    state: "no_changes" | "changes_planned" | "changes_applied" | "cancelled" | "user_action_required" | "execution_failure";
    operations: ReadonlyArray<SetupOperation>;
    specialist: SpecialistId;
    structure?: ReadonlyArray<SetupStructureEntry>;
    host_action?: string;
    activation: "ready" | "migration_required";
  };
  findings: Finding[];
}

export async function runSetup(workspace: string, options: SetupCommandOptions, dependencies: SetupCommandDependencies = {}): Promise<SetupCommandOutput> {
  const specialist = options.specialist ?? "general";
  const resolved = { specialist, scaffoldDomain: options.scaffoldDomain ?? false, replaceAgents: options.replaceAgents ?? false, replaceWorkspace: options.replaceWorkspace ?? false };
  const inspect = dependencies.inspect ?? inspectWorkspace;
  const snapshot = await inspect(workspace);
  const legacyInstructions = await inspectLegacyInstructions(workspace);
  const domain = resolved.scaffoldDomain ? await inspectDomainScaffold(workspace, specialist) : [];
  const plan = buildSetupPlan(snapshot, resolved, domain, legacyInstructions);
  const result = (
    state: SetupCommandOutput["result"]["state"],
    operations: ReadonlyArray<SetupOperation>,
  ) => ({
    state,
    operations,
    specialist,
    activation: plan.legacyInstructions === "missing" ? "ready" as const : "migration_required" as const,
    ...(state === "changes_planned"
      ? { structure: buildSetupStructure(plan, "planned") }
      : state === "changes_applied" || state === "no_changes"
        ? { structure: buildSetupStructure(plan, "applied") }
        : {}),
    ...(state === "changes_applied" || state === "no_changes"
      ? { host_action: plan.legacyInstructions === "missing" ? HOST_ACTION_READY : HOST_ACTION_MIGRATION_REQUIRED }
      : {}),
  });

  if (plan.findings.some((finding) => finding.severity === "error")) return { result: result("user_action_required", plan.operations), findings: [...plan.findings] };
  if (plan.operations.length === 0) return { result: result("no_changes", []), findings: [...plan.findings] };
  if (options.dryRun) return { result: result("changes_planned", plan.operations), findings: [...plan.findings] };

  try {
    await applySetupPlan(plan, dependencies.applyOptions);
    return { result: result("changes_applied", plan.operations), findings: [...plan.findings] };
  } catch (error) {
    if (error instanceof SetupCancelledError) return { result: result("cancelled", plan.operations), findings: [...plan.findings] };
    if (error instanceof SetupStalePlanError) return { result: result("user_action_required", plan.operations), findings: [...plan.findings, { code: "setup.stale_plan", severity: "error", message: "Workspace state changed after inspection; setup stopped without overwriting the changed path.", location: error.operation.path, remediation: "Inspect the path and rerun setup." }] };
    if (error instanceof SetupVerificationError) return { result: result("execution_failure", plan.operations), findings: [...plan.findings, { code: "setup.verification_failed", severity: "error", message: error.message, remediation: "Inspect Workspace state before retrying setup." }] };
    throw error;
  }
}
