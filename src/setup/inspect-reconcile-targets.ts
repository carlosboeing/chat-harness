/**
 * Read-only MVP reconciliation target preflight and pure semantic preview.
 * This module never creates directories, stages, journals or managed files.
 * A future native-backed transaction must re-observe everything under its
 * exclusive lock; these optimistic preconditions are NOT mutation authority.
 */
import type { Finding } from "../cli/result.js";
import path from "node:path";
import { SPECIALISTS, selectSpecialists } from "../specialists/definitions.js";
import { AGENTS_MANAGED_MARKER, AGENTS_TEMPLATE } from "./templates.js";
import { buildDesiredManifest, exactByteDigest, parseManifest, previewManifestChanges,
  serializeManifest, type ContentDigest, type WorkspaceManifest } from "./manifest.js";
import { inspectManifestDisk, observeReadonlyManagedPath,
  type DiskEntry, type DiskKind, type ManifestDiskInspection } from "./inspect-manifest-disk.js";
import { WORKSPACE_MANAGED_MARKER, WORKSPACE_USER_MARKER,
  adoptUnmarkedWorkspaceInstructions, createWorkspaceInstructions,
  parseWorkspaceBoundary, recomposeWorkspaceInstructions } from "./workspace-boundary.js";
import { specialistSections } from "../specialists/definitions.js";

const MANIFEST_PATH = ".chat-harness/manifest.yaml";
const WORKSPACE_PATH = ".chat-harness/WORKSPACE.md";
const JOURNAL_PATH = ".chat-harness/temp/reconcile";

type Owner = "core" | "specialist" | "workspace";
export interface TargetFileObservation {
  path: string;
  kind: DiskKind;
  digest?: ContentDigest;
  /** Valid UTF-8 only, carried for lossless byte-preserving Workspace recomposition. */
  text?: string;
  /** Presence is never interpreted as machine ownership. */
  containsManagedMarker?: boolean;
}

export interface ReconcileTargetInspection {
  workspace: string;
  selectedIds: readonly string[];
  base: ManifestDiskInspection;
  manifestDigest?: ContentDigest;
  agents: TargetFileObservation | null;
  workspaceFile: TargetFileObservation | null;
  unownedProcedures: readonly TargetFileObservation[];
  findings: readonly Finding[];
}

export type ExpectedState =
  | { kind: "absent" }
  | { kind: "exact"; digest: ContentDigest };
export interface PreviewOperation {
  path: string;
  owner: string;
  action: "create" | "replace" | "remove" | "unchanged";
  expected: ExpectedState;
  afterDigest?: ContentDigest;
}
export interface SemanticReconcilePreview {
  /** False means there is no complete/approved preflight for mutation. */
  safeToPresent: boolean;
  /** Always false. This preview cannot be applied by any execution API. */
  executable: false;
  operations: readonly PreviewOperation[];
  findings: readonly Finding[];
  desiredManifest: WorkspaceManifest;
  sameDigestTransactionRequired: boolean;
}

export interface PreviewConsent {
  /** Adoption of an existing root instruction file without manifest ownership. */
  replaceAgents: boolean;
  /** Preserve every original byte of an unmarked Workspace after user marker. */
  adoptWorkspace: boolean;
}

const errorFinding = (code: string, location: string, message: string): Finding => ({
  code, location, message, severity: "error",
  remediation: "Review existing bytes and ownership, then rerun read-only preflight with explicit consent where applicable.",
});

