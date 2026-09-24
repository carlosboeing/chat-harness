import { mkdir, writeFile } from "node:fs/promises";

import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { absoluteManagedPath } from "../workspace/paths.js";
import { assertContainedPath } from "../workspace/safety.js";
import type { SetupOperation, SetupPlan } from "./plan.js";
import { AGENTS_TEMPLATE, WORKSPACE_MAP_TEMPLATE } from "./templates.js";

export class SetupStalePlanError extends Error {
  constructor(readonly operation: SetupOperation) {
    super(
      `Managed path changed after inspection: ${operation.path}`,
    );
    this.name = "SetupStalePlanError";
  }
}

export class SetupVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupVerificationError";
  }
}

export interface ApplySetupOptions {
  beforeApply?: (plan: SetupPlan) => Promise<void> | void;
  inspect?: typeof inspectWorkspace;
}

async function createOperation(
  workspace: string,
  operation: SetupOperation,
): Promise<void> {
  const target = absoluteManagedPath(workspace, operation.path);
  assertContainedPath(workspace, target);

  if (operation.action === "create_directory") {
    try {
      await mkdir(target, { recursive: false });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["EEXIST", "ELOOP"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      ) {
        throw new SetupStalePlanError(operation);
      }
      throw error;
    }
    return;
  }

  const content =
    operation.path === "AGENTS.md"
      ? AGENTS_TEMPLATE
      : WORKSPACE_MAP_TEMPLATE;

  try {
    await writeFile(target, content, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["EEXIST", "ELOOP"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      throw new SetupStalePlanError(operation);
    }
    throw error;
  }
}

function verificationFindings(
  plan: SetupPlan,
  inspection: Awaited<ReturnType<typeof inspectWorkspace>>,
): Finding[] {
  const expected = new Map([
    ["AGENTS.md", "file"],
    [".chat-harness", "directory"],
    [".chat-harness/README.md", "file"],
    [".chat-harness/workstreams", "directory"],
  ]);

  const findings: Finding[] = [];
  for (const observation of inspection.observations) {
    if (observation.kind !== expected.get(observation.path)) {
      findings.push({
        code: "setup.verification_failed",
        severity: "error",
        message: "Managed path did not match the expected post-setup state.",
        location: observation.path,
      });
    }
  }

  return findings;
}

export async function applySetupPlan(
  plan: SetupPlan,
  options: ApplySetupOptions = {},
): Promise<void> {
  await options.beforeApply?.(plan);

  for (const operation of plan.operations) {
    await createOperation(plan.workspace, operation);
  }

  const inspect = options.inspect ?? inspectWorkspace;
  const after = await inspect(plan.workspace);
  const findings = verificationFindings(plan, after);
  if (findings.length > 0) {
    throw new SetupVerificationError(findings[0]!.message);
  }
}
