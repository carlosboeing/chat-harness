import { constants } from "node:fs";
import { access, lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { Finding } from "../cli/result.js";
import { inspectWorkspace } from "../workspace/inspect.js";
import { expectedManagedKind } from "../workspace/paths.js";

export type InstallationMode = "standalone" | "npm" | "development";

export interface RuntimeFacts {
  execPath: string;
  nodeVersion?: string;
  bunVersion?: string;
}

export function detectInstallationMode(
  facts: RuntimeFacts,
): InstallationMode {
  const executable = path.basename(facts.execPath).toLowerCase();
  if (
    executable === "chat-harness" ||
    executable === "chat-harness.exe"
  ) {
    return "standalone";
  }
  if (facts.bunVersion) return "development";
  return "npm";
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function runtimeFindings(
  mode: InstallationMode,
  facts: RuntimeFacts,
): Finding[] {
  if (mode === "standalone") {
    return [
      {
        code: "doctor.runtime_embedded",
        severity: "info",
        message:
          "Standalone binary embeds its runtime; Bun/Node are not prerequisites.",
      },
    ];
  }

  if (mode === "npm") {
    const version = facts.nodeVersion ? parseVersion(facts.nodeVersion) : null;
    if (!version || version[0] < 20) {
      return [
        {
          code: "doctor.node_unsupported",
          severity: "error",
          message: "npm installation requires Node.js 20 or newer.",
          remediation: "Install a supported Node.js runtime.",
        },
      ];
    }
    return [];
  }

  const version = facts.bunVersion ? parseVersion(facts.bunVersion) : null;
  const compatible =
    version !== null &&
    (version[0] > 1 || (version[0] === 1 && version[1] >= 4));
  if (!compatible) {
    return [
      {
        code: "doctor.bun_unsupported",
        severity: "error",
        message: "Repository development requires Bun 1.4 or newer.",
        remediation: "Install a compatible Bun release.",
      },
    ];
  }
  return [];
}

export type AccessCheck = (
  target: string,
  mode: number,
) => Promise<void>;

export async function workspaceAccessFindings(
  workspace: string,
  accessCheck: AccessCheck = access,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const info = await lstat(workspace);
  if (!info.isDirectory()) {
    return [
      {
        code: "doctor.workspace_not_directory",
        severity: "error",
        message: "Doctor target must be a directory.",
        location: workspace,
      },
    ];
  }

  try {
    await accessCheck(workspace, constants.R_OK);
  } catch {
    findings.push({
      code: "doctor.workspace_unreadable",
      severity: "error",
      message: "Workspace is not readable by the current process.",
      location: workspace,
    });
  }

  try {
    await accessCheck(workspace, constants.W_OK);
  } catch {
    findings.push({
      code: "doctor.workspace_unwritable",
      severity: "error",
      message: "Workspace is not writable by the current process.",
      location: workspace,
    });
  }

  return findings;
}

export async function scaffoldFindings(
  workspace: string,
): Promise<Finding[]> {
  const inspection = await inspectWorkspace(workspace);
  const findings: Finding[] = [];

  for (const observation of inspection.observations) {
    const expectedKind = expectedManagedKind(observation.path);
    if (observation.kind === "missing") {
      findings.push({
        code: "doctor.scaffold_missing",
        severity: "warning",
        message:
          `Expected ${expectedKind} is missing; setup can establish the v0.2 harness scaffold.`,
        location: observation.path,
        remediation: "Run chat-harness setup.",
      });
    } else if (observation.kind !== expectedKind) {
      findings.push({
        code: "doctor.scaffold_collision",
        severity: "error",
        message: `Expected ${expectedKind}, found ${observation.kind}.`,
        location: observation.path,
        remediation: "Resolve the path manually before running setup.",
      });
    }
  }

  return findings;
}

export async function localIntegrityFindings(
  workspace: string,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const registryCandidates = [
    path.join(workspace, "registry.json"),
    path.join(workspace, "extensions", "github", "registry.json"),
  ];

  for (const candidate of registryCandidates) {
    try {
      const source = await readFile(candidate, "utf8");
      const parsed = JSON.parse(source) as {
        version?: unknown;
        capabilities?: unknown;
      };
      if (
        parsed.version !== 1 ||
        typeof parsed.capabilities !== "object" ||
        parsed.capabilities === null
      ) {
        findings.push({
          code: "doctor.registry_invalid",
          severity: "error",
          message:
            "Capability registry is present but structurally invalid.",
          location: candidate,
        });
      }
      break;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      if (error instanceof SyntaxError) {
        findings.push({
          code: "doctor.registry_invalid",
          severity: "error",
          message: "Capability registry is not valid JSON.",
          location: candidate,
        });
        break;
      }
      throw error;
    }
  }

  return findings;
}

export async function gitFindings(
  workspace: string,
): Promise<Finding[]> {
  const extension = path.join(workspace, "extensions", "github");
  try {
    const info = await lstat(extension);
    if (!info.isDirectory()) return [];
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    timeout: 2_000,
  });
  if (result.status !== 0) {
    return [
      {
        code: "doctor.git_unavailable",
        severity: "error",
        message:
          "GitHub extension development path is present but Git is unavailable.",
        remediation:
          "Install Git or remove the development-only extension path.",
      },
    ];
  }
  return [];
}

export function hostedStateFindings(): Finding[] {
  return [
    {
      code: "doctor.host_state_unknown",
      severity: "info",
      message:
        "Hosted assistant plan entitlements, rollout flags, and conversation-level permissions are not locally introspectable.",
      remediation:
        "Use current compatibility documentation and a real host smoke scenario for support claims.",
    },
  ];
}
