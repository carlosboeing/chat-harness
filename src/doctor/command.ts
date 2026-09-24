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
    ...(await localIntegrityFindings(workspace)),
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