function strictText(bytes: Buffer): string {
  // decode() rejects malformed UTF-8 instead of silently changing user bytes.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

async function target(workspace: string, relative: string, owner: Owner,
  findings: Finding[]): Promise<TargetFileObservation> {
  try {
    const observed: DiskEntry = await observeReadonlyManagedPath(workspace, relative, owner);
    const result: TargetFileObservation = { path: relative, kind: observed.kind };
    if (observed.bytes) {
      result.digest = exactByteDigest(observed.bytes);
      if (relative === WORKSPACE_PATH) {
        result.text = strictText(observed.bytes);
        result.containsManagedMarker = result.text.includes(WORKSPACE_MANAGED_MARKER) ||
          result.text.includes(WORKSPACE_USER_MARKER);
      }
      if (relative === "AGENTS.md") {
        result.containsManagedMarker = observed.bytes.subarray(0,
          Buffer.byteLength(AGENTS_MANAGED_MARKER)).equals(Buffer.from(AGENTS_MANAGED_MARKER));
      }
    }
    if (observed.kind === "unsafe" || observed.kind === "other" || observed.kind === "directory") {
      findings.push(errorFinding("setup.destination_collision", relative,
        "Target destination is not a regular file or absent."));
    }
    return result;
  } catch (error) {
    findings.push(errorFinding("setup.destination_unsafe", relative,
      "Read-only target inspection failed: " + String(error)));
    return { path: relative, kind: "unsafe" };
  }
}

/**
 * Observe desired destinations not present in a valid historical manifest.
 * Pending transactions and invalid manifests stop this phase entirely.
 */
export async function inspectReconcileTargets(
  workspace: string,
  specialistSelection: readonly string[] | "none",
  inspectedManifest?: ManifestDiskInspection,
): Promise<ReconcileTargetInspection> {
  const selectedIds = specialistSelection === "none" ? [] :
    selectSpecialists(specialistSelection).map(s => s.id);
  const base = inspectedManifest ?? await inspectManifestDisk(workspace);
  if (inspectedManifest && base.workspace !== path.resolve(workspace)) {
    throw new Error("Read-only manifest snapshot belongs to a different Workspace");
  }
  const findings = [...base.findings];
  const initial = (): ReconcileTargetInspection => ({
    workspace: base.workspace, selectedIds: Object.freeze([...selectedIds]),
    base, agents: null, workspaceFile: null, unownedProcedures: Object.freeze([]),
    findings: Object.freeze([...findings]),
  });
  if (base.transaction !== "absent" ||
      (base.manifestState !== "valid" && base.manifestState !== "missing") ||
      base.findings.some(f => f.severity === "error")) return initial();

  const agents = base.manifest ? null : await target(base.workspace, "AGENTS.md", "core", findings);
  const workspaceFile = await target(base.workspace, WORKSPACE_PATH, "workspace", findings);

  const installedPaths = new Set(base.files.map(f => f.path));
  const candidates = selectSpecialists(selectedIds)
    .flatMap(s => (s.procedures ?? []).map(p => p.path))
    .filter(p => !installedPaths.has(p)).sort();
  const unownedProcedures: TargetFileObservation[] = [];
  for (const relative of candidates) {
    const record = await target(base.workspace, relative, "specialist", findings);
    unownedProcedures.push(record);
    if (record.kind === "file") {
      findings.push(errorFinding("setup.unowned_procedure_collision", relative,
        "Existing Procedure is not manifest-owned; even a managed marker cannot authorize replacing it."));
    }
  }

  // Detect a concurrent new transaction, or manifest bytes replaced while
  // inspecting; never treat a mixed snapshot as an actionable preview.
  let manifestDigest: ContentDigest | undefined;
  try {
    const endLock = await observeReadonlyManagedPath(base.workspace, JOURNAL_PATH, "transaction");
    if (endLock.kind !== "missing") {
      findings.push(errorFinding("setup.inspection_stale", JOURNAL_PATH,
        "A reconciliation transaction appeared during inspection."));
    }
    const endManifest = await observeReadonlyManagedPath(base.workspace, MANIFEST_PATH, "workspace");
    if (base.manifest) {
      if (!endManifest.bytes ||
          JSON.stringify(parseManifest(strictText(endManifest.bytes))) !== JSON.stringify(base.manifest)) {
        throw new Error("Manifest content changed during inspection");
      }
      manifestDigest = exactByteDigest(endManifest.bytes);
    } else if (endManifest.kind !== "missing") {
      throw new Error("Manifest appeared during inspection");
    }
  } catch (error) {
    findings.push(errorFinding("setup.inspection_stale", MANIFEST_PATH,
      "Observed state changed or became unsafe: " + String(error)));
  }

  return {
    workspace: base.workspace, selectedIds: Object.freeze([...selectedIds]),
    base, ...(manifestDigest ? { manifestDigest } : {}),
    agents, workspaceFile, unownedProcedures: Object.freeze(unownedProcedures),
    findings: Object.freeze(findings),
  };
}

/** Pure preview; performs no filesystem access and cannot approve a transaction. */
export function buildReadonlySemanticPreview(
  inspected: ReconcileTargetInspection,
  releaseVersion: string,
  consent: PreviewConsent,
): SemanticReconcilePreview {
  const desiredManifest = buildDesiredManifest(releaseVersion, AGENTS_TEMPLATE, inspected.selectedIds);
  const findings: Finding[] = [...inspected.findings];
  const operations: PreviewOperation[] = [];
  const blocked = () => ({
    safeToPresent: false, executable: false as const,
    operations: Object.freeze([]) as readonly PreviewOperation[],
    findings: Object.freeze([...findings]), desiredManifest,
    sameDigestTransactionRequired: false,
  });
  if (inspected.base.transaction !== "absent" ||
      inspected.base.manifestState === "unsafe" ||
      inspected.base.manifestState === "invalid" ||
      inspected.base.manifestState === "not_inspected" ||
      findings.some(f => f.severity === "error")) return blocked();

  const previouslyOwned = new Map(inspected.base.files.map(r => [r.path, r]));
  let changes;
  try {
    changes = previewManifestChanges(inspected.base.manifest, desiredManifest);
  } catch (error) {
    findings.push(errorFinding("setup.owner_changed", MANIFEST_PATH, String(error)));
    return blocked();
  }
  const unowned = new Map(inspected.unownedProcedures.map(r => [r.path, r]));

  for (const change of changes) {
    const former = previouslyOwned.get(change.path);
    if (former) {
      if (former.state !== "clean") {
        findings.push(errorFinding("setup.recorded_drift", change.path,
          "Recorded owner file is missing, altered or unsafe."));
        continue;
      }
      operations.push({
        path: change.path, owner: change.owner, action: change.action,
        expected: { kind: "exact", digest: former.recordedDigest },
        ...(change.afterDigest ? { afterDigest: change.afterDigest } : {}),
      });
      continue;
    }
    if (change.path === "AGENTS.md") {
      const current = inspected.agents;
      if (!current || current.kind === "unsafe") {
        findings.push(errorFinding("setup.agents_uninspected", change.path,
          "No safe root AGENTS.md observation."));
        continue;
      }
      if (current.kind === "missing") {
        operations.push({ path: change.path, owner: "core", action: "create",
          expected: { kind: "absent" }, ...(change.afterDigest ? { afterDigest: change.afterDigest } : {}) });
      } else if (current.kind !== "file" || !current.digest) {
        findings.push(errorFinding("setup.agents_collision", change.path,
          "Root instructions have unexpected type."));
      } else if (!consent.replaceAgents) {
        findings.push(errorFinding("setup.agents_consent_required", change.path,
          current.containsManagedMarker
            ? "Legacy marked instructions have no manifest ownership; explicit adoption consent is required."
            : "Unmanaged instructions require explicit replacement consent."));
      } else {
        operations.push({ path: change.path, owner: "core",
          action: current.digest === change.afterDigest ? "unchanged" : "replace",
          expected: { kind: "exact", digest: current.digest }, ...(change.afterDigest ? { afterDigest: change.afterDigest } : {}) });
      }
      continue;
    }
    const current = unowned.get(change.path);
    if (current?.kind !== "missing") {
      findings.push(errorFinding("setup.procedure_collision", change.path,
        "New Procedure must be absent and outside historical manifest ownership."));
    } else {
      operations.push({ path: change.path, owner: change.owner, action: "create",
        expected: { kind: "absent" }, ...(change.afterDigest ? { afterDigest: change.afterDigest } : {}) });
    }
  }

  const currentWorkspace = inspected.workspaceFile;
  if (!currentWorkspace || currentWorkspace.kind === "unsafe") {
    findings.push(errorFinding("setup.workspace_uninspected", WORKSPACE_PATH,
      "Workspace instructions could not be safely observed."));
  } else if (currentWorkspace.kind === "missing") {
    const content = createWorkspaceInstructions(specialistSections(inspected.selectedIds));
    operations.push({ path: WORKSPACE_PATH, owner: "workspace", action: "create",
      expected: { kind: "absent" }, afterDigest: exactByteDigest(content) });
  } else if (currentWorkspace.kind !== "file" || currentWorkspace.text === undefined ||
             !currentWorkspace.digest) {
    findings.push(errorFinding("setup.workspace_type", WORKSPACE_PATH,
      "Workspace instructions have unexpected file type or encoding."));
  } else {
    const text = currentWorkspace.text;
    try {
      const sections = specialistSections(inspected.selectedIds);
      let content: string;
      if (currentWorkspace.containsManagedMarker) {
        parseWorkspaceBoundary(text); // rejects malformed, missing or duplicate sentinels
        content = recomposeWorkspaceInstructions(text, sections);
      } else if (consent.adoptWorkspace) {
        content = adoptUnmarkedWorkspaceInstructions(text, sections);
      } else {
        findings.push(errorFinding("setup.workspace_adoption_required", WORKSPACE_PATH,
          "Unmarked user instructions cannot be adopted without explicit consent."));
        content = text;
      }
      if (currentWorkspace.containsManagedMarker || consent.adoptWorkspace) {
        operations.push({ path: WORKSPACE_PATH, owner: "workspace",
          action: currentWorkspace.digest === exactByteDigest(content) ? "unchanged" : "replace",
          expected: { kind: "exact", digest: currentWorkspace.digest },
          afterDigest: exactByteDigest(content) });
      }
    } catch (error) {
      findings.push(errorFinding("setup.workspace_boundary_invalid", WORKSPACE_PATH, String(error)));
    }
  }

  const newManifestDigest = exactByteDigest(serializeManifest(desiredManifest));
  const oldDigest = inspected.manifestDigest;
  if (inspected.base.manifest && !oldDigest) {
    findings.push(errorFinding("setup.manifest_uninspected", MANIFEST_PATH,
      "Manifest exact bytes were not confirmed at end of inspection."));
  } else {
    operations.push({
      path: MANIFEST_PATH, owner: "manifest",
      action: oldDigest === undefined ? "create" : oldDigest === newManifestDigest ? "unchanged" : "replace",
      expected: oldDigest ? { kind: "exact", digest: oldDigest } : { kind: "absent" },
      afterDigest: newManifestDigest,
    });
  }

  if (findings.some(f => f.severity === "error")) return blocked();
  operations.sort((a, b) => a.path === MANIFEST_PATH ? 1 : b.path === MANIFEST_PATH ? -1 :
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    safeToPresent: true,
    executable: false,
    operations: Object.freeze(operations),
    findings: Object.freeze(findings),
    desiredManifest,
    sameDigestTransactionRequired: operations.some(op => op.owner !== "manifest" &&
      op.action !== "unchanged") && oldDigest === newManifestDigest,
  };
}
