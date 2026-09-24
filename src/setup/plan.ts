import type { Finding } from "../cli/result.js";
import {
  MANAGED_DIRECTORY_PATHS,
  type ManagedPath,
} from "../workspace/paths.js";
import type {
  ManagedPathObservation,
  WorkspaceInspection,
} from "../workspace/inspect.js";

export type SetupOperationAction = "create_directory" | "create_file";

export interface SetupOperation {
  action: SetupOperationAction;
  path: ManagedPath;
  reason: string;
}

export interface SetupPlan {
  workspace: string;
  operations: ReadonlyArray<SetupOperation>;
  findings: ReadonlyArray<Finding>;
  snapshot: WorkspaceInspection;
}

function expectedKind(path: ManagedPath): "directory" | "file" {
  return MANAGED_DIRECTORY_PATHS.has(path) ? "directory" : "file";
}

function collisionFinding(
  observation: ManagedPathObservation,
): Finding {
  const expected = expectedKind(observation.path);
  const unsafe = observation.kind === "symlink";
  return {
    code: unsafe ? "setup.symlink_collision" : "setup.path_collision",
    severity: "error",
    message: unsafe
      ? `Managed path is a symlink; automatic setup will not follow it.`
      : `Managed path must be a ${expected}, but found ${observation.kind}.`,
    location: observation.path,
    remediation:
      "Resolve the path manually, then rerun setup. Existing content will not be rewritten automatically.",
  };
}

export function buildSetupPlan(
  snapshot: WorkspaceInspection,
): SetupPlan {
  const findings: Finding[] = [];
  const operations: SetupOperation[] = [];

  for (const observation of snapshot.observations) {
    const expected = expectedKind(observation.path);

    if (observation.kind === "missing") {
      operations.push({
        action: expected === "directory" ? "create_directory" : "create_file",
        path: observation.path,
        reason:
          observation.path === "AGENTS.md"
            ? "Create the portable project instruction source."
            : observation.path === ".chat-harness/README.md"
              ? "Create the user-owned Workspace Map."
              : "Create minimal Chat Harness-owned workspace scaffolding.",
      });
      continue;
    }

    if (observation.kind !== expected) {
      findings.push(collisionFinding(observation));
    }
  }

  return Object.freeze({
    workspace: snapshot.workspace,
    operations: Object.freeze(operations),
    findings: Object.freeze(findings),
    snapshot,
  });
}
