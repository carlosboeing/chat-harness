/**
 * One end-to-end, mutation-free MVP reconciliation preview.
 *
 * The ordered operations contain exact optimistic preconditions and rendered
 * bytes for future transaction design, but this module DOES NOT grant mutation
 * authority and must never be called as an apply procedure. Native no-replace
 * execution must independently re-prove paths, ownership and content.
 */
import type { Finding } from "../cli/result.js";
import { selectSpecialists, specialistSections, validateSpecialistRegistry } from "../specialists/definitions.js";
import { exactByteDigest, serializeManifest, type ContentDigest } from "./manifest.js";
import { inspectManifestDisk, observeReadonlyManagedPath } from "./inspect-manifest-disk.js";
import { inspectReconcileTargets, buildReadonlySemanticPreview, type ReconcileTargetInspection,
  type ExpectedState, type SemanticReconcilePreview } from "./inspect-reconcile-targets.js";
import { inspectAdditiveScaffold, previewAdditiveScaffold, type AdditiveScaffoldPreview } from "./inspect-additive-scaffold.js";
import { resolveReconcileRequest, type ReconcileRequest, type ReconcileSelectionOptions } from "./reconcile-request.js";
import { AGENTS_TEMPLATE, SOURCE_POLICY_TEMPLATE } from "./templates.js";
import { adoptUnmarkedWorkspaceInstructions, createWorkspaceInstructions,
  recomposeWorkspaceInstructions } from "./workspace-boundary.js";

const MANIFEST = ".chat-harness/manifest.yaml";
const WORKSPACE = ".chat-harness/WORKSPACE.md";
const RECONCILE_LOCK = ".chat-harness/temp/reconcile";
const SOURCE_POLICY = ".chat-harness/source-policy.yaml";

export type CombinedAction = "create_directory" | "create_file" | "replace_file" |
  "remove_file" | "unchanged";
export type CombinedExpected =
  | { kind: "absent" }
  | { kind: "exact_file"; digest: ContentDigest }
  | { kind: "existing_file" }
  | { kind: "existing_directory" };

export interface CombinedOperation {
  path: string;
  owner: string;
  action: CombinedAction;
  expected: CombinedExpected;
  /** Present only when the desired bytes are known. */
  afterDigest?: ContentDigest;
  /** Exact bytes rendered now; required for every proposed file create/replace. */
  content?: string;
}

export interface CombinedReadonlyPlan {
  workspace: string;
  request: ReconcileRequest | null;
  safeToPresent: boolean;
  /** Deliberately impossible to run as a transaction. */
  executable: false;
  operations: readonly CombinedOperation[];
  findings: readonly Finding[];
  sameDigestTransactionRequired: boolean;
}

function conflict(code: string, location: string, message: string): Finding {
  return { code, location, message, severity: "error",
    remediation: "Preserve existing files; resolve the conflict and run read-only preflight again." };
}

function fromExpected(expected: ExpectedState): CombinedExpected {
  return expected.kind === "absent" ? { kind: "absent" } :
    { kind: "exact_file", digest: expected.digest };
}

function fileAction(action: "create" | "replace" | "remove" | "unchanged"): CombinedAction {
  return action === "create" ? "create_file" :
    action === "replace" ? "replace_file" :
    action === "remove" ? "remove_file" : "unchanged";
}

function renderedFiles(
  targets: ReconcileTargetInspection,
  preview: SemanticReconcilePreview,
  request: ReconcileRequest,
): Map<string, string> {
  const files = new Map<string, string>();
  files.set("AGENTS.md", AGENTS_TEMPLATE);
  const sections = specialistSections(request.desiredSpecialists);
  for (const spec of selectSpecialists(request.desiredSpecialists)) {
    for (const proc of spec.procedures ?? []) {
      if (files.has(proc.path)) throw new Error("Duplicate desired Procedure bytes: " + proc.path);
      files.set(proc.path, proc.content);
    }
  }

  const existing = targets.workspaceFile;
  if (existing?.kind === "missing") {
    files.set(WORKSPACE, createWorkspaceInstructions(sections));
  } else if (existing?.kind === "file" && existing.text !== undefined) {
    files.set(WORKSPACE, existing.containsManagedMarker
      ? recomposeWorkspaceInstructions(existing.text, sections)
      : adoptUnmarkedWorkspaceInstructions(existing.text, sections));
  }

  files.set(MANIFEST, serializeManifest(preview.desiredManifest));
  files.set(SOURCE_POLICY, SOURCE_POLICY_TEMPLATE);
  return files;
}

