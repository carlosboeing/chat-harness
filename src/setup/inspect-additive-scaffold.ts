/**
 * Additive scaffold is not manifest ownership. Inspection and preview are
 * read-only: pre-existing user directories and Source Policy remain untouched.
 * Do NOT feed this preview directly into filesystem mutation.
 */
import { lstat } from "node:fs/promises";
import type { Finding } from "../cli/result.js";
import { MANAGED_DIRECTORY_PATHS } from "../workspace/paths.js";
import { inspectManagedDestination } from "../workspace/managed-path-safety.js";
import { selectSpecialists } from "../specialists/definitions.js";
import type { ReconcileRequest } from "./reconcile-request.js";
import type { ReconcileTargetInspection } from "./inspect-reconcile-targets.js";
import { SOURCE_POLICY_TEMPLATE } from "./templates.js";
import { exactByteDigest, type ContentDigest } from "./manifest.js";

const SOURCE_POLICY = ".chat-harness/source-policy.yaml";
type ScaffoldKind = "directory" | "file";
type ObservedKind = ScaffoldKind | "missing" | "unsafe" | "collision";

export interface AdditiveScaffoldObservation {
  path: string;
  expectedKind: ScaffoldKind;
  actualKind: ObservedKind;
  origin: "core" | "specialist";
}

export interface AdditiveScaffoldInspection {
  workspace: string;
  blocked: boolean;
  observations: readonly AdditiveScaffoldObservation[];
  findings: readonly Finding[];
}

export interface AdditiveScaffoldOperation {
  path: string;
  action: "create_directory" | "create_file" | "unchanged";
  expected: "absent" | "existing_directory" | "existing_file";
  /** Only the create-once Source Policy has installed content bytes. */
  afterDigest?: ContentDigest;
}

export interface AdditiveScaffoldPreview {
  safeToPresent: boolean;
  executable: false;
  operations: readonly AdditiveScaffoldOperation[];
  findings: readonly Finding[];
}

const finding = (path: string, code: string, message: string): Finding => ({
  location: path, code, message, severity: "error",
  remediation: "Review the existing path. Scaffold is additive and cannot replace user data.",
});

function destinations(request: ReconcileRequest): Array<{ path: string; expectedKind: ScaffoldKind; origin: "core" | "specialist" }> {
  const map = new Map<string, { path: string; expectedKind: ScaffoldKind; origin: "core" | "specialist" }>();
  for (const name of MANAGED_DIRECTORY_PATHS) {
    map.set(name.toLowerCase(), { path: name, expectedKind: "directory", origin: "core" });
  }
  map.set(SOURCE_POLICY.toLowerCase(), { path: SOURCE_POLICY, expectedKind: "file", origin: "core" });
  if (request.scaffoldDomain) {
    for (const spec of selectSpecialists(request.desiredSpecialists)) {
      for (const name of spec.scaffold ?? []) {
        const key = name.normalize("NFC").toLowerCase();
        const existing = map.get(key);
        if (existing && existing.path !== name) {
          throw new Error("Aliased Specialist scaffold name: " + name);
        }
        if (!existing) map.set(key, { path: name, expectedKind: "directory", origin: "specialist" });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/**
 * Must use the same desired set as the target snapshot. Pending transaction,
 * invalid manifest or earlier collision short-circuits all scaffold reads.
 */
export async function inspectAdditiveScaffold(
  targets: ReconcileTargetInspection,
  request: ReconcileRequest,
): Promise<AdditiveScaffoldInspection> {
  const errors: Finding[] = [...targets.findings];
  const selected = selectSpecialists(request.desiredSpecialists).map(x => x.id);
  if (selected.join(",") !== targets.selectedIds.join(",")) {
    errors.push(finding("specialists", "setup.selection_changed",
      "Requested Specialist set does not match the inspected desired set."));
  }
  const blocked = targets.base.transaction !== "absent" ||
    (targets.base.manifestState !== "missing" && targets.base.manifestState !== "valid") ||
    errors.some(f => f.severity === "error");
  if (blocked) return {
    workspace: targets.workspace, blocked: true,
    observations: Object.freeze([]), findings: Object.freeze(errors),
  };

  const observations: AdditiveScaffoldObservation[] = [];
  let paths;
  try {
    paths = destinations(request);
  } catch (error) {
    errors.push(finding("specialists", "setup.scaffold_invalid", String(error)));
    return { workspace: targets.workspace, blocked: true,
      observations: Object.freeze([]), findings: Object.freeze(errors) };
  }

  for (const item of paths) {
    let kind: ObservedKind = "unsafe";
    try {
      const absolute = await inspectManagedDestination(targets.workspace, item.path, "scaffold");
      try {
        const stat = await lstat(absolute);
        if (stat.isSymbolicLink()) kind = "unsafe";
        else if (stat.isDirectory()) kind = "directory";
        else if (stat.isFile()) kind = "file";
        else kind = "collision";
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") kind = "missing";
        else throw error;
      }
      if (kind === "missing" || kind === item.expectedKind) {
        observations.push({ ...item, actualKind: kind });
        continue;
      }
      errors.push(finding(item.path, "setup.scaffold_collision",
        "Additive scaffold path has the wrong type or an unsafe link."));
    } catch (error) {
      errors.push(finding(item.path, "setup.scaffold_unsafe", String(error)));
    }
    observations.push({ ...item, actualKind: kind });
  }

  // The observations are advisory, not a filesystem reservation. Another
  // editor may still alter any path; apply must enforce no-clobber itself.
  return { workspace: targets.workspace, blocked: errors.some(f => f.severity === "error"),
    observations: Object.freeze(observations), findings: Object.freeze(errors) };
}

/** A pure, non-executable preview; wrong-type paths suppress the whole plan. */
export function previewAdditiveScaffold(snapshot: AdditiveScaffoldInspection): AdditiveScaffoldPreview {
  if (snapshot.blocked || snapshot.findings.some(f => f.severity === "error")) {
    return { safeToPresent: false, executable: false, operations: Object.freeze([]),
      findings: Object.freeze([...snapshot.findings]) };
  }
  const operations: AdditiveScaffoldOperation[] = snapshot.observations.map(entry => {
    if (entry.actualKind === "missing") {
      if (entry.expectedKind === "directory") return {
        path: entry.path, action: "create_directory", expected: "absent",
      };
      return { path: entry.path, action: "create_file", expected: "absent",
        afterDigest: exactByteDigest(SOURCE_POLICY_TEMPLATE) };
    }
    return {
      path: entry.path, action: "unchanged",
      expected: entry.expectedKind === "directory" ? "existing_directory" : "existing_file",
    };
  });
  return { safeToPresent: true, executable: false, operations: Object.freeze(operations),
    findings: Object.freeze([...snapshot.findings]) };
}
