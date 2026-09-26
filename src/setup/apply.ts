import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { absoluteSetupPath, expectedManagedKind, MANAGED_PATHS } from "../workspace/paths.js";
import { assertContainedPath } from "../workspace/safety.js";
import type { SetupOperation, SetupPlan } from "./plan.js";

export class SetupStalePlanError extends Error {
  constructor(readonly operation: SetupOperation) { super(`Setup path changed after inspection: ${operation.path}`); this.name = "SetupStalePlanError"; }
}
export class SetupVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "SetupVerificationError"; }
}
export interface ApplySetupOptions {
  beforeApply?: (plan: SetupPlan) => Promise<void> | void;
  inspect?: typeof inspectWorkspace;
}

async function applyOperation(workspace: string, operation: SetupOperation): Promise<void> {
  const target = absoluteSetupPath(workspace, operation.path);
  assertContainedPath(workspace, target);
  if (operation.action === "create_directory") {
    try { await mkdir(target, { recursive: false }); }
    catch (error) {
      if (error instanceof Error && "code" in error && ["EEXIST", "ELOOP", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new SetupStalePlanError(operation);
      throw error;
    }
    return;
  }
  if (operation.action === "replace_file") {
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new SetupStalePlanError(operation);
      const current = await readFile(target, "utf8");
      if (operation.expectedContent === undefined || current !== operation.expectedContent) throw new SetupStalePlanError(operation);
      await writeFile(target, operation.content ?? "", { encoding: "utf8", flag: "w" });
    } catch (error) {
      if (error instanceof SetupStalePlanError) throw error;
      if (error instanceof Error && "code" in error && ["ENOENT", "ELOOP", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new SetupStalePlanError(operation);
      throw error;
    }
    return;
  }
  try { await writeFile(target, operation.content ?? "", { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if (error instanceof Error && "code" in error && ["EEXIST", "ELOOP", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new SetupStalePlanError(operation);
    throw error;
  }
}

function coreVerification(inspection: Awaited<ReturnType<typeof inspectWorkspace>>): Finding[] {
  return inspection.observations.flatMap((observation) =>
    observation.kind === expectedManagedKind(observation.path) ? [] : [{
      code: "setup.verification_failed", severity: "error" as const,
      message: "Managed path did not match expected post-setup state.", location: observation.path,
    }]
  );
}

async function domainVerification(plan: SetupPlan): Promise<Finding[]> {
  const core = new Set<string>(MANAGED_PATHS);
  const findings: Finding[] = [];
  for (const operation of plan.operations) {
    if (core.has(operation.path) || operation.action !== "create_directory") continue;
    const target = absoluteSetupPath(plan.workspace, operation.path);
    try { if (!(await lstat(target)).isDirectory()) throw new Error("wrong-type"); }
    catch { findings.push({ code: "setup.verification_failed", severity: "error", message: "Optional domain scaffold path was not a directory after setup.", location: operation.path }); }
  }
  return findings;
}

export async function applySetupPlan(plan: SetupPlan, options: ApplySetupOptions = {}): Promise<void> {
  await options.beforeApply?.(plan);
  for (const operation of plan.operations) await applyOperation(plan.workspace, operation);
  const inspect = options.inspect ?? inspectWorkspace;
  const findings = [...coreVerification(await inspect(plan.workspace)), ...(await domainVerification(plan))];
  if (findings.length > 0) throw new SetupVerificationError(findings[0]!.message);
}