/** Deterministic parent-first order for required and optional directories. */
function sortDirectories(a: CombinedOperation, b: CombinedOperation): number {
  const depth = (p: string) => p.split("/").length;
  return depth(a.path) - depth(b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/**
 * Combine two independently pure previews. A global conflict suppresses all
 * operations; no partial approval can be inferred from any prior slice.
 */
export function combineReadonlyPreviews(
  targets: ReconcileTargetInspection,
  request: ReconcileRequest,
  managed: SemanticReconcilePreview,
  additive: AdditiveScaffoldPreview,
): CombinedReadonlyPlan {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const item of [...managed.findings, ...additive.findings]) {
    const key = [item.code, item.location, item.message].join("\0");
    if (!seen.has(key)) { seen.add(key); findings.push(item); }
  }
  const base = { workspace: targets.workspace, request, executable: false as const };
  const fail = (): CombinedReadonlyPlan => ({
    ...base, safeToPresent: false, operations: Object.freeze([]),
    findings: Object.freeze([...findings]), sameDigestTransactionRequired: false,
  });

  if (targets.base.transaction !== "absent" || targets.base.manifestState === "not_inspected" ||
      targets.base.manifestState === "invalid" || targets.base.manifestState === "unsafe" ||
      !managed.safeToPresent || !additive.safeToPresent) return fail();

  // The first managed markers without a schema-1 manifest are unequivocal
  // unsupported pre-v1/partial state; explicit consent cannot turn them into
  // trustworthy ownership or guess a prior transaction outcome.
  if (targets.base.manifestState === "missing") {
    if (targets.agents?.kind === "file" && targets.agents.containsManagedMarker) {
      findings.push(conflict("setup.unsupported_legacy_state", "AGENTS.md",
        "Chat Harness-marked Core instructions exist without a supported manifest; migrate manually."));
    }
    if (targets.workspaceFile?.kind === "file" && targets.workspaceFile.containsManagedMarker) {
      findings.push(conflict("setup.unsupported_legacy_state", WORKSPACE,
        "Chat Harness Workspace ownership markers exist without a supported manifest; migrate manually."));
    }
  }
  if (findings.some(f => f.severity === "error")) return fail();

  const directories: CombinedOperation[] = [];
  const scaffoldFiles: CombinedOperation[] = [];
  for (const op of additive.operations) {
    const expected: CombinedExpected = op.expected === "absent" ? { kind: "absent" } :
      op.expected === "existing_directory" ? { kind: "existing_directory" } :
      { kind: "existing_file" };
    const mapped: CombinedOperation = {
      path: op.path, owner: "scaffold", action: op.action,
      expected, ...(op.afterDigest ? { afterDigest: op.afterDigest } : {}),
    };
    if (op.action === "create_directory" || op.expected === "existing_directory") directories.push(mapped);
    else scaffoldFiles.push(mapped);
  }

  const managedFiles: CombinedOperation[] = [];
  let manifest: CombinedOperation | undefined;
  for (const op of managed.operations) {
    const candidate: CombinedOperation = {
      path: op.path, owner: op.owner, action: fileAction(op.action),
      expected: fromExpected(op.expected),
      ...(op.afterDigest ? { afterDigest: op.afterDigest } : {}),
    };
    if (candidate.path === MANIFEST) manifest = candidate;
    else managedFiles.push(candidate);
  }
  if (!manifest) {
    findings.push(conflict("setup.manifest_unplanned", MANIFEST,
      "A complete semantic preview must contain one final manifest operation."));
    return fail();
  }

  const rendered = renderedFiles(targets, managed, request);
  const operations = [
    ...directories.sort(sortDirectories),
    ...scaffoldFiles.sort((a, b) => a.path.localeCompare(b.path, "en")),
    ...managedFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    manifest,
  ];
  const visited = new Set<string>();
  for (const operation of operations) {
    if (visited.has(operation.path)) {
      findings.push(conflict("setup.duplicate_destination", operation.path,
        "Two semantic operations target the same path."));
      continue;
    }
    visited.add(operation.path);
    if (operation.action === "create_file" || operation.action === "replace_file") {
      const content = rendered.get(operation.path);
      if (content === undefined || !operation.afterDigest ||
          exactByteDigest(content) !== operation.afterDigest) {
        findings.push(conflict("setup.rendered_digest_mismatch", operation.path,
          "Missing desired file bytes or digest does not match the rendered payload."));
      } else {
        operation.content = content;
      }
    }
    if (operation.action === "remove_file" && operation.expected.kind !== "exact_file") {
      findings.push(conflict("setup.removal_without_owner_digest", operation.path,
        "A removal must carry recorded exact last-applied file identity."));
    }
    if (operation.action === "create_directory" && operation.expected.kind !== "absent") {
      findings.push(conflict("setup.scaffold_precondition_invalid", operation.path,
        "Directory creation requires observed absence."));
    }
  }
  if (findings.some(f => f.severity === "error")) return fail();
  return {
    ...base, safeToPresent: true, operations: Object.freeze(operations),
    findings: Object.freeze([...findings]),
    sameDigestTransactionRequired: managed.sameDigestTransactionRequired,
  };
}

export async function inspectAndPlanReadonlyReconciliation(
  workspace: string,
  options: ReconcileSelectionOptions,
  releaseVersion: string,
): Promise<CombinedReadonlyPlan> {
  // The transaction reservation is observed first, before even resolving an
  // omitted Specialist selection or inspecting any legacy Workspace content.
  const base = await inspectManifestDisk(workspace);
  const stop = (findings: Finding[]): CombinedReadonlyPlan => ({
    workspace: base.workspace, request: null, safeToPresent: false,
    executable: false, operations: Object.freeze([]),
    findings: Object.freeze(findings), sameDigestTransactionRequired: false,
  });
  if (base.transaction !== "absent" ||
      (base.manifestState !== "valid" && base.manifestState !== "missing") ||
      base.findings.some(f => f.severity === "error")) return stop([...base.findings]);

  const registryIssues = validateSpecialistRegistry();
  if (registryIssues.length) {
    return stop(registryIssues.map(issue => conflict("setup.registry_invalid", "specialists", issue)));
  }
  const request = resolveReconcileRequest(options, base.manifest);
  const targets = await inspectReconcileTargets(base.workspace, request.desiredSpecialists, base);
  const managed = buildReadonlySemanticPreview(targets, releaseVersion, {
    adoptWorkspace: request.adoptWorkspace, replaceAgents: request.replaceAgents,
  });
  if (!managed.safeToPresent) {
    return { workspace: base.workspace, request, safeToPresent: false,
      executable: false, operations: Object.freeze([]),
      findings: managed.findings, sameDigestTransactionRequired: false };
  }
  const scaffold = await inspectAdditiveScaffold(targets, request);
  const additive = previewAdditiveScaffold(scaffold);
  const combined = combineReadonlyPreviews(targets, request, managed, additive);
  if (!combined.safeToPresent) return combined;

  // Last observational check: concurrent transaction/manifest changes must
  // invalidate the preview. All other optimistic checks still require fresh
  // native descriptor-anchored verification before any future actual write.
  try {
    const lock = await observeReadonlyManagedPath(base.workspace, RECONCILE_LOCK, "transaction");
    if (lock.kind !== "missing") {
      throw new Error("Reconciliation reservation appeared during read-only planning.");
    }
    const currentManifest = await observeReadonlyManagedPath(base.workspace, MANIFEST, "workspace");
    if (base.manifest) {
      if (!currentManifest.bytes || !targets.manifestDigest ||
          exactByteDigest(currentManifest.bytes) !== targets.manifestDigest) {
        throw new Error("Manifest bytes changed during read-only planning.");
      }
    } else if (currentManifest.kind !== "missing") {
      throw new Error("Manifest appeared during read-only planning.");
    }
  } catch (error) {
    return { ...combined, safeToPresent: false, operations: Object.freeze([]),
      findings: Object.freeze([...combined.findings, conflict("setup.inspection_stale", MANIFEST, String(error))]),
      sameDigestTransactionRequired: false };
  }
  return combined;
}
