/**
 * Supported manifest-state health checks shared by validate and doctor.
 * Never makes changes or recovers a pending reconciliation transaction.
 *
 * Legacy pre-v1 workspaces without a manifest retain the existing validation
 * path until the new setup contract is activated. A pending transaction must
 * nevertheless be reported first, even when no manifest exists.
 */
import type { Finding } from "../cli/result.js";
import { inspectManifestDisk, observeReadonlyManagedPath } from "../setup/inspect-manifest-disk.js";
import { parseWorkspaceBoundary } from "../setup/workspace-boundary.js";

const WORKSPACE = ".chat-harness/WORKSPACE.md";

function conflict(code: string, location: string, message: string): Finding {
  return {
    code, location, message, severity: "error",
    remediation: "Preserve existing bytes and resolve the reported state before reconciling this Workspace.",
  };
}

export async function managedStateHealthFindings(workspace: string): Promise<Finding[]> {
  const inspected = await inspectManifestDisk(workspace);
  const findings: Finding[] = [...inspected.findings];

  // Fail closed: the transaction journal may own partial outputs. Never
  // classify them as a new or corrupt installation or attempt recovery.
  if (inspected.transaction !== "absent") return findings;
  if (inspected.manifestState !== "valid") return findings;

  // The recorded Core/Procedure files, historical paths, SHA-256 ownership,
  // markers and case aliases have already been inspected above.
  try {
    const observed = await observeReadonlyManagedPath(inspected.workspace, WORKSPACE, "workspace");
    if (observed.kind === "missing") {
      findings.push(conflict("workspace.instructions_missing", WORKSPACE,
        "Manifest-backed Workspace instructions are missing."));
    } else if (observed.kind !== "file" || !observed.bytes) {
      findings.push(conflict("workspace.instructions_type", WORKSPACE,
        "Manifest-backed Workspace instructions must be a regular file, not a link or directory."));
    } else {
      try {
        const contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(observed.bytes);
        parseWorkspaceBoundary(contents);
      } catch (error) {
        findings.push(conflict("workspace.boundary_invalid", WORKSPACE,
          "Manifest-backed Workspace ownership markers or encoding are invalid: " + String(error)));
      }
    }
  } catch (error) {
    findings.push(conflict("workspace.instructions_unsafe", WORKSPACE,
      "Could not safely observe Workspace instructions: " + String(error)));
  }

  // Re-check for a transaction appearing during inspection. The entire health
  // snapshot is advisory; an eventual mutator must recheck all identities.
  try {
    const journal = await observeReadonlyManagedPath(
      inspected.workspace, ".chat-harness/temp/reconcile", "transaction");
    if (journal.kind !== "missing") {
      findings.push(conflict("setup.inspection_stale", ".chat-harness/temp/reconcile",
        "Reconciliation transaction appeared during validation; rerun after authorized recovery."));
    }
  } catch (error) {
    findings.push(conflict("setup.inspection_stale", ".chat-harness/temp/reconcile",
      "Transaction path became unsafe during validation: " + String(error)));
  }
  return findings.sort((a, b) =>
    (a.location ?? "").localeCompare(b.location ?? "") || a.code.localeCompare(b.code));
}
