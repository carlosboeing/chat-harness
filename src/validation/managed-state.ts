/**
 * Supported manifest-state health checks shared by validate and doctor.
 * Never makes changes or recovers a pending reconciliation transaction.
 *
 * Legacy pre-v1 workspaces without a manifest retain the existing validation
 * path until the new setup contract is activated. A pending transaction must
 * nevertheless be reported first, even when no manifest exists.
 */
import { CORE_VERSION,AGENTS_MANAGED_MARKER } from "../setup/templates.js";
import { SPECIALISTS } from "../specialists/definitions.js";
import { legacyLayoutFindings } from "./legacy-state.js";
import type { Finding } from "../cli/result.js";
import { inspectManifestDisk, observeReadonlyManagedPath } from "../setup/inspect-manifest-disk.js";
import { parseWorkspaceBoundary } from "../setup/workspace-boundary.js";
import { inspectPendingJournalHealth } from "./pending-journal.js";

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
  if (inspected.transaction === "pending") {
    findings.push(...await inspectPendingJournalHealth(inspected.workspace,inspected.findings.some(f=>f.location === ".chat-harness/temp/reconcile-cleanup") ? ".chat-harness/temp/reconcile-cleanup" : ".chat-harness/temp/reconcile"));
    return findings;
  }
  if (inspected.transaction !== "absent") return findings;
  findings.push(...await legacyLayoutFindings(workspace));
  if(inspected.manifestState === "missing") {
    for(const [relative,fileOwner,marker] of [["AGENTS.md","core",AGENTS_MANAGED_MARKER],[WORKSPACE,"workspace","<!-- chat-harness-managed: workspace -->"]] as const){
      try{
        const file=await observeReadonlyManagedPath(inspected.workspace,relative,fileOwner);
        if(file.bytes?.toString("utf8").startsWith(marker))findings.push(conflict("setup.legacy_workspace_unsupported",".chat-harness/manifest.yaml","Chat Harness markers without a supported manifest do not prove managed ownership; explicit migration is required."));
      }catch(error){findings.push(conflict("setup.managed_path_unsafe",relative,String(error)));}
    }
  }
  if (inspected.manifestState !== "valid") return findings;
  if(inspected.manifest!.core.version < CORE_VERSION)findings.push({code:"setup.core_outdated",severity:"warning",location:"AGENTS.md",message:"Installed Core is older than the bundled component.",remediation:"Preview setup to reconcile the managed Core and refresh manual host bindings."});
  for(const [id,component] of Object.entries(inspected.manifest!.specialists))if(component.version < SPECIALISTS[id as keyof typeof SPECIALISTS].version)
    findings.push({code:"setup.specialist_outdated",severity:"warning",location:id,message:"Installed Specialist is older than the bundled component.",remediation:"Preview setup to update the installed desired set."});

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
