import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";

import {
  formatSchemaErrors,
  validateSourcePolicyV1,
} from "../validation/schema.js";
import { findStaticRuleConflicts, parsePolicyPath } from "./match.js";
import type { SourcePolicyV1 } from "./types.js";

export type LoadPolicyResult =
  | { state: "loaded"; policy: SourcePolicyV1 }
  | { state: "absent" }
  | {
      state: "unavailable";
      code:
        | "source_policy.invalid"
        | "source_policy.unsupported_version"
        | "source_policy.unreadable"
        | "source_policy.rule_conflict";
      reason: string;
    };

export async function loadSourcePolicy(
  workspace: string,
): Promise<LoadPolicyResult> {
  const file = path.join(workspace, ".chat-harness", "source-policy.yaml");
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { state: "absent" };
    }
    return {
      state: "unavailable",
      code: "source_policy.unreadable",
      reason: "Source Policy could not be read.",
    };
  }

  const document = parseDocument(source, { uniqueKeys: true, strict: true });
  if (document.errors.length > 0) {
    return {
      state: "unavailable",
      code: "source_policy.invalid",
      reason: document.errors.map((error) => error.message).join("; "),
    };
  }

  const value = document.toJS();
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      state: "unavailable",
      code: "source_policy.invalid",
      reason: "Source Policy must be a mapping.",
    };
  }

  const objectValue = value as Record<string, unknown>;
  if (objectValue.version !== 1) {
    return {
      state: "unavailable",
      code: "source_policy.unsupported_version",
      reason: "Only Source Policy version 1 is supported.",
    };
  }

  if (!validateSourcePolicyV1(objectValue)) {
    return {
      state: "unavailable",
      code: "source_policy.invalid",
      reason: formatSchemaErrors(validateSourcePolicyV1.errors),
    };
  }

  const policy = objectValue as unknown as SourcePolicyV1;
  try {
    for (const rule of policy.rules ?? []) {
      parsePolicyPath(rule.match.path);
    }
    const conflicts = findStaticRuleConflicts(policy.rules ?? []);
    if (conflicts.length > 0) {
      return {
        state: "unavailable",
        code: "source_policy.rule_conflict",
        reason: `Conflicting rules: ${[...new Set(conflicts)].sort().join(", ")}`,
      };
    }
  } catch (error) {
    return {
      state: "unavailable",
      code: "source_policy.invalid",
      reason: error instanceof Error ? error.message : "Invalid Source Policy path.",
    };
  }

  return { state: "loaded", policy };
}
