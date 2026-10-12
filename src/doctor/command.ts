import { readFile } from "node:fs/promises";
import path from "node:path";
import { inspectManifestDisk } from "../setup/inspect-manifest-disk.js";
import { SPECIALISTS } from "../specialists/definitions.js";
import type { Finding } from "../cli/result.js";
import { managedStateHealthFindings } from "../validation/managed-state.js";
import {
  detectInstallationMode,
  gitFindings,
  hostedStateFindings,
  localIntegrityFindings,
  runtimeFindings,
  scaffoldFindings,
  workspaceAccessFindings,
  type AccessCheck,
  type RuntimeFacts,
} from "./checks.js";

export interface DoctorDependencies {
  runtimeFacts?: RuntimeFacts;
  accessCheck?: AccessCheck;
}

function defaultRuntimeFacts(): RuntimeFacts {
  const versions = process.versions as NodeJS.ProcessVersions & {
    bun?: string;
  };
  return {
    execPath: process.execPath,
    nodeVersion: process.versions.node,
    ...(versions.bun ? { bunVersion: versions.bun } : {}),
  };
}

async function recommendedCapabilities(workspace:string):Promise<Finding[]>{
 const state=await inspectManifestDisk(workspace);
 if(state.transaction!=="absent" || !state.manifest)return [];
 const recommended=[...new Set(Object.keys(state.manifest.specialists).flatMap(id=>SPECIALISTS[id as keyof typeof SPECIALISTS].capabilities?.recommended??[]))].sort();
 if(!recommended.length)return [];
 const declared=new Set<string>();
 for(const registry of ["registry.json","extensions/github/registry.json"]){
  try {const parsed=JSON.parse(await readFile(path.join(workspace,registry),"utf8"));for(const id of Object.keys(parsed.capabilities??{}))declared.add(id);}catch{/* Local integrity reports invalid registries separately. */}
 }
 return recommended.filter(id=>!declared.has(id)).map(id=>({code:"capability.recommended_missing",severity:"warning",location:id,
  message:"Recommended capability is not verified in a local registry; host-provided availability cannot be inferred locally. Specialist guidance remains usable.",remediation:"Optionally provide the recommended capability through an authorized host integration; it is not a setup dependency."}));
}

export async function runDoctor(
  workspace: string,
  dependencies: DoctorDependencies = {},
) {
  const runtimeFacts = dependencies.runtimeFacts ?? defaultRuntimeFacts();
  const mode = detectInstallationMode(runtimeFacts);
  const findings = [
    ...(await workspaceAccessFindings(
      workspace,
      dependencies.accessCheck,
    )),
    ...(await scaffoldFindings(workspace)),
    ...(await managedStateHealthFindings(workspace)),
    ...(await localIntegrityFindings(workspace)),
    ...(await recommendedCapabilities(workspace)),
    ...runtimeFindings(mode, runtimeFacts),
    ...(await gitFindings(workspace)),
    ...hostedStateFindings(),
  ];

  findings.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1, info: 2 } as const;
    const severity =
      severityOrder[a.severity] - severityOrder[b.severity];
    if (severity !== 0) return severity;
    return (a.location ?? a.code).localeCompare(
      b.location ?? b.code,
    );
  });

  return {
    result: {
      state: findings.some((finding) => finding.severity === "error")
        ? "issues_found"
        : "healthy",
      installation_mode: mode,
    },
    findings,
  };
}
