import { loadSourcePolicy } from "./load.js";
import {
  matchPolicyRules,
  normalizeSourcePath,
  SourcePolicyPathError,
} from "./match.js";
import type { SourcePolicyResolution } from "./types.js";

export async function resolveSourcePolicy(
  workspace: string,
  sourcePath: string,
): Promise<SourcePolicyResolution> {
  let normalized: string;
  try {
    normalized = normalizeSourcePath(sourcePath);
  } catch (error) {
    return {
      state: "unavailable",
      code: "source_policy.invalid",
      reason:
        error instanceof SourcePolicyPathError
          ? error.message
          : "Source path could not be normalized.",
    };
  }

  const loaded = await loadSourcePolicy(workspace);
  if (loaded.state === "absent") {
    return {
      state: "absent",
      code: "source_policy.absent",
      reason: "Workspace has no Source Policy.",
    };
  }
  if (loaded.state === "unavailable") return loaded;

  const match = matchPolicyRules(loaded.policy.rules ?? [], normalized);
  if (match.conflict) {
    return {
      state: "unavailable",
      code: "source_policy.rule_conflict",
      reason: match.conflict,
    };
  }

  return {
    state: "resolved",
    privacy: match.privacy ?? loaded.policy.defaults?.privacy ?? "personal",
    matchedBy: match.kind ?? "default",
    ...(match.path ? { matchedPath: match.path } : {}),
  };
}

export async function readSourceWithPolicy<T>(
  workspace: string,
  sourcePath: string,
  readContent: () => Promise<T>,
): Promise<
  | { state: "read"; policy: SourcePolicyResolution; content: T }
  | { state: "blocked"; policy: SourcePolicyResolution }
> {
  const policy = await resolveSourcePolicy(workspace, sourcePath);
  if (policy.state === "unavailable") {
    return { state: "blocked", policy };
  }

  const content = await readContent();
  return { state: "read", policy, content };
}
