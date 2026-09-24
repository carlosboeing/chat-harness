import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import {
  applySetupPlan,
  SetupStalePlanError,
  SetupVerificationError,
  type ApplySetupOptions,
} from "./apply.js";
import { buildSetupPlan, type SetupOperation } from "./plan.js";

export interface SetupCommandOptions {
  dryRun: boolean;
}

export interface SetupCommandDependencies {
  inspect?: typeof inspectWorkspace;
  applyOptions?: ApplySetupOptions;
}

export interface SetupCommandOutput {
  result: {
    state:
      | "no_changes"
      | "changes_planned"
      | "changes_applied"
      | "user_action_required"
      | "execution_failure";
    operations: ReadonlyArray<SetupOperation>;
  };
  findings: Finding[];
}

export async function runSetup(
  workspace: string,
  options: SetupCommandOptions,
  dependencies: SetupCommandDependencies = {},
): Promise<SetupCommandOutput> {
  const inspect = dependencies.inspect ?? inspectWorkspace;
  const snapshot = await inspect(workspace);
  const plan = buildSetupPlan(snapshot);

  if (plan.findings.some((finding) => finding.severity === "error")) {
    return {
      result: {
        state: "user_action_required",
        operations: plan.operations,
      },
      findings: [...plan.findings],
    };
  }

  if (plan.operations.length === 0) {
    return {
      result: {
        state: "no_changes",
        operations: [],
      },
      findings: [],
    };
  }

  if (options.dryRun) {
    return {
      result: {
        state: "changes_planned",
        operations: plan.operations,
      },
      findings: [],
    };
  }

  try {
    await applySetupPlan(plan, dependencies.applyOptions);
    return {
      result: {
        state: "changes_applied",
        operations: plan.operations,
      },
      findings: [],
    };
  } catch (error) {
    if (error instanceof SetupStalePlanError) {
      return {
        result: {
          state: "user_action_required",
          operations: plan.operations,
        },
        findings: [
          {
            code: "setup.stale_plan",
            severity: "error",
            message:
              "Workspace state changed after inspection; setup stopped without overwriting the changed path.",
            location: error.operation.path,
            remediation: "Inspect the path and rerun setup.",
          },
        ],
      };
    }

    if (error instanceof SetupVerificationError) {
      return {
        result: {
          state: "execution_failure",
          operations: plan.operations,
        },
        findings: [
          {
            code: "setup.verification_failed",
            severity: "error",
            message: error.message,
            remediation:
              "Inspect the Workspace state before retrying setup.",
          },
        ],
      };
    }

    throw error;
  }
}
